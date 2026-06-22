import { describe, expect, test } from "bun:test";
import {
	type VerdictTask,
	type VerdictToolEntry,
	claimAssertsCompletion,
	computeRunVerdict,
	recordRunVerdict,
	sqliteStamp,
} from "../../src/observability/run-verdict.js";

function tool(
	tool_name: string,
	is_error = 0,
	output_preview: string | null = "ok",
): VerdictToolEntry {
	return { tool_name, is_error, output_preview };
}

function task(status: string, evidence: string | null = null): VerdictTask {
	return { status, evidence };
}

describe("computeRunVerdict — phantom success", () => {
	test("action-completion claim + ZERO successful mutating calls → suspect", () => {
		const r = computeRunVerdict({
			claimText: "Created the company and marked the lead seen.",
			toolEntries: [tool("find_many_companies"), tool("supabase_select")],
			sessionTasks: [],
		});
		expect(r.verdict).toBe("suspect");
		expect(r.flags).toContain("success_claim_no_write");
	});

	test("same claim WITH a real successful mutating call → ok", () => {
		const r = computeRunVerdict({
			claimText: "Created the company and marked the lead seen.",
			toolEntries: [
				tool("find_many_companies"),
				tool("create_one_company", 0),
				tool("supabase_update", 0),
			],
			sessionTasks: [],
		});
		expect(r.verdict).toBe("ok");
		expect(r.flags).toEqual([]);
	});

	test("a failed mutating call does NOT count as a successful write → still suspect", () => {
		const r = computeRunVerdict({
			claimText: "Updated the record.",
			toolEntries: [tool("update_one_person", 1, "boom")],
			sessionTasks: [],
		});
		// tool_error makes it error; the phantom flag also fires (no successful write)
		expect(r.verdict).toBe("error");
		expect(r.flags).toContain("tool_error");
		expect(r.flags).toContain("success_claim_no_write");
	});

	test("purely informational claim + no writes → ok (no false positive)", () => {
		const r = computeRunVerdict({
			claimText: "Here's the summary of what I found: 3 companies match.",
			toolEntries: [tool("find_many_companies"), tool("supabase_select")],
			sessionTasks: [],
		});
		expect(r.verdict).toBe("ok");
		expect(r.flags).toEqual([]);
	});
});

describe("computeRunVerdict — tool errors", () => {
	test("a tool is_error=1 → error with tool_error", () => {
		const r = computeRunVerdict({
			claimText: "Here is the result.",
			toolEntries: [tool("supabase_select", 1, "timeout")],
			sessionTasks: [],
		});
		expect(r.verdict).toBe("error");
		expect(r.flags).toContain("tool_error");
		expect(r.toolErrors).toBe(1);
	});

	test("an error with empty output → swallowed_error", () => {
		const r = computeRunVerdict({
			claimText: "Done.",
			toolEntries: [tool("supabase_update", 1, "")],
			sessionTasks: [],
		});
		expect(r.verdict).toBe("error");
		expect(r.flags).toContain("swallowed_error");
	});

	test("error precedence beats suspect", () => {
		const r = computeRunVerdict({
			claimText: "Created and saved everything.",
			toolEntries: [tool("supabase_select", 1, "boom")],
			sessionTasks: [task("done", "")],
		});
		expect(r.verdict).toBe("error"); // not suspect, despite phantom + bad task
		expect(r.flags).toContain("tool_error");
		expect(r.flags).toContain("success_claim_no_write");
		expect(r.flags).toContain("task_done_without_evidence");
	});
});

describe("computeRunVerdict — ledger cross-check", () => {
	test("a done task with empty evidence → suspect", () => {
		const r = computeRunVerdict({
			claimText: "All set.",
			toolEntries: [tool("create_one_company", 0)],
			sessionTasks: [task("done", "   ")],
		});
		expect(r.verdict).toBe("suspect");
		expect(r.flags).toContain("task_done_without_evidence");
	});

	test("claim asserts completion but a task is still open → task_left_open", () => {
		const r = computeRunVerdict({
			claimText: "Processed the leads.",
			toolEntries: [tool("supabase_insert", 0)],
			sessionTasks: [task("working")],
		});
		expect(r.verdict).toBe("suspect");
		expect(r.flags).toContain("task_left_open");
	});

	test("counts are reported", () => {
		const r = computeRunVerdict({
			claimText: "info only",
			toolEntries: [tool("a"), tool("b", 1, "e"), tool("c")],
			sessionTasks: [],
		});
		expect(r.toolCalls).toBe(3);
		expect(r.toolErrors).toBe(1);
	});
});

