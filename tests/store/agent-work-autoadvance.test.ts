import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	advanceCardOnCompletion,
	createTask,
	getTask,
	linkCardOnDelegation,
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
			agent_name TEXT, error TEXT, position INTEGER NOT NULL DEFAULT 0,
			last_escalated_at TEXT, created_by TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);
	return db;
}

// A started card: queued → working with the synthetic parent session marker.
function startedCard(db: Database) {
	const t = createTask(db, { title: "do a thing" });
	updateTask(db, t.id, { status: "queued" });
	updateTask(db, t.id, { status: "working", session_id: `task-${t.id}` });
	return t.id;
}

describe("linkCardOnDelegation", () => {
	test("re-points the card to the child session and keeps it working", () => {
		const db = freshDb();
		const id = startedCard(db);
		linkCardOnDelegation(db, `task-${id}`, "agent-default-123");
		const card = getTask(db, id);
		expect(card?.session_id).toBe("agent-default-123");
		expect(card?.status).toBe("working");
	});

	test("ignores non-task parent sessions", () => {
		const db = freshDb();
		const id = startedCard(db);
		linkCardOnDelegation(db, "web-1", "agent-default-999");
		expect(getTask(db, id)?.session_id).toBe(`task-${id}`); // untouched
	});
});

describe("advanceCardOnCompletion — the evidence gate is sacred", () => {
	test("ok + evidence → done", () => {
		const db = freshDb();
		const id = startedCard(db);
		linkCardOnDelegation(db, `task-${id}`, "agent-x-1");
		// Agent set evidence via task_update mid-run.
		updateTask(db, id, { evidence: "https://example.com/pr/1 merged" });
		const status = advanceCardOnCompletion(db, "agent-x-1", true);
		expect(status).toBe("done");
		expect(getTask(db, id)?.status).toBe("done");
	});

	test("ok + NO evidence → blocked (NOT done)", () => {
		const db = freshDb();
		const id = startedCard(db);
		linkCardOnDelegation(db, `task-${id}`, "agent-x-2");
		const status = advanceCardOnCompletion(db, "agent-x-2", true);
		expect(status).toBe("blocked");
		const card = getTask(db, id);
		expect(card?.status).toBe("blocked");
		expect(card?.error).toContain("without evidence");
	});

	test("error → failed (stores the error)", () => {
		const db = freshDb();
		const id = startedCard(db);
		linkCardOnDelegation(db, `task-${id}`, "agent-x-3");
		const status = advanceCardOnCompletion(db, "agent-x-3", false, "boom");
		expect(status).toBe("failed");
		expect(getTask(db, id)?.error).toBe("boom");
	});

	test("no matching card → null (no throw)", () => {
		const db = freshDb();
		expect(advanceCardOnCompletion(db, "unknown-session", true)).toBeNull();
	});

	test("fail-open: a broken db is swallowed (onError called, no throw)", () => {
		const db = freshDb();
		db.close(); // every query now throws
		let sawError = false;
		let res: unknown;
		expect(() => {
			res = advanceCardOnCompletion(db, "s", true, undefined, () => {
				sawError = true;
			});
		}).not.toThrow();
		expect(res).toBeNull();
		expect(sawError).toBe(true);
	});
});
