import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createLogger } from "../../src/observability/logger.js";
import { AccessController } from "../../src/security/access-control.js";

describe("access controller", () => {
	let db: Database;
	let ac: AccessController;

	beforeEach(() => {
		db = new Database(":memory:");
		db.run(`CREATE TABLE IF NOT EXISTS approved_users (
      user_id TEXT PRIMARY KEY, channel TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT (datetime('now')), approved_by TEXT
    )`);
		db.run(`CREATE TABLE IF NOT EXISTS pairing_codes (
      user_id TEXT PRIMARY KEY, code TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
		ac = new AccessController(db, createLogger("test"), {
			allowedUsers: [],
			blockedUsers: [],
			pairingCodeTtlMinutes: 10,
		});
	});

	afterEach(() => {
		db.close();
	});

	test("unknown user is not approved", () => {
		expect(ac.isUserApproved("user1", "slack")).toBe(false);
	});

	test("approved user is recognized", () => {
		ac.approveUser("user1", "slack");
		expect(ac.isUserApproved("user1", "slack")).toBe(true);
	});

	test("revoked user is no longer approved", () => {
		ac.approveUser("user1", "slack");
		ac.revokeUser("user1");
		expect(ac.isUserApproved("user1", "slack")).toBe(false);
	});

	test("listPendingPairings returns users with an outstanding code", () => {
		expect(ac.listPendingPairings()).toHaveLength(0);
		ac.generatePairingCode("U07AAA");
		ac.generatePairingCode("U07BBB");
		const pending = ac.listPendingPairings();
		expect(pending.map((p) => p.userId).sort()).toEqual(["U07AAA", "U07BBB"]);
		expect(pending[0].expiresAt).toBeTruthy();
	});

	test("listApprovedUsers reflects approvals with approver + channel", () => {
		ac.approveUser("U07CCC", "web:1", "all");
		const approved = ac.listApprovedUsers();
		expect(approved).toHaveLength(1);
		expect(approved[0].userId).toBe("U07CCC");
		expect(approved[0].approvedBy).toBe("web:1");
	});

	test("pairing code flow works", () => {
		const code = ac.generatePairingCode("user1");
		expect(code).toMatch(/^\d{6}$/);
		expect(ac.verifyPairingCode("user1", code)).toBe(true);
		expect(ac.isUserApproved("user1", "auto")).toBe(true);
	});

	test("wrong pairing code is rejected", () => {
		ac.generatePairingCode("user1");
		expect(ac.verifyPairingCode("user1", "000000")).toBe(false);
		expect(ac.isUserApproved("user1", "slack")).toBe(false);
	});

	test("allowedUsers are auto-approved", () => {
		const ac2 = new AccessController(db, createLogger("test"), {
			allowedUsers: ["admin"],
			blockedUsers: [],
			pairingCodeTtlMinutes: 10,
		});
		expect(ac2.isUserApproved("admin", "slack")).toBe(true);
	});

	test("blockedUsers are never approved", () => {
		const ac2 = new AccessController(db, createLogger("test"), {
			allowedUsers: [],
			blockedUsers: ["bad-user"],
			pairingCodeTtlMinutes: 10,
		});
		ac2.approveUser("bad-user", "slack");
		expect(ac2.isUserApproved("bad-user", "slack")).toBe(false);
	});
});
