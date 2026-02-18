import type { Database } from "bun:sqlite";
import type { Logger } from "../types/plugin.js";

export interface ApprovedUser {
  userId: string;
  channel: string;
  approvedAt: string;
  approvedBy: string | null;
}

export class AccessController {
  private db: Database;
  private logger: Logger;
  private allowedUsers: string[];
  private blockedUsers: string[];
  private pairingTtlMinutes: number;

  constructor(db: Database, logger: Logger, opts: {
    allowedUsers?: string[];
    blockedUsers?: string[];
    pairingCodeTtlMinutes?: number;
  } = {}) {
    this.db = db;
    this.logger = logger;
    this.allowedUsers = opts.allowedUsers ?? [];
    this.blockedUsers = opts.blockedUsers ?? [];
    this.pairingTtlMinutes = opts.pairingCodeTtlMinutes ?? 10;
  }

  isUserApproved(userId: string, channel: string): boolean {
    // Blocked users are always rejected
    if (this.blockedUsers.includes(userId)) return false;

    // Allowlist takes priority
    if (this.allowedUsers.length > 0 && this.allowedUsers.includes(userId)) return true;

    // System users are always approved
    if (userId === "system") return true;

    // Check DB
    const row = this.db.prepare<{ user_id: string }, [string]>(
      "SELECT user_id FROM approved_users WHERE user_id = ?",
    ).get(userId);

    return row !== null;
  }

  isBlocked(userId: string): boolean {
    return this.blockedUsers.includes(userId);
  }

  generatePairingCode(userId: string): string {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + this.pairingTtlMinutes * 60 * 1000).toISOString();

    this.db.run(
      "INSERT OR REPLACE INTO pairing_codes (user_id, code, expires_at) VALUES (?, ?, ?)",
      [userId, code, expiresAt],
    );

    this.logger.info("Pairing code generated", { userId, expiresInMinutes: this.pairingTtlMinutes });
    return code;
  }

  verifyPairingCode(userId: string, code: string): boolean {
    const row = this.db.prepare<{ code: string; expires_at: string }, [string]>(
      "SELECT code, expires_at FROM pairing_codes WHERE user_id = ?",
    ).get(userId);

    if (!row) return false;

    // Check expiry
    if (new Date(row.expires_at) < new Date()) {
      this.db.run("DELETE FROM pairing_codes WHERE user_id = ?", [userId]);
      return false;
    }

    if (row.code !== code) return false;

    // Approve the user
    this.approveUser(userId, "pairing_code");
    this.db.run("DELETE FROM pairing_codes WHERE user_id = ?", [userId]);
    return true;
  }

  approveUser(userId: string, approvedBy = "admin", channel = "all"): void {
    this.db.run(
      "INSERT OR REPLACE INTO approved_users (user_id, channel, approved_by) VALUES (?, ?, ?)",
      [userId, channel, approvedBy],
    );
    this.logger.info("User approved", { userId, approvedBy });
  }

  revokeUser(userId: string): void {
    this.db.run("DELETE FROM approved_users WHERE user_id = ?", [userId]);
    this.logger.info("User revoked", { userId });
  }

  listApprovedUsers(): ApprovedUser[] {
    return this.db.prepare<
      { user_id: string; channel: string; approved_at: string; approved_by: string | null },
      []
    >("SELECT user_id, channel, approved_at, approved_by FROM approved_users ORDER BY approved_at").all().map((r) => ({
      userId: r.user_id,
      channel: r.channel,
      approvedAt: r.approved_at,
      approvedBy: r.approved_by,
    }));
  }
}
