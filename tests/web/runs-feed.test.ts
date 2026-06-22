import { describe, expect, test } from "bun:test";
import type { Run } from "../../src/store/runs.js";
import { buildRunsFeed } from "../../src/web/routes/runs-feed.js";

function run(over: Partial<Run>): Run {
	return {
		id: "id",
		session_id: "s1",
		channel: "cron",
		user_id: "system",
		claim_preview: "did a thing",
		tool_calls: 0,
		tool_errors: 0,
		verdict: "ok",
		flags: "[]",
		started_at: null,
		ended_at: null,
		created_at: "2026-06-22T10:00:00.000Z",
		...over,
	};
}

describe("buildRunsFeed (pure)", () => {
	test("counts by verdict and parses flags JSON", () => {
		const feed = buildRunsFeed([
			run({ id: "a", verdict: "ok" }),
			run({ id: "b", verdict: "suspect", flags: '["success_claim_no_write"]' }),
			run({ id: "c", verdict: "error" }),
			run({ id: "d", verdict: "suspect" }),
		]);
		expect(feed.counts).toEqual({ ok: 1, suspect: 2, error: 1 });
		const b = feed.runs.find((r) => r.id === "b");
		expect(b?.flags).toEqual(["success_claim_no_write"]);
	});

	test("error then suspect then ok sort to the top", () => {
		const feed = buildRunsFeed([
			run({ id: "ok1", verdict: "ok" }),
			run({ id: "sus1", verdict: "suspect" }),
			run({ id: "err1", verdict: "error" }),
		]);
		expect(feed.runs.map((r) => r.verdict)).toEqual(["error", "suspect", "ok"]);
	});

	test("within a verdict band, newest first", () => {
		const feed = buildRunsFeed([
			run({
				id: "old",
				verdict: "suspect",
				created_at: "2026-06-22T09:00:00.000Z",
			}),
			run({
				id: "new",
				verdict: "suspect",
				created_at: "2026-06-22T11:00:00.000Z",
			}),
		]);
		expect(feed.runs.map((r) => r.id)).toEqual(["new", "old"]);
	});

	test("version is the max created_at across rows", () => {
		const feed = buildRunsFeed([
			run({ id: "a", created_at: "2026-06-22T10:00:00.000Z" }),
			run({ id: "b", created_at: "2026-06-22T12:30:00.000Z" }),
		]);
		expect(feed.version).toBe(Date.parse("2026-06-22T12:30:00.000Z"));
	});

	test("malformed flags JSON degrades to an empty array (no throw)", () => {
		const feed = buildRunsFeed([run({ id: "x", flags: "not json" })]);
		expect(feed.runs[0]?.flags).toEqual([]);
	});
});
