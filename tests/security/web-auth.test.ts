import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { WebAuthManager } from "../../src/security/web-auth.js";

function createTestDb(): Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA foreign_keys = ON;");
	db.exec(`
    CREATE TABLE IF NOT EXISTS web_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      totp_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS web_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES web_admins(id),
      expires_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      user_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
	return db;
}

describe("WebAuthManager", () => {
	let db: Database;
	let auth: WebAuthManager;

	beforeEach(() => {
		db = createTestDb();
		auth = new WebAuthManager(db, {
			maxAgeMinutes: 480,
			idleTimeoutMinutes: 60,
		});
	});

	describe("admin management", () => {
		test("creates an admin", async () => {
			const id = await auth.createAdmin("admin", "password123");
			expect(id).toBeGreaterThan(0);
			expect(auth.hasAdmins()).toBe(true);
		});

		test("hasAdmins returns false when no admins", () => {
			expect(auth.hasAdmins()).toBe(false);
		});

		test("rejects duplicate username", async () => {
			await auth.createAdmin("admin", "password123");
			expect(auth.createAdmin("admin", "different")).rejects.toThrow();
		});

		test("getAdminByUsername finds admin", async () => {
			await auth.createAdmin("testuser", "pass123");
			const admin = auth.getAdminByUsername("testuser");
			expect(admin).not.toBeNull();
			expect(admin!.username).toBe("testuser");
		});

		test("getAdminByUsername returns null for unknown user", () => {
			expect(auth.getAdminByUsername("nobody")).toBeNull();
		});
	});

	describe("password verification", () => {
		test("verifies correct password", async () => {
			await auth.createAdmin("admin", "secret123");
			const admin = await auth.verifyPassword("admin", "secret123");
			expect(admin).not.toBeNull();
			expect(admin!.username).toBe("admin");
		});

		test("rejects wrong password", async () => {
			await auth.createAdmin("admin", "secret123");
			const admin = await auth.verifyPassword("admin", "wrongpass");
			expect(admin).toBeNull();
		});

		test("rejects unknown username", async () => {
			const admin = await auth.verifyPassword("nobody", "anything");
			expect(admin).toBeNull();
		});
	});

	describe("sessions", () => {
		test("creates and validates a session", async () => {
			const adminId = await auth.createAdmin("admin", "password");
			const token = auth.createSession(adminId, "127.0.0.1");
			expect(token).toBeTruthy();

			const session = auth.validateSession(token);
			expect(session).not.toBeNull();
			expect(session!.user_id).toBe(adminId);
			expect(session!.ip_address).toBe("127.0.0.1");
		});

		test("returns null for invalid token", () => {
			expect(auth.validateSession("nonexistent")).toBeNull();
		});

		test("destroys a session", async () => {
			const adminId = await auth.createAdmin("admin", "password");
			const token = auth.createSession(adminId);
			auth.destroySession(token);
			expect(auth.validateSession(token)).toBeNull();
		});

		test("destroys all user sessions", async () => {
			const adminId = await auth.createAdmin("admin", "password");
			const t1 = auth.createSession(adminId);
			const t2 = auth.createSession(adminId);
			auth.destroyUserSessions(adminId);
			expect(auth.validateSession(t1)).toBeNull();
			expect(auth.validateSession(t2)).toBeNull();
		});

		test("expired session returns null", async () => {
			const adminId = await auth.createAdmin("admin", "password");
			// Create auth manager with very short maxAge
			const shortAuth = new WebAuthManager(db, {
				maxAgeMinutes: 0, // Expired immediately — but this would be 0 minutes
				idleTimeoutMinutes: 60,
			});
			// Insert a session with past expiry directly
			db.run(
				"INSERT INTO web_sessions (token, user_id, expires_at, ip_address) VALUES (?, ?, datetime('now', '-1 hour'), ?)",
				["expired-token", adminId, "127.0.0.1"],
			);
			expect(shortAuth.validateSession("expired-token")).toBeNull();
		});

		test("cleanExpiredSessions removes old sessions", async () => {
			const adminId = await auth.createAdmin("admin", "password");
			db.run(
				"INSERT INTO web_sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '-1 hour'))",
				["old-session", adminId],
			);
			const cleaned = auth.cleanExpiredSessions();
			expect(cleaned).toBe(1);
		});
	});

	describe("TOTP", () => {
		test("setupTotp returns a secret", async () => {
			const adminId = await auth.createAdmin("admin", "password");
			const secret = auth.setupTotp(adminId);
			expect(secret.length).toBeGreaterThan(0);
			expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
		});

		test("isTotpRequired false before verification", async () => {
			const adminId = await auth.createAdmin("admin", "password");
			auth.setupTotp(adminId);
			const admin = auth.getAdmin(adminId)!;
			expect(auth.isTotpRequired(admin)).toBe(false);
		});

		test("verifyAndEnableTotp with correct code", async () => {
			const adminId = await auth.createAdmin("admin", "password");
			const secret = auth.setupTotp(adminId);
			// Generate a valid code
			const { generateTotpCode } = await import("../../src/security/totp.js");
			const code = generateTotpCode(secret);
			expect(auth.verifyAndEnableTotp(adminId, code)).toBe(true);

			const admin = auth.getAdmin(adminId)!;
			expect(auth.isTotpRequired(admin)).toBe(true);
		});

		test("verifyAndEnableTotp rejects wrong code", async () => {
			const adminId = await auth.createAdmin("admin", "password");
			auth.setupTotp(adminId);
			expect(auth.verifyAndEnableTotp(adminId, "000000")).toBe(false);
		});
	});

	describe("login flow", () => {
		test("successful login without TOTP", async () => {
			await auth.createAdmin("admin", "password123");
			const result = await auth.login(
				"admin",
				"password123",
				undefined,
				"127.0.0.1",
			);
			expect(result.success).toBe(true);
			expect(result.token).toBeTruthy();
		});

		test("failed login with wrong password", async () => {
			await auth.createAdmin("admin", "password123");
			const result = await auth.login(
				"admin",
				"wrongpass",
				undefined,
				"127.0.0.1",
			);
			expect(result.success).toBe(false);
			expect(result.error).toBe("Invalid username or password");
		});

		test("login requires TOTP when enabled", async () => {
			const adminId = await auth.createAdmin("admin", "password123");
			const secret = auth.setupTotp(adminId);
			const { generateTotpCode } = await import("../../src/security/totp.js");
			const code = generateTotpCode(secret);
			auth.verifyAndEnableTotp(adminId, code);

			// Try login without TOTP
			const result1 = await auth.login("admin", "password123", undefined);
			expect(result1.success).toBe(false);
			expect(result1.requireTotp).toBe(true);

			// Login with valid TOTP
			const newCode = generateTotpCode(secret);
			const result2 = await auth.login("admin", "password123", newCode);
			expect(result2.success).toBe(true);
			expect(result2.token).toBeTruthy();
		});

		test("login rejects invalid TOTP", async () => {
			const adminId = await auth.createAdmin("admin", "password123");
			const secret = auth.setupTotp(adminId);
			const { generateTotpCode } = await import("../../src/security/totp.js");
			const code = generateTotpCode(secret);
			auth.verifyAndEnableTotp(adminId, code);

			const result = await auth.login("admin", "password123", "000000");
			expect(result.success).toBe(false);
			expect(result.error).toBe("Invalid TOTP code");
		});
	});

	describe("logout", () => {
		test("destroys session on logout", async () => {
			const adminId = await auth.createAdmin("admin", "password123");
			const token = auth.createSession(adminId);
			auth.logout(token, adminId);
			expect(auth.validateSession(token)).toBeNull();
		});
	});

	describe("audit logging", () => {
		test("login success is audited", async () => {
			await auth.createAdmin("admin", "password123");
			await auth.login("admin", "password123", undefined, "192.168.1.1");
			const logs = auth.audit.getRecent(10);
			expect(logs.length).toBeGreaterThan(0);
			expect(logs[0].action).toBe("login.success");
			expect(logs[0].ip_address).toBe("192.168.1.1");
		});

		test("login failure is audited", async () => {
			await auth.createAdmin("admin", "password123");
			await auth.login("admin", "wrongpass", undefined, "10.0.0.1");
			const logs = auth.audit.getRecent(10);
			expect(logs.some((l) => l.action === "login.failed")).toBe(true);
		});
	});
});
