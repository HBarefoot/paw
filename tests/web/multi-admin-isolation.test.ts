import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDb, closeDb } from "../../src/store/db.js";
import {
	listRecentSessionsForUser,
	getSessionOwnedBy,
	getSessionVisibleTo,
	deleteSessionOwnedBy,
	deleteSessionVisibleTo,
	updateSessionTitleOwnedBy,
	updateSessionTitleVisibleTo,
	forkSessionVisibleTo,
} from "../../src/store/sessions.js";
import { getSessionMessages } from "../../src/store/messages.js";
import { MemoryStore } from "../../src/memory/store.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/paw-iso-test.db";

describe("Per-admin isolation (C-NEW-1)", () => {
	const db = getDb(TEST_DB);

	afterAll(() => {
		closeDb();
		for (const suffix of ["", "-journal", "-wal", "-shm"]) {
			try {
				unlinkSync(TEST_DB + suffix);
			} catch {}
		}
	});

	test("listRecentSessionsForUser only returns that user's sessions", () => {
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id) VALUES (?, ?, ?)",
			["s-a-1", "web", "web-1"],
		);
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id) VALUES (?, ?, ?)",
			["s-a-2", "web", "web-1"],
		);
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id) VALUES (?, ?, ?)",
			["s-b-1", "web", "web-2"],
		);

		const aliceSessions = listRecentSessionsForUser(db, "web-1");
		const bobSessions = listRecentSessionsForUser(db, "web-2");

		const aliceIds = aliceSessions.map((s) => s.id).sort();
		const bobIds = bobSessions.map((s) => s.id);

		expect(aliceIds).toEqual(["s-a-1", "s-a-2"]);
		expect(bobIds).toEqual(["s-b-1"]);
	});

	test("shared channels (slack/cron/system) are visible to every admin, web stays isolated", () => {
		// A Slack thread is owned by a Slack user id, not a web admin.
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id) VALUES (?, ?, ?)",
			["s-slack-1", "slack", "U12345678"],
		);
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id) VALUES (?, ?, ?)",
			["s-cron-1", "cron", "system"],
		);

		const aliceIds = listRecentSessionsForUser(db, "web-1").map((s) => s.id);
		const bobIds = listRecentSessionsForUser(db, "web-2").map((s) => s.id);

		// Both admins see the shared Slack + cron sessions.
		expect(aliceIds).toContain("s-slack-1");
		expect(aliceIds).toContain("s-cron-1");
		expect(bobIds).toContain("s-slack-1");
		expect(bobIds).toContain("s-cron-1");

		// But web/canvas sessions stay per-admin scoped.
		expect(aliceIds).toContain("s-a-1"); // alice's own web session
		expect(aliceIds).not.toContain("s-b-1"); // bob's web session hidden from alice
		expect(bobIds).not.toContain("s-a-1"); // alice's web session hidden from bob
	});

	test("getSessionOwnedBy returns null for other users", () => {
		const alice = getSessionOwnedBy(db, "s-a-1", "web-1");
		const bob = getSessionOwnedBy(db, "s-a-1", "web-2");

		expect(alice).not.toBeNull();
		expect(alice?.user_id).toBe("web-1");
		expect(bob).toBeNull();
	});

	test("deleteSessionOwnedBy refuses cross-user delete", () => {
		const deleted = deleteSessionOwnedBy(db, "s-a-1", "web-2");
		expect(deleted).toBe(false);

		// Session still exists
		const stillThere = getSessionOwnedBy(db, "s-a-1", "web-1");
		expect(stillThere).not.toBeNull();

		// Owner can delete
		const ownDelete = deleteSessionOwnedBy(db, "s-a-1", "web-1");
		expect(ownDelete).toBe(true);
	});

	test("updateSessionTitleOwnedBy refuses cross-user update", () => {
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id, title) VALUES (?, ?, ?, ?)",
			["s-a-2", "web", "web-1", "Original"],
		);
		const denied = updateSessionTitleOwnedBy(db, "s-a-2", "Hacked", "web-2");
		expect(denied).toBe(false);

		const stillOriginal = getSessionOwnedBy(db, "s-a-2", "web-1");
		expect(stillOriginal?.title).toBe("Original");

		const ok = updateSessionTitleOwnedBy(db, "s-a-2", "Renamed", "web-1");
		expect(ok).toBe(true);
	});

	test("forkSessionVisibleTo refuses to fork another user's PRIVATE (web) session", () => {
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id) VALUES (?, ?, ?)",
			["s-b-2", "web", "web-2"],
		);
		// Insert a message so fork has something to copy
		db.run(
			"INSERT OR REPLACE INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)",
			["m-b-1", "s-b-2", "user", "secret"],
		);
		const msg = db
			.query<{ id: string; rowid: number }, []>(
				"SELECT id, rowid FROM messages WHERE session_id = 's-b-2'",
			)
			.get();
		expect(msg).not.toBeNull();

		// web is private → not visible to web-1 → fork refused (C-NEW-1).
		const denied = forkSessionVisibleTo(db, "s-b-2", msg!.id, "web-1", {
			newSessionId: "s-forked-evil",
		});
		expect(denied).toBeNull();

		// Owner can fork
		const ok = forkSessionVisibleTo(db, "s-b-2", msg!.id, "web-2", {
			newSessionId: "s-forked-ok",
		});
		expect(ok).not.toBeNull();
		expect(ok?.newSessionId).toBe("s-forked-ok");
	});

	test("forkSessionVisibleTo lets any admin fork a SHARED-channel source", () => {
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id) VALUES (?, ?, ?)",
			["s-cron-fork", "cron", "system"],
		);
		db.run(
			"INSERT OR REPLACE INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)",
			["m-cron-f", "s-cron-fork", "assistant", "cron output"],
		);
		const msg = db
			.query<{ id: string }, []>(
				"SELECT id FROM messages WHERE session_id = 's-cron-fork'",
			)
			.get();
		expect(msg).not.toBeNull();
		// A web admin who doesn't "own" the cron session can still fork it — the
		// new session is theirs. (Pre-fix forkSessionOwnedBy returned null here.)
		const forked = forkSessionVisibleTo(
			db,
			"s-cron-fork",
			msg?.id ?? "",
			"web-1",
			{
				newSessionId: "s-cron-forked",
			},
		);
		expect(forked).not.toBeNull();
		expect(forked?.newSessionId).toBe("s-cron-forked");
	});

	// Regression: shared-channel sessions (cron/slack/system) are LISTED for every
	// admin but were not OPENABLE — the read routes used strict getSessionOwnedBy,
	// so a cron session (user_id="system") 404'd as "Session not found".
	// getSessionVisibleTo mirrors the list's visibility for the read/open paths.
	test("getSessionVisibleTo opens shared-channel (cron/slack) sessions for any web admin, and messages load", () => {
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id) VALUES (?, ?, ?)",
			["s-cron-open", "cron", "system"],
		);
		db.run(
			"INSERT OR REPLACE INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)",
			["m-cron-1", "s-cron-open", "assistant", "Morning briefing output"],
		);
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id) VALUES (?, ?, ?)",
			["s-slack-open", "slack", "U99999999"],
		);

		// The cron session is openable even though it's owned by "system"...
		const cron = getSessionVisibleTo(db, "s-cron-open", "web-1");
		expect(cron).not.toBeNull();
		expect(cron?.channel).toBe("cron");
		// ...and its messages load (the detail/messages routes' second step).
		const msgs = getSessionMessages(db, "s-cron-open", 100_000);
		expect(msgs.map((m) => m.content)).toContain("Morning briefing output");
		// Slack sessions open too, for a different admin.
		expect(getSessionVisibleTo(db, "s-slack-open", "web-2")).not.toBeNull();
		// Pre-change behavior: strict ownership refused this (the bug).
		expect(getSessionOwnedBy(db, "s-cron-open", "web-1")).toBeNull();
	});

	test("getSessionVisibleTo still refuses another admin's private (web) session", () => {
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id) VALUES (?, ?, ?)",
			["s-priv-web2", "web", "web-2"],
		);
		// web-1 cannot open web-2's private web session...
		expect(getSessionVisibleTo(db, "s-priv-web2", "web-1")).toBeNull();
		// ...but the owner can.
		const own = getSessionVisibleTo(db, "s-priv-web2", "web-2");
		expect(own).not.toBeNull();
		expect(own?.user_id).toBe("web-2");
	});

	// Regression: shared-channel sessions are LISTED for every admin but the
	// mutation routes used strict getSessionOwnedBy, so they were visible but
	// undeletable/un-renamable (delete 404'd). The *VisibleTo mutations mirror the
	// list's visibility so any admin can delete/rename a shared session.
	test("any admin can DELETE a shared-channel (cron) session it can see", () => {
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id, title) VALUES (?, ?, ?, ?)",
			["s-cron-del", "cron", "system", "Briefing"],
		);
		db.run(
			"INSERT OR REPLACE INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)",
			["m-cron-del", "s-cron-del", "assistant", "output"],
		);
		// Pre-fix: strict ownership ("system" ≠ "web-1") refused this — the bug.
		expect(deleteSessionOwnedBy(db, "s-cron-del", "web-1")).toBe(false);
		// Fix: a web admin can delete the shared session it sees in its list.
		expect(deleteSessionVisibleTo(db, "s-cron-del", "web-1")).toBe(true);
		// Row (and its messages) are gone.
		expect(getSessionVisibleTo(db, "s-cron-del", "web-1")).toBeNull();
		expect(getSessionMessages(db, "s-cron-del", 100_000)).toHaveLength(0);
	});

	test("any admin can RENAME a shared-channel (slack) session it can see", () => {
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id, title) VALUES (?, ?, ?, ?)",
			["s-slack-ren", "slack", "U12345678", "Original"],
		);
		expect(updateSessionTitleOwnedBy(db, "s-slack-ren", "x", "web-1")).toBe(
			false,
		);
		expect(
			updateSessionTitleVisibleTo(db, "s-slack-ren", "Renamed", "web-1"),
		).toBe(true);
		expect(getSessionVisibleTo(db, "s-slack-ren", "web-1")?.title).toBe(
			"Renamed",
		);
	});

	test("C-NEW-1 preserved: a non-owner still can't delete/rename another admin's PRIVATE web session", () => {
		db.run(
			"INSERT OR REPLACE INTO sessions (id, channel, user_id, title) VALUES (?, ?, ?, ?)",
			["s-priv-mut", "web", "web-2", "Alice private"],
		);
		// web is NOT a shared channel, so the visibility-scoped mutations still
		// require ownership — web-1 is refused on web-2's private session.
		expect(deleteSessionVisibleTo(db, "s-priv-mut", "web-1")).toBe(false);
		expect(
			updateSessionTitleVisibleTo(db, "s-priv-mut", "Hacked", "web-1"),
		).toBe(false);
		// Untouched and intact for the owner.
		expect(getSessionOwnedBy(db, "s-priv-mut", "web-2")?.title).toBe(
			"Alice private",
		);
	});

	test("memory store records ownerUserId; list filters by it", async () => {
		const store = new MemoryStore(db);
		await store.store("Alice's secret", {
			scope: "global",
			category: "fact",
			ownerUserId: "web-1",
		});
		await store.store("Bob's secret", {
			scope: "global",
			category: "fact",
			ownerUserId: "web-2",
		});
		await store.store("Shared fact", {
			scope: "global",
			category: "fact",
			ownerUserId: null,
		});

		const aliceList = store.list({ ownerUserId: "web-1", limit: 100 });
		const bobList = store.list({ ownerUserId: "web-2", limit: 100 });

		const aliceTexts = aliceList.map((m) => m.text).sort();
		const bobTexts = bobList.map((m) => m.text).sort();

		// Alice sees her own + shared
		expect(aliceTexts).toContain("Alice's secret");
		expect(aliceTexts).toContain("Shared fact");
		expect(aliceTexts).not.toContain("Bob's secret");

		// Bob sees his own + shared
		expect(bobTexts).toContain("Bob's secret");
		expect(bobTexts).toContain("Shared fact");
		expect(bobTexts).not.toContain("Alice's secret");
	});

	test("getByIdForOwner hides other-admin memories; shared is visible to all", async () => {
		const store = new MemoryStore(db);
		const all = store.list({ limit: 100 });
		const aliceRow = all.find((m) => m.text === "Alice's secret");
		const bobRow = all.find((m) => m.text === "Bob's secret");
		expect(aliceRow).toBeDefined();
		expect(bobRow).toBeDefined();

		// Alice can read her own
		const aliceReadsAlice = store.getByIdForOwner(aliceRow!.id, "web-1");
		expect(aliceReadsAlice?.text).toBe("Alice's secret");

		// Alice cannot read Bob's
		const aliceReadsBob = store.getByIdForOwner(bobRow!.id, "web-1");
		expect(aliceReadsBob).toBeNull();

		// Anyone can read shared (owner_user_id IS NULL)
		const sharedRow = all.find((m) => m.text === "Shared fact");
		expect(sharedRow).toBeDefined();
		const bobReadsShared = store.getByIdForOwner(sharedRow!.id, "web-2");
		expect(bobReadsShared?.text).toBe("Shared fact");
	});
});
