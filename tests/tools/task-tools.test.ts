import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createTaskTools } from "../../src/tools/task-tools.js";

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
			due_at TEXT, evidence TEXT, approval_id TEXT, session_id TEXT,
			agent_name TEXT, error TEXT, block_kind TEXT, operator_note TEXT, position INTEGER NOT NULL DEFAULT 0,
			last_escalated_at TEXT, created_by TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);
	return db;
}

/** Resolve a task tool's handler (asserted present once, so call sites stay clean). */
function handlerFor(name: string, db: Database) {
	const t = createTaskTools({ database: db }).find((x) => x.name === name);
	if (!t?.handler) throw new Error(`missing tool/handler ${name}`);
	return t.handler;
}

describe("task_update Done gate (tool surface)", () => {
	test("done without evidence returns is_error (not a throw, not a silent success)", async () => {
		const db = freshDb();
		const created = JSON.parse(
			(await handlerFor("task_create", db)({ title: "Ship" })).content,
		);
		const res = await handlerFor(
			"task_update",
			db,
		)({
			id: created.id,
			status: "done",
		});
		expect(res.is_error).toBe(true);
		expect(res.content.toLowerCase()).toContain("evidence");
		// the row must NOT have advanced to done
		const got = JSON.parse(
			(await handlerFor("task_get", db)({ id: created.id })).content,
		);
		expect(got.task.status).toBe("backlog");
	});

	test("done with evidence succeeds via the tool", async () => {
		const db = freshDb();
		const created = JSON.parse(
			(await handlerFor("task_create", db)({ title: "Ship" })).content,
		);
		const res = await handlerFor(
			"task_update",
			db,
		)({
			id: created.id,
			status: "done",
			evidence: "https://example.com/pr/9 merged",
		});
		expect(res.is_error).toBeFalsy();
		expect(JSON.parse(res.content).task.status).toBe("done");
	});
});

describe("task_update block_kind (help-leash)", () => {
	test("a blocked self-report persists block_kind for the board to route", async () => {
		const db = freshDb();
		const created = JSON.parse(
			(await handlerFor("task_create", db)({ title: "Ship" })).content,
		);
		const res = await handlerFor(
			"task_update",
			db,
		)({
			id: created.id,
			status: "blocked",
			error: "missing the API token",
			block_kind: "needs_access",
		});
		expect(res.is_error).toBeFalsy();
		const task = JSON.parse(res.content).task;
		expect(task.status).toBe("blocked");
		expect(task.block_kind).toBe("needs_access");
	});

	test("the block_kind enum is advertised to the model in the input schema", () => {
		const taskUpdate = createTaskTools({ database: freshDb() }).find(
			(t) => t.name === "task_update",
		);
		const prop = (
			taskUpdate?.input_schema as {
				properties: { block_kind?: { enum?: string[] } };
			}
		).properties.block_kind;
		expect(prop?.enum).toEqual([
			"needs_feedback",
			"needs_access",
			"needs_capability",
		]);
	});
});
