import { afterAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { closeDb, getDb } from "../../src/store/db.js";
import {
	appendMessage,
	countSessionMessages,
	getSessionMessages,
	pruneOldMessages,
	searchMessages,
} from "../../src/store/messages.js";
import { getOrCreateSession, getSession } from "../../src/store/sessions.js";

const TEST_DB = "/tmp/paw-test.db";

describe("Store", () => {
	const db = getDb(TEST_DB);

	afterAll(() => {
		closeDb();
		try {
			unlinkSync(TEST_DB);
		} catch {}
		try {
			unlinkSync(TEST_DB + "-journal");
		} catch {}
		try {
			unlinkSync(TEST_DB + "-wal");
		} catch {}
		try {
			unlinkSync(TEST_DB + "-shm");
		} catch {}
	});

	test("creates and retrieves sessions", () => {
		const session = getOrCreateSession(db, "s1", "slack", "user1");
		expect(session.id).toBe("s1");
		expect(session.channel).toBe("slack");

		const fetched = getSession(db, "s1");
		expect(fetched).not.toBeNull();
		expect(fetched!.user_id).toBe("user1");
	});

	test("getOrCreateSession is idempotent", () => {
		const s1 = getOrCreateSession(db, "s2", "slack", "user2");
		const s2 = getOrCreateSession(db, "s2", "slack", "user2");
		expect(s1.id).toBe(s2.id);
	});

	test("appends and retrieves messages", () => {
		getOrCreateSession(db, "s3", "slack", "user3");
		appendMessage(db, "s3", "user", "hello");
		appendMessage(db, "s3", "assistant", "hi there");

		const msgs = getSessionMessages(db, "s3");
		expect(msgs).toHaveLength(2);
		expect(msgs[0].role).toBe("user");
		expect(msgs[1].role).toBe("assistant");
	});

	test("prunes old messages", () => {
		getOrCreateSession(db, "s4", "slack", "user4");
		for (let i = 0; i < 10; i++) {
			appendMessage(db, "s4", "user", `msg ${i}`);
		}

		pruneOldMessages(db, "s4", 3);
		const msgs = getSessionMessages(db, "s4");
		expect(msgs).toHaveLength(3);
	});

	test("getSessionMessages returns the MOST RECENT N in chronological order", () => {
		// Correctness regression: an ASC window fed the model the OLDEST N once a
		// session exceeded the limit, losing recent context. Pre-fix this returns
		// m0..m19; the fix returns m40..m59.
		getOrCreateSession(db, "s-window", "slack", "user-w");
		for (let i = 0; i < 60; i++) {
			appendMessage(db, "s-window", "user", `m${i}`);
		}

		const recent = getSessionMessages(db, "s-window", 20);
		expect(recent).toHaveLength(20);
		expect(recent[0].content).toBe("m40");
		expect(recent[19].content).toBe("m59");
		// Strictly ascending (chronological) order across the whole window.
		expect(recent.map((m) => m.content)).toEqual(
			Array.from({ length: 20 }, (_, k) => `m${40 + k}`),
		);
	});

	test("countSessionMessages reports the stored count", () => {
		getOrCreateSession(db, "s-count", "slack", "user-c");
		expect(countSessionMessages(db, "s-count")).toBe(0);
		for (let i = 0; i < 5; i++) appendMessage(db, "s-count", "user", `c${i}`);
		expect(countSessionMessages(db, "s-count")).toBe(5);
	});

	test("prune keeps the most recent keepLast and FTS still finds survivors", () => {
		getOrCreateSession(db, "s-fts", "slack", "user-fts");
		for (let i = 0; i < 10; i++) {
			appendMessage(db, "s-fts", "user", `charlie message number ${i}`);
		}

		pruneOldMessages(db, "s-fts", 3);
		const survivors = getSessionMessages(db, "s-fts", 100);
		expect(survivors).toHaveLength(3);
		// The survivors are the most recent three (m7, m8, m9).
		expect(survivors.map((m) => m.content)).toEqual([
			"charlie message number 7",
			"charlie message number 8",
			"charlie message number 9",
		]);

		// Message search (FTS5, or LIKE fallback) only returns the survivors — the
		// AFTER-DELETE trigger kept messages_fts consistent with the pruning.
		const hits = searchMessages(db, "charlie", {
			userId: "user-fts",
			sessionId: "s-fts",
		});
		expect(hits).toHaveLength(3);
		expect(hits.every((h) => h.session_id === "s-fts")).toBe(true);
	});

	test("WAL companion pragmas are applied", () => {
		// Smoke test: getDb() set synchronous=NORMAL (1) and busy_timeout=5000.
		const sync = db
			.query<{ synchronous: number }, []>("PRAGMA synchronous")
			.get();
		expect(sync?.synchronous).toBe(1);
		const busy = db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get();
		expect(busy?.timeout).toBe(5000);
	});
});
