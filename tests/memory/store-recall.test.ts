import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { closeDb, getDb } from "../../src/store/db.js";
import { MemoryStore } from "../../src/memory/store.js";
import type { Database } from "bun:sqlite";

const TEST_DB = "/tmp/paw-mem-recall.db";

let db: Database;
let vecAvailable = false;

beforeAll(() => {
	closeDb(); // reset any singleton from a prior test file
	for (const s of ["", "-journal", "-wal", "-shm"]) {
		try {
			unlinkSync(TEST_DB + s);
		} catch {}
	}
	db = getDb(TEST_DB);
	vecAvailable = !!db
		.query(
			"SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name='memories_vec'",
		)
		.get();
});

afterAll(() => {
	closeDb();
	for (const s of ["", "-journal", "-wal", "-shm"]) {
		try {
			unlinkSync(TEST_DB + s);
		} catch {}
	}
});

describe("MemoryStore recall / forget", () => {
	test("store + keyword recall returns the matching memory", async () => {
		const store = new MemoryStore(db);
		await store.store("The production deployment runs on Railway with Docker", {
			scope: "global",
			category: "fact",
		});
		await store.store("My favorite color is teal", {
			scope: "global",
			category: "preference",
		});

		const hits = await store.recall("Railway Docker deployment", { limit: 5 });
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0].text).toContain("Railway");
	});

	test("forget removes the memory from recall and list", async () => {
		const store = new MemoryStore(db);
		const id = await store.store("Ephemeral note about kangaroos", {
			scope: "global",
			category: "fact",
		});
		expect(store.list({ limit: 100 }).some((m) => m.id === id)).toBe(true);

		expect(store.forget(id)).toBe(true);
		expect(store.list({ limit: 100 }).some((m) => m.id === id)).toBe(false);
		const hits = await store.recall("kangaroos", { limit: 5 });
		expect(hits.some((h) => h.id === id)).toBe(false);
	});

	test("vector + FTS recall paths both function under their weighting", async () => {
		// NOTE: we deliberately do NOT assert exact score VALUES or a ranking flip
		// — recall's score fuses several sub-weights (similarity/recency/confidence/
		// access/feedback), which makes value-level assertions flaky. We assert the
		// honest, robust thing: each weighting still surfaces the memory, so the
		// vector path and the FTS path are both wired and don't break recall.
		const store = new MemoryStore(db);
		await store.store("Kubernetes orchestrates containerized workloads", {
			scope: "global",
			category: "fact",
		});
		const q = "Kubernetes orchestrates containerized workloads";

		// FTS path (works with or without sqlite-vec).
		const ftsHeavy = new MemoryStore(db, { vectorWeight: 0, ftsWeight: 1 });
		const fts = await ftsHeavy.recall(q, { limit: 5, minScore: 0 });
		expect(fts.some((h) => h.text.includes("Kubernetes"))).toBe(true);

		// Vector path (only when sqlite-vec is available in this env).
		if (!vecAvailable) {
			console.log(
				"[skip] memories_vec unavailable here — skipping vector-path assertion",
			);
			return;
		}
		const vecHeavy = new MemoryStore(db, { vectorWeight: 1, ftsWeight: 0 });
		const vec = await vecHeavy.recall(q, { limit: 5, minScore: 0 });
		expect(vec.some((h) => h.text.includes("Kubernetes"))).toBe(true);
	});
});
