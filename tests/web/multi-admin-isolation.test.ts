import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDb, closeDb } from "../../src/store/db.js";
import {
	listRecentSessionsForUser,
	getSessionOwnedBy,
	deleteSessionOwnedBy,
	updateSessionTitleOwnedBy,
	forkSessionOwnedBy,
} from "../../src/store/sessions.js";
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
		const denied = updateSessionTitleOwnedBy(
			db,
			"s-a-2",
			"Hacked",
			"web-2",
		);
		expect(denied).toBe(false);

		const stillOriginal = getSessionOwnedBy(db, "s-a-2", "web-1");
		expect(stillOriginal?.title).toBe("Original");

		const ok = updateSessionTitleOwnedBy(db, "s-a-2", "Renamed", "web-1");
		expect(ok).toBe(true);
	});

	test("forkSessionOwnedBy refuses to fork another user's session", () => {
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

		const denied = forkSessionOwnedBy(
			db,
			"s-b-2",
			msg!.id,
			"web-1",
			{ newSessionId: "s-forked-evil" },
		);
		expect(denied).toBeNull();

		// Owner can fork
		const ok = forkSessionOwnedBy(
			db,
			"s-b-2",
			msg!.id,
			"web-2",
			{ newSessionId: "s-forked-ok" },
		);
		expect(ok).not.toBeNull();
		expect(ok?.newSessionId).toBe("s-forked-ok");
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
