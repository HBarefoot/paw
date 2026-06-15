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

	// Defect 1: a still-valid pairing code must stay stable across repeated
	// unrecognized messages (the old code minted a fresh code every call,
	// invalidating the one the user was just shown).
	test("generatePairingCode returns the same code within the TTL", () => {
		const first = ac.generatePairingCode("user1");
		const second = ac.generatePairingCode("user1");
		expect(second).toBe(first);
		// The stable code still approves.
		expect(ac.verifyPairingCode("user1", first)).toBe(true);
	});

	test("generatePairingCode mints a new code after expiry", () => {
		const first = ac.generatePairingCode("user1");
		// Force the existing code to be expired.
		db.run("UPDATE pairing_codes SET expires_at = ? WHERE user_id = ?", [
			new Date(Date.now() - 60_000).toISOString(),
			"user1",
		]);
		const second = ac.generatePairingCode("user1");
		expect(second).not.toBe(first);
		// The old (expired) code is gone; only the new one verifies.
		expect(ac.verifyPairingCode("user1", first)).toBe(false);
		const third = ac.generatePairingCode("user1");
		expect(ac.verifyPairingCode("user1", third)).toBe(true);
	});

	// Defect 3: the owner's identity is recognized without an approved_users row
	// and never triggers pairing (channel-agnostic, parallels web-admin exempt).
	test("ownerUserIds are approved without an approved_users row", () => {
		const ac2 = new AccessController(db, createLogger("test"), {
			ownerUserIds: ["U_OWNER"],
			pairingCodeTtlMinutes: 10,
		});
		expect(ac2.isUserApproved("U_OWNER", "slack")).toBe(true);
		// No DB row was created for the owner.
		const row = db
			.prepare("SELECT user_id FROM approved_users WHERE user_id = ?")
			.get("U_OWNER");
		expect(row).toBeNull();
	});

	test("a non-owner still goes through pairing; empty allowlist = no regression", () => {
		const ac2 = new AccessController(db, createLogger("test"), {
			ownerUserIds: ["U_OWNER"],
			pairingCodeTtlMinutes: 10,
		});
		expect(ac2.isUserApproved("U_STRANGER", "slack")).toBe(false);
		const ac3 = new AccessController(db, createLogger("test"), {
			ownerUserIds: [],
			pairingCodeTtlMinutes: 10,
		});
		expect(ac3.isUserApproved("U_OWNER", "slack")).toBe(false);
	});
});
