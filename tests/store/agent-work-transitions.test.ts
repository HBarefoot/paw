import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	TaskError,
	TransitionError,
	createTask,
	isLegalTransition,
	move,
	updateTask,
} from "../../src/store/agent-work.js";

function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE agent_work (
			id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT,
			status TEXT NOT NULL DEFAULT 'backlog'
				CHECK(status IN ('backlog','queued','working','needs_approval','blocked','done','failed')),
			priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
			due_at TEXT, evidence TEXT, approval_id TEXT, session_id TEXT,
			agent_name TEXT, error TEXT, block_kind TEXT, operator_note TEXT, position INTEGER NOT NULL DEFAULT 0,
			last_escalated_at TEXT, created_by TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);
	return db;
}

describe("isLegalTransition matrix", () => {
	test("legal user + system transitions", () => {
		expect(isLegalTransition("backlog", "queued")).toBe(true);
		expect(isLegalTransition("queued", "backlog")).toBe(true);
		expect(isLegalTransition("queued", "working")).toBe(true);
		expect(isLegalTransition("working", "done")).toBe(true);
		expect(isLegalTransition("working", "blocked")).toBe(true);
		expect(isLegalTransition("working", "failed")).toBe(true);
		expect(isLegalTransition("blocked", "queued")).toBe(true);
		expect(isLegalTransition("failed", "queued")).toBe(true);
		expect(isLegalTransition("queued", "queued")).toBe(true); // reorder
	});

	test("illegal jumps", () => {
		expect(isLegalTransition("backlog", "working")).toBe(false);
		expect(isLegalTransition("backlog", "done")).toBe(false);
		expect(isLegalTransition("done", "queued")).toBe(false);
		expect(isLegalTransition("done", "working")).toBe(false);
		expect(isLegalTransition("queued", "done")).toBe(false);
	});
});

describe("move() enforces transitions + the evidence gate", () => {
	test("legal move succeeds", () => {
		const db = freshDb();
		const t = createTask(db, { title: "x" });
		updateTask(db, t.id, { status: "queued" }); // backlog→queued via permissive updateTask
		const moved = move(db, t.id, "backlog", 0); // queued→backlog (legal drag)
		expect(moved?.status).toBe("backlog");
	});

	test("illegal jump throws TransitionError", () => {
		const db = freshDb();
		const t = createTask(db, { title: "x" }); // backlog
		expect(() => move(db, t.id, "working", 0)).toThrow(TransitionError);
	});

	test("done→queued throws TransitionError", () => {
		const db = freshDb();
		const t = createTask(db, { title: "x" });
		// Get to done legitimately (with evidence) via the permissive tool path.
		updateTask(db, t.id, { status: "queued" });
		updateTask(db, t.id, { status: "working" });
		updateTask(db, t.id, { status: "done", evidence: "proof" });
		expect(() => move(db, t.id, "queued", 0)).toThrow(TransitionError);
	});

	test("working→done without evidence throws the gate (not weakened)", () => {
		const db = freshDb();
		const t = createTask(db, { title: "x" });
		updateTask(db, t.id, { status: "queued" });
		updateTask(db, t.id, { status: "working" });
		expect(() => move(db, t.id, "done", 0)).toThrow(TaskError);
	});

	test("same-column reorder is allowed (position only)", () => {
		const db = freshDb();
		const t = createTask(db, { title: "x" }); // backlog
		const moved = move(db, t.id, "backlog", 5);
		expect(moved?.position).toBe(5);
	});
});
