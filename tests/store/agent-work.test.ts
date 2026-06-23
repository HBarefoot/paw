import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	TaskError,
	createTask,
	getCronCard,
	getTask,
	listEscalatable,
	markEscalated,
	move,
	updateTask,
	upsertCronCard,
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
			block_kind TEXT,
			operator_note TEXT,
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

describe("help-leash: block_kind + operator_note", () => {
	test("updateTask persists block_kind and operator_note", () => {
		const db = freshDb();
		const t = createTask(db, { title: "Sweep" });
		const blocked = updateTask(db, t.id, {
			status: "blocked",
			block_kind: "needs_feedback",
			operator_note: "which region?",
		});
		expect(blocked?.status).toBe("blocked");
		expect(blocked?.block_kind).toBe("needs_feedback");
		expect(blocked?.operator_note).toBe("which region?");
	});

	test("consumed-feedback hygiene: status→done via updateTask drops the note", () => {
		const db = freshDb();
		const t = createTask(db, { title: "Sweep" });
		updateTask(db, t.id, {
			status: "blocked",
			block_kind: "needs_feedback",
			operator_note: "use v2",
		});
		const done = updateTask(db, t.id, {
			status: "done",
			evidence: "https://example.com/pr/9 merged",
		});
		expect(done?.status).toBe("done");
		// The note was consumed by the successful run — it must not linger and
		// replay on a future re-run of the same card.
		expect(done?.operator_note).toBeNull();
	});

	test("an explicit operator_note on the done patch wins over the auto-clear", () => {
		const db = freshDb();
		const t = createTask(db, { title: "Sweep" });
		updateTask(db, t.id, { operator_note: "old" });
		const done = updateTask(db, t.id, {
			status: "done",
			evidence: "shipped",
			operator_note: "kept",
		});
		expect(done?.operator_note).toBe("kept");
	});

	test("consumed-feedback hygiene: move→done also drops the note", () => {
		const db = freshDb();
		const t = createTask(db, { title: "Sweep" });
		// Park a working card with evidence + a note, then move it to done.
		updateTask(db, t.id, {
			status: "working",
			evidence: "diff attached",
			operator_note: "use v2",
		});
		const done = move(db, t.id, "done", 0);
		expect(done?.status).toBe("done");
		expect(done?.operator_note).toBeNull();
	});

	test("a non-done update leaves the operator_note untouched", () => {
		const db = freshDb();
		const t = createTask(db, { title: "Sweep" });
		updateTask(db, t.id, { operator_note: "keep me", status: "blocked" });
		// An unrelated patch (e.g. priority) must not clear the note.
		const after = updateTask(db, t.id, { priority: "high" });
		expect(after?.operator_note).toBe("keep me");
	});
});

describe("help-leash: cron re-fire preserves operator feedback", () => {
	test("a re-fire resets run state but PRESERVES operator_note (resets block_kind)", () => {
		const db = freshDb();
		// First fire creates the durable cron card.
		const id = upsertCronCard(db, {
			jobId: "job-1",
			jobName: "Daily sweep",
			sessionId: "cron-job-1-1000",
			prompt: "sweep",
		});
		expect(id).not.toBeNull();
		// The run blocks and the operator leaves feedback on the durable card.
		updateTask(db, id as string, {
			status: "blocked",
			block_kind: "needs_feedback",
			operator_note: "use the v2 endpoint",
		});
		// Next scheduled fire re-fires the SAME card.
		const id2 = upsertCronCard(db, {
			jobId: "job-1",
			jobName: "Daily sweep",
			sessionId: "cron-job-1-2000",
			prompt: "sweep",
		});
		expect(id2).toBe(id);
		const card = getCronCard(db, "job-1");
		expect(card?.status).toBe("working");
		expect(card?.session_id).toBe("cron-job-1-2000");
		// Run state reset, but the operator note survives so the new run sees it.
		expect(card?.block_kind).toBeNull();
		expect(card?.operator_note).toBe("use the v2 endpoint");
		expect(card?.error).toBeNull();
	});

	test("once the cron card reaches done, the note is dropped (not replayed)", () => {
		const db = freshDb();
		const id = upsertCronCard(db, {
			jobId: "job-1",
			jobName: "Daily sweep",
			sessionId: "cron-job-1-1000",
			prompt: "sweep",
		}) as string;
		updateTask(db, id, { operator_note: "use v2" });
		updateTask(db, id, { status: "done", evidence: "swept 9 leads" });
		expect(getTask(db, id)?.operator_note).toBeNull();
	});
});