describe("recordRunVerdict orchestrator — fail-open", () => {
	const baseDeps = {
		input: {
			claimText: "Created it.",
			toolEntries: [] as VerdictToolEntry[],
			sessionTasks: [] as VerdictTask[],
		},
		id: "run-1",
		sessionId: "s1",
		channel: "cron",
		userId: "system",
		startedAt: "2026-06-22T00:00:00.000Z",
		endedAt: "2026-06-22T00:00:01.000Z",
	};

	test("records the row and alerts on a non-ok verdict", () => {
		const rows: unknown[] = [];
		const notes: unknown[] = [];
		const res = recordRunVerdict({
			...baseDeps,
			recordRun: (row) => rows.push(row),
			notify: (n) => notes.push(n),
		});
		expect(res?.verdict).toBe("suspect"); // "Created it." + no writes
		expect(rows.length).toBe(1);
		expect(notes.length).toBe(1);
	});

	test("a throwing recordRun is swallowed → returns null, does not throw", () => {
		let threw = false;
		let res: unknown;
		try {
			res = recordRunVerdict({
				...baseDeps,
				recordRun: () => {
					throw new Error("db down");
				},
				notify: () => {},
			});
		} catch {
			threw = true;
		}
		expect(threw).toBe(false);
		expect(res).toBeNull();
	});

	test("a throwing compute is swallowed → returns null", () => {
		const res = recordRunVerdict({
			...baseDeps,
			recordRun: () => {},
			notify: () => {},
			compute: () => {
				throw new Error("bug");
			},
		});
		expect(res).toBeNull();
	});

	test("ok verdict records but does NOT alert", () => {
		const rows: unknown[] = [];
		const notes: unknown[] = [];
		recordRunVerdict({
			...baseDeps,
			input: {
				claimText: "Here is the answer.",
				toolEntries: [],
				sessionTasks: [],
			},
			recordRun: (row) => rows.push(row),
			notify: (n) => notes.push(n),
		});
		expect(rows.length).toBe(1);
		expect(notes.length).toBe(0);
	});
});

describe("claimAssertsCompletion — negation false-positives", () => {
	test("honest no-op (negated completion verbs) does NOT assert completion", () => {
		const claim =
			"No new leads today — no task created, no fabricated work.";
		expect(claimAssertsCompletion(claim)).toBe(false);
	});

	test("a genuine, non-negated completion verb still asserts completion", () => {
		expect(
			claimAssertsCompletion("Created the company and marked the lead seen."),
		).toBe(true);
	});

	test("n't contractions count as negators", () => {
		expect(claimAssertsCompletion("I haven't created anything.")).toBe(false);
	});

	test("a non-negated verb later in the text still wins", () => {
		// "no leads found" is negated, but "sent the digest" is a real claim.
		expect(
			claimAssertsCompletion("No leads found, but I sent the digest."),
		).toBe(true);
	});

	test("negation false-positive does not flag an honest no-op run as suspect", () => {
		const r = computeRunVerdict({
			claimText: "No new leads today — no task created, no fabricated work.",
			toolEntries: [tool("find_many_companies", 0)],
			sessionTasks: [],
		});
		expect(r.verdict).toBe("ok");
		expect(r.flags).not.toContain("success_claim_no_write");
	});
});

describe("sqliteStamp — run-window timestamp normalization", () => {
	test("converts ISO to the SQLite datetime('now') shape", () => {
		expect(sqliteStamp("2026-06-22T16:59:00.123Z")).toBe("2026-06-22 16:59:00");
	});

	test("a SQLite-format row at/after run start is in-window; raw ISO would drop it", () => {
		const startedAt = "2026-06-22T16:59:00.123Z";
		// What the DB default datetime('now') actually writes (space, no ms/zone).
		const rowCreatedAt = "2026-06-22 16:59:01";
		// The bug: comparing against the raw ISO string excludes every row
		// (space 0x20 < 'T' 0x54 at index 10).
		expect(rowCreatedAt >= startedAt).toBe(false);
		// The fix: normalize first, and the in-window row is included.
		expect(rowCreatedAt >= sqliteStamp(startedAt)).toBe(true);
	});
});
