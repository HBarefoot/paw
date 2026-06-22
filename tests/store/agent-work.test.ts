import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	TaskError,
	createTask,
	listEscalatable,
	markEscalated,
	updateTask,
} from "../../src/store/agent-work.js";

/** In-memory DB with the agent_work schema (mirrors runMigrations in db.ts). */
function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE agent_work (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			body TEXT,
			status TEXT NOT NULL DEFAULT 'backlog'
				CHECK(status IN ('backlog','queued','working','needs_approval','blocked','done','failed')),
			priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
			due_at TEXT,
			evidence TEXT,
			approval_id TEXT,
			session_id TEXT,
			agent_name TEXT,
			error TEXT,
			position INTEGER NOT NULL DEFAULT 0,
			last_escalated_at TEXT,
			created_by TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE INDEX idx_agent_work_status ON agent_work(status, position);
	`);
	return db;
}

describe("agent-work verification gate", () => {
	test("transition to done with empty evidence throws TaskError", () => {
		const db = freshDb();
		const t = createTask(db, { title: "Ship the feed" });
		expect(() => updateTask(db, t.id, { status: "done" })).toThrow(TaskError);
		// whitespace-only evidence is still rejected
		expect(() =>
			updateTask(db, t.id, { status: "done", evidence: "   " }),
		).toThrow(TaskError);
		// row was not mutated to done
		const after = updateTask(db, t.id, {});
		expect(after?.status).toBe("backlog");
	});

	test("done with real evidence succeeds", () => {
		const db = freshDb();
		const t = createTask(db, { title: "Ship the feed" });
		const done = updateTask(db, t.id, {
			status: "done",
			evidence: "https://example.com/pr/1 merged; tests green",
		});
		expect(done?.status).toBe("done");
		expect(done?.evidence).toContain("merged");
	});

	test("evidence already present lets a later status:done through", () => {
		const db = freshDb();
		const t = createTask(db, { title: "Two-step" });
		updateTask(db, t.id, { evidence: "diff attached" });
		const done = updateTask(db, t.id, { status: "done" });
		expect(done?.status).toBe("done");
	});

	test("failed may carry an error and needs no evidence", () => {
		const db = freshDb();
		const t = createTask(db, { title: "Risky" });
		const failed = updateTask(db, t.id, {
			status: "failed",
			error: "build broke",
		});
		expect(failed?.status).toBe("failed");
		expect(failed?.error).toBe("build broke");
	});
});

describe("agent-work escalation", () => {
	test("listEscalatable returns overdue + blocked, excludes done/failed and fresh-escalated", () => {
		const db = freshDb();
		const now = "2026-06-21T12:00:00.000Z";
		const past = "2026-06-20T12:00:00.000Z";
		const future = "2026-06-22T12:00:00.000Z";

		const overdue = createTask(db, { title: "Overdue", due_at: past });
		const blocked = createTask(db, { title: "Blocked" });
		updateTask(db, blocked.id, { status: "blocked" });
		const notDue = createTask(db, { title: "Future", due_at: future });
		const overdueButDone = createTask(db, {
			title: "Done-overdue",
			due_at: past,
		});
		updateTask(db, overdueButDone.id, {
			status: "done",
			evidence: "shipped",
		});

		const ids = listEscalatable(db, now)
			.map((t) => t.id)
			.sort();
		expect(ids).toEqual([overdue.id, blocked.id].sort());
		expect(ids).not.toContain(notDue.id);
		expect(ids).not.toContain(overdueButDone.id);
	});

	test("markEscalated dedupes within the window but re-fires after it", () => {
		const db = freshDb();
		const now = "2026-06-21T12:00:00.000Z";
		const past = "2026-06-20T12:00:00.000Z";
		const t = createTask(db, { title: "Overdue", due_at: past });

		expect(listEscalatable(db, now).map((r) => r.id)).toContain(t.id);
		// escalate "now", then a check 1h later should skip it (default 6h window)
		markEscalated(db, t.id, now);
		const oneHourLater = "2026-06-21T13:00:00.000Z";
		expect(listEscalatable(db, oneHourLater).map((r) => r.id)).not.toContain(
			t.id,
		);
		// 7h later it re-surfaces
		const sevenHoursLater = "2026-06-21T19:00:01.000Z";
		expect(listEscalatable(db, sevenHoursLater).map((r) => r.id)).toContain(
			t.id,
		);
	});
});
