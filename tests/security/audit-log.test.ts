import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { AuditLogger } from "../../src/security/audit-log.js";

function createTestDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
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

describe("AuditLogger", () => {
	let db: Database;
	let logger: AuditLogger;

	beforeEach(() => {
		db = createTestDb();
		logger = new AuditLogger(db);
	});

	test("logs an action", () => {
		logger.log("login.success", 1, { username: "admin" }, "127.0.0.1");
		const entries = logger.getRecent(10);
		expect(entries.length).toBe(1);
		expect(entries[0].action).toBe("login.success");
		expect(entries[0].user_id).toBe(1);
		expect(entries[0].ip_address).toBe("127.0.0.1");
		expect(JSON.parse(entries[0].details!)).toEqual({ username: "admin" });
	});

	test("logs without details or IP", () => {
		logger.log("logout", 1);
		const entries = logger.getRecent(10);
		expect(entries.length).toBe(1);
		expect(entries[0].details).toBeNull();
		expect(entries[0].ip_address).toBeNull();
	});

	test("logs without user_id", () => {
		logger.log("login.failed", null, { username: "unknown" });
		const entries = logger.getRecent(10);
		expect(entries[0].user_id).toBeNull();
	});

	test("getRecent respects limit", () => {
		for (let i = 0; i < 10; i++) {
			logger.log(`action.${i}`, 1);
		}
		const entries = logger.getRecent(3);
		expect(entries.length).toBe(3);
	});

	test("getRecent returns newest first", () => {
		logger.log("first", 1);
		logger.log("second", 1);
		const entries = logger.getRecent(10);
		expect(entries[0].action).toBe("second");
		expect(entries[1].action).toBe("first");
	});
});
