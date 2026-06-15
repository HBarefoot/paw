import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../src/observability/logger.js";
import {
	AccessController,
	unrecognizedUserMessage,
} from "../../src/security/access-control.js";

const APPROVED_DDL = `CREATE TABLE IF NOT EXISTS approved_users (
  user_id TEXT PRIMARY KEY, channel TEXT NOT NULL,
  approved_at TEXT NOT NULL DEFAULT (datetime('now')), approved_by TEXT
)`;
const PAIRING_DDL = `CREATE TABLE IF NOT EXISTS pairing_codes (
  user_id TEXT PRIMARY KEY, code TEXT NOT NULL,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

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

	// Approving a user must clear any outstanding pairing code so they stop
	// showing as a (stale/"expired") pending row. Previously only
	// verifyPairingCode deleted it, so a page-approved user lingered forever.
	test("approveUser clears the user's outstanding pairing code", () => {
		ac.generatePairingCode("U07DDD");
		expect(ac.listPendingPairings().map((p) => p.userId)).toContain("U07DDD");
		ac.approveUser("U07DDD", "web:1", "all");
		expect(ac.listPendingPairings().map((p) => p.userId)).not.toContain(
			"U07DDD",
		);
	});

	test("clearPairing removes an outstanding code without approving in the DB", () => {
		ac.generatePairingCode("U07EEE");
		ac.clearPairing("U07EEE");
		expect(ac.listPendingPairings().map((p) => p.userId)).not.toContain(
			"U07EEE",
		);
		// clearPairing alone does not approve — no DB row written.
		const row = db
			.prepare("SELECT user_id FROM approved_users WHERE user_id = ?")
			.get("U07EEE");
		expect(row).toBeNull();
	});

	// listPendingPairings must hide ids that are ALREADY recognized — an owner
	// with a leftover code row otherwise rendered as an "expired pending" row
	// (the exact /access confusion this fixes). A genuinely unknown id stays.
	test("listPendingPairings excludes already-recognized ids", () => {
		ac.generatePairingCode("U_OWNER_PENDING");
		ac.generatePairingCode("U_STILL_UNKNOWN");
		// Pre-fix: both show. Post-fix: owner is filtered out.
		ac.setAccessLists({ ownerUserIds: ["U_OWNER_PENDING"] });
		const ids = ac.listPendingPairings().map((p) => p.userId);
		expect(ids).not.toContain("U_OWNER_PENDING");
		expect(ids).toContain("U_STILL_UNKNOWN");
	});

	test("listPendingPairings excludes a DB-approved id with a stale code row", () => {
		ac.generatePairingCode("U_APPROVED");
		// Write the approved_users row directly so the pairing_codes row survives
		// (approveUser would itself clear it), simulating pre-fix leftover state.
		db.run(
			"INSERT OR REPLACE INTO approved_users (user_id, channel, approved_by) VALUES (?, 'all', 'web:1')",
			["U_APPROVED"],
		);
		expect(ac.listPendingPairings().map((p) => p.userId)).not.toContain(
			"U_APPROVED",
		);
	});

	// setAccessLists applies an allowlist/owner change to the RUNNING controller
	// without a restart. Previously these lists were seeded only in the
	// constructor, so /api/access/persist (+ ownerUserIds) needed a reboot.
	test("setAccessLists makes an owner id recognized live, with no DB row", () => {
		expect(ac.isUserApproved("U_LIVE_OWNER", "slack")).toBe(false);
		ac.setAccessLists({ ownerUserIds: ["U_LIVE_OWNER"] });
		expect(ac.isUserApproved("U_LIVE_OWNER", "slack")).toBe(true);
		const row = db
			.prepare("SELECT user_id FROM approved_users WHERE user_id = ?")
			.get("U_LIVE_OWNER");
		expect(row).toBeNull();
	});

	test("setAccessLists updates allowedUsers live and only the provided list", () => {
		ac.setAccessLists({ allowedUsers: ["U_ALLOWED"] });
		expect(ac.isUserApproved("U_ALLOWED", "slack")).toBe(true);
		// Omitting a list leaves it untouched (allowedUsers stays applied).
		ac.setAccessLists({ blockedUsers: ["U_BAD"] });
		expect(ac.isUserApproved("U_ALLOWED", "slack")).toBe(true);
		expect(ac.isUserApproved("U_BAD", "slack")).toBe(false);
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

// The unrecognized-user reply must name the exact id the kernel keyed on, so the
// operator can approve the RIGHT id (a relay can present a different sender).
describe("unrecognizedUserMessage", () => {
	test("includes both the pairing code and the exact user id", () => {
		const msg = unrecognizedUserMessage("U0ABC123", "255274");
		expect(msg).toContain("255274");
		expect(msg).toContain("U0ABC123");
	});
});

// A DB approval must survive a process restart against the SAME db file. This
// guards that nothing clears `approved_users` on open (no DROP/migration wipe)
// — the on-disk approval is the durable record when the file is persistent.
// (If approvals still vanish in prod, the db FILE is ephemeral — a deploy/volume
// issue — not this code path.)
describe("access controller — approvals survive a restart (same db file)", () => {
	let dir: string;
	let dbPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "paw-access-restart-"));
		dbPath = join(dir, "paw.db");
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	test("approveUser persists across a fresh AccessController on the same file", () => {
		// First "process": approve, then close the handle.
		const db1 = new Database(dbPath);
		db1.run(APPROVED_DDL);
		db1.run(PAIRING_DDL);
		const ac1 = new AccessController(db1, createLogger("test"));
		ac1.approveUser("U03H65TPZ1N", "pairing_code", "all");
		expect(ac1.isUserApproved("U03H65TPZ1N", "slack")).toBe(true);
		db1.close();

		// Second "process" (simulated restart): reopen the SAME file, no in-memory
		// state carried over. The row must still be there.
		const db2 = new Database(dbPath);
		db2.run(APPROVED_DDL); // CREATE TABLE IF NOT EXISTS — must not wipe the row
		db2.run(PAIRING_DDL);
		const ac2 = new AccessController(db2, createLogger("test"));
		expect(ac2.isUserApproved("U03H65TPZ1N", "slack")).toBe(true);
		db2.close();
	});
});
