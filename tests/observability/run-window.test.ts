import { unlinkSync } from "node:fs";
import { afterAll, describe, expect, test } from "bun:test";
import {
	computeRunVerdict,
	sqliteStamp,
} from "../../src/observability/run-verdict.js";
import { ToolLog } from "../../src/observability/tool-log.js";
import { createTask, listBySession } from "../../src/store/agent-work.js";
import { closeDb, getDb } from "../../src/store/db.js";

// Integration test for the #182 run-window bug: tool_log / agent_work rows are
// written with the SQLite `datetime('now')` default ("YYYY-MM-DD HH:MM:SS",
// a space, no ms/zone), but the run window was compared against an ISO
// `startedAt` ("…T…Z"). A space (0x20) sorts before 'T' (0x54) at index 10, so
// EVERY row was dropped and the verdict saw `toolCalls: 0`. These tests use a
// real migrated DB so the production created_at default is exercised.
const TEST_DB = "/tmp/paw-run-window-test.db";

describe("run verdict — timestamp window (real datetime('now') rows)", () => {
	const db = getDb(TEST_DB);
	const log = new ToolLog(db);

	afterAll(() => {
		closeDb();
		for (const ext of ["", "-journal", "-wal", "-shm"]) {
			try {
				unlinkSync(TEST_DB + ext);
			} catch {}
		}
	});

	test("a tool_log row written by datetime('now') is in-window (dropped pre-fix)", () => {
		const sessionId = "run-window-1";
		log.record({
			sessionId,
			toolName: "create_one_company",
			isError: false,
		});
		const rows = log.query({ sessionId, limit: 500 });
		expect(rows.length).toBe(1);

		const rowCreatedAt = rows[0].created_at;
		// The DB really wrote the space-format default (no 'T').
		expect(rowCreatedAt).not.toContain("T");

		// A run that started in the SAME wall-clock second as the row, in ISO form
		// (with 'T') — exactly what `new Date().toISOString()` produces in kernel.
		const startedAt = `${rowCreatedAt.replace(" ", "T")}.000Z`;

		// Pre-fix: raw ISO comparison wrongly EXCLUDES the in-window row.
		expect(rows.filter((e) => e.created_at >= startedAt).length).toBe(0);
		// Fix: normalize first → the row is INCLUDED.
		const inWindow = rows.filter(
			(e) => e.created_at >= sqliteStamp(startedAt),
		);
		expect(inWindow.length).toBe(1);

		// The verdict now SEES the successful mutating call: claim + real write → ok
		// (pre-fix the call was invisible, so the claim wrongly read as phantom).
		const verdict = computeRunVerdict({
			claimText: "Created the company.",
			toolEntries: inWindow.map((e) => ({
				tool_name: e.tool_name,
				is_error: e.is_error,
				output_preview: e.output_preview,
			})),
			sessionTasks: [],
		});
		expect(verdict.toolCalls).toBe(1);
		expect(verdict.verdict).toBe("ok");
	});

	test("an agent_work task written by datetime('now') is in-window (dropped pre-fix)", () => {
		const sessionId = "run-window-2";
		createTask(db, { title: "scan leads", session_id: sessionId });
		const tasks = listBySession(db, sessionId);
		expect(tasks.length).toBe(1);

		const taskCreatedAt = tasks[0].created_at;
		expect(taskCreatedAt).not.toContain("T");
		const startedAt = `${taskCreatedAt.replace(" ", "T")}.000Z`;

		// Pre-fix excludes, fix includes.
		expect(tasks.filter((t) => t.created_at >= startedAt).length).toBe(0);
		expect(
			tasks.filter((t) => t.created_at >= sqliteStamp(startedAt)).length,
		).toBe(1);
	});
});
