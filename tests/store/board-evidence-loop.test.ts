import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	advanceCardOnCompletion,
	createTask,
	getTask,
	linkCardOnDelegation,
	updateTask,
} from "../../src/store/agent-work.js";
import { createTaskTools } from "../../src/tools/task-tools.js";
import type { ToolDefinition } from "../../src/types/message.js";

// Phase 2a.1: the closed agent→evidence loop, exercised through the REAL
// task_update tool (the one the Start preamble instructs the agent to call) and
// the completion path. Proves task_update accepts the card id from a delegated
// run and that the gate still routes a no-evidence run to `blocked`.

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

function startedCard(db: Database, childSession: string) {
	const t = createTask(db, { title: "do a thing" });
	updateTask(db, t.id, { status: "queued" });
	updateTask(db, t.id, { status: "working", session_id: `task-${t.id}` });
	// The auto-advance subscriber re-points the card to the real child session.
	linkCardOnDelegation(db, `task-${t.id}`, childSession);
	return t.id;
}

function taskUpdateTool(db: Database): ToolDefinition {
	const tool = createTaskTools({ database: db }).find(
		(t) => t.name === "task_update",
	);
	if (!tool) throw new Error("task_update tool not found");
	return tool;
}

describe("board evidence loop (via the real task_update tool)", () => {
	test("happy path: task_update{done, evidence} by card id → card done", async () => {
		const db = freshDb();
		const id = startedCard(db, "agent-x-1");
		const taskUpdate = taskUpdateTool(db);

		const res = await taskUpdate.handler({
			id,
			status: "done",
			evidence: "https://example.com/pr/1 merged",
		});
		expect(res.is_error).toBeFalsy();
		expect(getTask(db, id)?.status).toBe("done");

		// Completion arrives after the agent proved its work — still done.
		expect(advanceCardOnCompletion(db, "agent-x-1", true)).toBe("done");
	});

	test("regression: task_update{done} with NO evidence is refused → blocked", async () => {
		const db = freshDb();
		const id = startedCard(db, "agent-x-2");
		const taskUpdate = taskUpdateTool(db);

		// The gate refuses a done without evidence; the tool surfaces is_error.
		const res = await taskUpdate.handler({ id, status: "done" });
		expect(res.is_error).toBe(true);
		expect(getTask(db, id)?.status).not.toBe("done");

		// The finished-but-unproven run lands blocked (unchanged from #183).
		expect(advanceCardOnCompletion(db, "agent-x-2", true)).toBe("blocked");
		expect(getTask(db, id)?.error).toContain("without evidence");
	});
});
