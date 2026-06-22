import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SkillManager } from "../../src/ai/skills.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import {
	cronCardTurn,
	prepareCronCardRun,
} from "../../src/kernel/cron-card-run.js";
import { getCronCard } from "../../src/store/agent-work.js";
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
			agent_name TEXT, error TEXT, position INTEGER NOT NULL DEFAULT 0,
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
