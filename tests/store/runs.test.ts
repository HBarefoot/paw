import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { RunRecord } from "../../src/observability/run-verdict.js";
import {
	getRun,
	listRecentRuns,
	listRunsByVerdict,
	recordRun,
} from "../../src/store/runs.js";

/** In-memory DB with the runs schema (mirrors runMigrations in db.ts). */
function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE runs (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			channel TEXT,
			user_id TEXT,
			claim_preview TEXT,
			tool_calls INTEGER NOT NULL DEFAULT 0,
			tool_errors INTEGER NOT NULL DEFAULT 0,
			verdict TEXT NOT NULL DEFAULT 'ok' CHECK(verdict IN ('ok','suspect','error')),
			flags TEXT NOT NULL DEFAULT '[]',
			started_at TEXT,
			ended_at TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);
	return db;
}

function row(over: Partial<RunRecord>): RunRecord {
	return {
		id: crypto.randomUUID(),
		session_id: "s1",
		channel: "cron",
		user_id: "system",
		claim_preview: "did a thing",
		tool_calls: 1,
		tool_errors: 0,
		verdict: "ok",
		flags: "[]",
		started_at: "2026-06-22T00:00:00.000Z",
		ended_at: "2026-06-22T00:00:01.000Z",
		...over,
	};
}

describe("runs store round-trip", () => {
	test("recordRun + getRun preserves the row", () => {
		const db = freshDb();
		const r = row({
			id: "r1",
			verdict: "suspect",
			flags: JSON.stringify(["success_claim_no_write"]),
		});
		recordRun(db, r);
		const got = getRun(db, "r1");
		expect(got?.verdict).toBe("suspect");
		expect(got?.session_id).toBe("s1");
		expect(JSON.parse(got?.flags ?? "[]")).toEqual(["success_claim_no_write"]);
	});

	test("listRunsByVerdict filters by verdict", () => {
		const db = freshDb();
		recordRun(db, row({ id: "a", verdict: "ok" }));
		recordRun(db, row({ id: "b", verdict: "suspect" }));
		recordRun(db, row({ id: "c", verdict: "suspect" }));
		recordRun(db, row({ id: "d", verdict: "error" }));

		const suspect = listRunsByVerdict(db, "suspect");
		expect(suspect.map((r) => r.id).sort()).toEqual(["b", "c"]);
		expect(listRunsByVerdict(db, "error").map((r) => r.id)).toEqual(["d"]);
		expect(listRecentRuns(db).length).toBe(4);
	});
});
