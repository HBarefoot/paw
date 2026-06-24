import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// feat/runs-table-redesign — the /runs table filters client-side over the loaded
// window (verdict / type / claim-search). These assert the pure RunsBoard.applyFilters
// seam. Fails on pre-change code (the card-stream runs.js had no applyFilters).

const SRC = readFileSync(
	new URL("../../src/web/public/runs/runs.js", import.meta.url),
	"utf8",
);

// biome-ignore lint/suspicious/noExplicitAny: intentionally untyped test stubs
type Any = any;

/** Load runs.js into a fake window (no DOM needed for the pure filter). */
function loadRuns(): Any {
	const win: Any = {};
	// runs.js only touches document/fetch/setTimeout inside start(); applyFilters
	// is pure, so bare stubs are enough for the IIFE to evaluate.
	new Function("window", "document", "fetch", "setTimeout", SRC)(
		win,
		{ getElementById: () => null, querySelectorAll: () => [] },
		() => Promise.resolve({ ok: true, json: () => ({}) }),
		() => 0,
	);
	return win.RunsBoard;
}

const RUNS = [
	{
		id: "1",
		verdict: "error",
		channel: "cron",
		claim_preview: "swept 0 leads",
	},
	{
		id: "2",
		verdict: "suspect",
		channel: "web",
		claim_preview: "Done, no write",
	},
	{
		id: "3",
		verdict: "ok",
		channel: "canvas",
		claim_preview: "Published the PAGE",
	},
	{ id: "4", verdict: "ok", channel: "slack", claim_preview: "answered query" },
];

describe("runs.js applyFilters", () => {
	test("the seam is exposed", () => {
		expect(typeof loadRuns().applyFilters).toBe("function");
	});

	test("'all' / empty means no constraint", () => {
		const rb = loadRuns();
		expect(
			rb.applyFilters(RUNS, { verdict: "all", type: "all", search: "" }),
		).toHaveLength(4);
		expect(rb.applyFilters(RUNS, {})).toHaveLength(4);
	});

	test("verdict filter", () => {
		const rb = loadRuns();
		expect(
			rb.applyFilters(RUNS, { verdict: "ok" }).map((r: Any) => r.id),
		).toEqual(["3", "4"]);
		expect(
			rb.applyFilters(RUNS, { verdict: "error" }).map((r: Any) => r.id),
		).toEqual(["1"]);
	});

	test("type (channel) filter", () => {
		const rb = loadRuns();
		expect(
			rb.applyFilters(RUNS, { type: "cron" }).map((r: Any) => r.id),
		).toEqual(["1"]);
	});

	test("claim search is case-insensitive", () => {
		const rb = loadRuns();
		expect(
			rb.applyFilters(RUNS, { search: "page" }).map((r: Any) => r.id),
		).toEqual(["3"]);
		expect(
			rb.applyFilters(RUNS, { search: "  WRITE " }).map((r: Any) => r.id),
		).toEqual(["2"]);
	});

	test("filters combine (AND)", () => {
		const rb = loadRuns();
		expect(
			rb
				.applyFilters(RUNS, {
					verdict: "ok",
					type: "slack",
					search: "answered",
				})
				.map((r: Any) => r.id),
		).toEqual(["4"]);
		expect(rb.applyFilters(RUNS, { verdict: "ok", type: "cron" })).toHaveLength(
			0,
		);
	});
});
