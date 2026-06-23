import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SkillManager } from "../../src/ai/skills.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import {
	cronCardTurn,
	prepareCronCardRun,
} from "../../src/kernel/cron-card-run.js";
import { getCronCard, updateTask } from "../../src/store/agent-work.js";
import { createTaskTools } from "../../src/tools/task-tools.js";

// Phase 2c.1 — a cron run is told which durable card it's on + to prove its work,
// and the `tasks` skill is pre-activated so it can self-report via task_update.
// Mirrors 2a.1's board-run-tasks-skill seam test.

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

function skillManagerWithTasks(db: Database): SkillManager {
	const registry = new ToolRegistry();
	registry.register(createTaskTools({ database: db }));
	const sm = new SkillManager();
	sm.buildFromRegistry(registry);
	return sm;
}

describe("cronCardTurn", () => {
	test("names the card and demands evidence (both done + blocked paths)", () => {
		const turn = cronCardTurn("card-123", "sweep the leads");
		expect(turn).toContain("card-123");
		expect(turn).toContain("task_update");
		expect(turn).toContain("evidence");
		expect(turn).toContain('status: "blocked"');
		expect(turn).toContain("sweep the leads"); // original prompt rides the turn
	});

	test("preamble asks the agent to categorize the block (block_kind enum)", () => {
		const turn = cronCardTurn("card-123", "sweep the leads");
		// Help-leash Phase 1: a blocked self-report must carry a block_kind so the
		// board can route it. Fails on pre-change preamble (no block_kind ask).
		expect(turn).toContain("block_kind");
		expect(turn).toContain("needs_feedback");
		expect(turn).toContain("needs_access");
		expect(turn).toContain("needs_capability");
	});

	test("operator feedback (help-leash) leads the prompt body when present", () => {
		const turn = cronCardTurn(
			"card-123",
			"sweep the leads",
			"use the v2 endpoint, not v1",
		);
		expect(turn).toContain("Operator feedback: use the v2 endpoint, not v1");
		// The note sits with the prompt body (after the preamble divider), ahead of
		// the original prompt so the retry sees it first.
		const noteIdx = turn.indexOf("Operator feedback:");
		const promptIdx = turn.indexOf("sweep the leads");
		expect(noteIdx).toBeGreaterThan(-1);
		expect(noteIdx).toBeLessThan(promptIdx);
	});

	test("no operator note → no 'Operator feedback:' line (bare prompt body)", () => {
		expect(cronCardTurn("c", "do it")).not.toContain("Operator feedback:");
		expect(cronCardTurn("c", "do it", "   ")).not.toContain(
			"Operator feedback:",
		);
		expect(cronCardTurn("c", "do it", null)).not.toContain(
			"Operator feedback:",
		);
	});
});

describe("prepareCronCardRun", () => {
	test("creates the card, activates `tasks`, returns the card-context turn", () => {
		const db = freshDb();
		const sm = skillManagerWithTasks(db);
		const turn = prepareCronCardRun({
			db,
			skillManager: sm,
			jobId: "job-1",
			jobName: "Daily lead sweep",
			sessionId: "cron-job-1-1000",
			prompt: "sweep the leads",
		});

		const card = getCronCard(db, "job-1");
		expect(card?.status).toBe("working");
		// The turn names the durable card the agent must update.
		expect(turn).toContain(card?.id as string);
		expect(turn).toContain("sweep the leads");
		// `tasks` is reachable for the cron session so it can self-report.
		const tools = sm.getActiveToolNames("cron-job-1-1000");
		expect(tools.has("task_update")).toBe(true);
		expect(tools.has("task_get")).toBe(true);
	});

	test("a re-fire after an operator resume injects the persisted note", () => {
		const db = freshDb();
		const sm = skillManagerWithTasks(db);
		// First fire creates the card.
		prepareCronCardRun({
			db,
			skillManager: sm,
			jobId: "job-1",
			jobName: "Daily lead sweep",
			sessionId: "cron-job-1-1000",
			prompt: "sweep the leads",
		});
		const card = getCronCard(db, "job-1");
		// Operator resumes with feedback (persisted on the durable card).
		updateTask(db, card?.id as string, {
			operator_note: "use the v2 endpoint",
			block_kind: null,
		});
		// Next scheduled fire: upsert preserves the note → it rides the new turn.
		const turn = prepareCronCardRun({
			db,
			skillManager: sm,
			jobId: "job-1",
			jobName: "Daily lead sweep",
			sessionId: "cron-job-1-2000",
			prompt: "sweep the leads",
		});
		expect(turn).toContain("Operator feedback: use the v2 endpoint");
	});

	test("fail-open: card creation fails → bare prompt, no skill change, no throw", () => {
		const db = new Database(":memory:"); // no agent_work table → upsert fails
		const sm = skillManagerWithTasks(db);
		let turn = "";
		expect(() => {
			turn = prepareCronCardRun({
				db,
				skillManager: sm,
				jobId: "job-1",
				jobName: "x",
				sessionId: "cron-job-1-1000",
				prompt: "do it",
			});
		}).not.toThrow();
		expect(turn).toBe("do it"); // ran with the bare prompt
		expect(sm.getActiveToolNames("cron-job-1-1000").has("task_update")).toBe(
			false,
		);
	});
});
