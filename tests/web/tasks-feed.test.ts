import { describe, expect, test } from "bun:test";
import type { AgentWork } from "../../src/store/agent-work.js";
import {
	TASK_COLUMNS,
	buildTasksFeed,
} from "../../src/web/routes/tasks-feed.js";

function row(over: Partial<AgentWork>): AgentWork {
	return {
		id: "id",
		title: "t",
		body: null,
		status: "backlog",
		priority: "normal",
		due_at: null,
		evidence: null,
		approval_id: null,
		session_id: null,
		agent_name: null,
		error: null,
		position: 0,
		last_escalated_at: null,
		created_by: null,
		created_at: "2026-06-21T10:00:00.000Z",
		updated_at: "2026-06-21T10:00:00.000Z",
		...over,
	};
}

describe("buildTasksFeed (pure)", () => {
	test("groups rows into the full set of status columns", () => {
		const feed = buildTasksFeed([
			row({ id: "a", status: "backlog" }),
			row({ id: "b", status: "working" }),
			row({ id: "c", status: "working" }),
		]);
		// Every known column exists, even empty ones.
		for (const col of TASK_COLUMNS) {
			expect(Array.isArray(feed.columns[col])).toBe(true);
		}
		expect(feed.columns.backlog.map((c) => c.id)).toEqual(["a"]);
		expect(feed.columns.working.map((c) => c.id)).toEqual(["b", "c"]);
		expect(feed.columns.queued).toEqual([]);
	});

	test("flags overdue cards but not done/failed past-due ones", () => {
		const now = Date.parse("2026-06-21T12:00:00.000Z");
		const feed = buildTasksFeed(
			[
				row({
					id: "late",
					status: "working",
					due_at: "2026-06-20T00:00:00.000Z",
				}),
				row({
					id: "ok",
					status: "working",
					due_at: "2026-06-22T00:00:00.000Z",
				}),
				row({
					id: "done",
					status: "done",
					evidence: "x",
					due_at: "2026-06-20T00:00:00.000Z",
				}),
			],
			now,
		);
		expect(feed.columns.working.find((c) => c.id === "late")?.overdue).toBe(
			true,
		);
		expect(feed.columns.working.find((c) => c.id === "ok")?.overdue).toBe(
			false,
		);
		expect(feed.columns.done.find((c) => c.id === "done")?.overdue).toBe(false);
	});

	test("version is the max updated_at across rows", () => {
		const feed = buildTasksFeed([
			row({ id: "a", updated_at: "2026-06-21T10:00:00.000Z" }),
			row({ id: "b", updated_at: "2026-06-21T11:30:00.000Z" }),
		]);
		expect(feed.version).toBe(Date.parse("2026-06-21T11:30:00.000Z"));
	});
});
