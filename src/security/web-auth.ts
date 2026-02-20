import type { Database } from "bun:sqlite";
import { generateSecret, verifyTotp } from "./totp.js";
import { AuditLogger } from "./audit-log.js";

export interface SessionConfig {
  maxAgeMinutes: number;
  idleTimeoutMinutes: number;
}

export interface WebAdmin {
  id: number;
  username: string;
  password_hash: string;
  totp_secret: string | null;
  totp_verified: number;
  created_at: string;
}

export interface WebSession {
  token: string;
  user_id: number;
  expires_at: string;
  last_active_at: string;
  ip_address: string | null;
  created_at: string;
}

export class WebAuthManager {
  private db: Database;
  private sessionConfig: SessionConfig;
  readonly audit: AuditLogger;
  /** TOTP attempt tracking: username → { count, lockedUntil } */
  private totpAttempts: Map<string, { count: number; lockedUntil: number }> = new Map();
  private readonly TOTP_MAX_ATTEMPTS = 5;
  private readonly TOTP_LOCKOUT_MS = 15 * 60_000; // 15 minutes

  constructor(db: Database, sessionConfig: SessionConfig) {
    this.db = db;
    this.sessionConfig = sessionConfig;
    this.audit = new AuditLogger(db);
  }

  async createAdmin(username: string, password: string): Promise<number> {
    const hash = await Bun.password.hash(password, "argon2id");
    const result = this.db.run(
      "INSERT INTO web_admins (username, password_hash) VALUES (?, ?)",
      [username, hash],
    );
    return Number(result.lastInsertRowid);
  }

  async verifyPassword(username: string, password: string): Promise<WebAdmin | null> {
    const admin = this.db
      .query<WebAdmin, [string]>("SELECT * FROM web_admins WHERE username = ?")
      .get(username);
    if (!admin) return null;
    const valid = await Bun.password.verify(password, admin.password_hash);
    return valid ? admin : null;
  }

  hasAdmins(): boolean {
    const row = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM web_admins")
      .get();
    return (row?.count ?? 0) > 0;
  }

  getAdmin(id: number): WebAdmin | null {
    return this.db
      .query<WebAdmin, [number]>("SELECT * FROM web_admins WHERE id = ?")
      .get(id);
  }

  getAdminByUsername(username: string): WebAdmin | null {
    return this.db
      .query<WebAdmin, [string]>("SELECT * FROM web_admins WHERE username = ?")
      .get(username);
  }

  // --- TOTP ---

  setupTotp(adminId: number): string {
    const secret = generateSecret();
    this.db.run(
      "UPDATE web_admins SET totp_secret = ?, totp_verified = 0 WHERE id = ?",
      [secret, adminId],
    );
    return secret;
  }

  verifyAndEnableTotp(adminId: number, code: string): boolean {
    const admin = this.getAdmin(adminId);
    if (!admin?.totp_secret) return false;
    if (!verifyTotp(admin.totp_secret, code)) return false;
    this.db.run(
      "UPDATE web_admins SET totp_verified = 1 WHERE id = ?",
      [adminId],
    );
    this.audit.log("totp.setup", adminId);
    return true;
  }

  isTotpRequired(admin: WebAdmin): boolean {
    return admin.totp_verified === 1 && admin.totp_secret !== null;
  }

  verifyTotpCode(admin: WebAdmin, code: string): boolean {
    if (!admin.totp_secret) return false;
    return verifyTotp(admin.totp_secret, code);
  }

  // --- Sessions ---

  createSession(userId: number, ipAddress?: string): string {
    const token = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + this.sessionConfig.maxAgeMinutes * 60 * 1000,
    ).toISOString();

    this.db.run(
      "INSERT INTO web_sessions (token, user_id, expires_at, ip_address) VALUES (?, ?, ?, ?)",
      [token, userId, expiresAt, ipAddress ?? null],
    );
    return token;
  }

  validateSession(token: string): WebSession | null {
    const session = this.db
      .query<WebSession, [string]>("SELECT * FROM web_sessions WHERE token = ?")
      .get(token);
    if (!session) return null;

    const now = new Date();
    const expires = new Date(session.expires_at);
    if (now > expires) {
      this.destroySession(token);
      return null;
    }

    // Check idle timeout
    const lastActive = new Date(session.last_active_at);
    const idleMs = now.getTime() - lastActive.getTime();
    if (idleMs > this.sessionConfig.idleTimeoutMinutes * 60 * 1000) {
      this.destroySession(token);
      return null;
    }

    // Touch session
    this.db.run(
      "UPDATE web_sessions SET last_active_at = datetime('now') WHERE token = ?",
      [token],
    );

    return session;
  }

  destroySession(token: string): void {
    this.db.run("DELETE FROM web_sessions WHERE token = ?", [token]);
  }

  destroyUserSessions(userId: number): void {
    this.db.run("DELETE FROM web_sessions WHERE user_id = ?", [userId]);
  }

  cleanExpiredSessions(): number {
    const result = this.db.run(
      "DELETE FROM web_sessions WHERE expires_at < datetime('now')",
    );
    return result.changes;
  }

  // --- Login flow ---

  async login(
    username: string,
    password: string,
    totpCode: string | undefined,
    ipAddress?: string,
  ): Promise<{ success: boolean; token?: string; requireTotp?: boolean; error?: string }> {
    const admin = await this.verifyPassword(username, password);
    if (!admin) {
      this.audit.log("login.failed", null, { username }, ipAddress);
      return { success: false, error: "Invalid username or password" };
    }

    if (this.isTotpRequired(admin)) {
      if (!totpCode) {
        return { success: false, requireTotp: true };
      }

      // Check TOTP lockout
      const attempts = this.totpAttempts.get(username);
      if (attempts && Date.now() < attempts.lockedUntil) {
        this.audit.log("login.failed", admin.id, { reason: "totp_locked" }, ipAddress);
        return { success: false, error: "Too many TOTP attempts. Please wait 15 minutes." };
      }

      if (!this.verifyTotpCode(admin, totpCode)) {
        // Track failed TOTP attempt
        const current = this.totpAttempts.get(username) ?? { count: 0, lockedUntil: 0 };
        current.count++;
        if (current.count >= this.TOTP_MAX_ATTEMPTS) {
          current.lockedUntil = Date.now() + this.TOTP_LOCKOUT_MS;
          current.count = 0;
        }
        this.totpAttempts.set(username, current);
        this.audit.log("login.failed", admin.id, { reason: "invalid_totp" }, ipAddress);
        return { success: false, error: "Invalid TOTP code" };
      }

      // Clear TOTP attempts on success
      this.totpAttempts.delete(username);
    }

    const token = this.createSession(admin.id, ipAddress);
    this.audit.log("login.success", admin.id, undefined, ipAddress);
    return { success: true, token };
  }

  logout(token: string, userId?: number): void {
    this.destroySession(token);
    if (userId) {
      this.audit.log("logout", userId);
    }
  }
}
