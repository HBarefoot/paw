import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { withSkill } from "../../src/agents/registry.js";
import type { AgentDefinition } from "../../src/agents/types.js";
import { SkillManager } from "../../src/ai/skills.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import { createTaskTools } from "../../src/tools/task-tools.js";

// Phase 2a.1: a board-started run must be able to call task_update/task_get to
// record evidence — but the `tasks` skill is on-demand (#180). The fix pre-
// activates `tasks` for the delegated run by handing runAgentTurn an agent whose
// skills include it (app.ts wraps the configured agent with `withSkill(.,"tasks")`).
// This test reproduces what kernel.runAgentTurn does (activate each agent.skills
// entry on the child session) and asserts the task tools become reachable.

function buildSkillManager(): SkillManager {
	const registry = new ToolRegistry();
	// task_* tools group under the on-demand `tasks` skill.
	registry.register(createTaskTools({ database: new Database(":memory:") }));
	const sm = new SkillManager();
	sm.buildFromRegistry(registry);
	return sm;
}

// A configured agent that does NOT carry the tasks skill (the realistic default).
const baseAgent: AgentDefinition = {
	name: "default",
	description: "default agent",
	systemPrompt: "do work",
	skills: ["files"],
};

// Mirror kernel.runAgentTurn's pre-activation loop for a given agent + session.
function activateAgentSkills(
	sm: SkillManager,
	agent: AgentDefinition,
	sessionId: string,
): void {
	for (const skill of agent.skills) sm.activateSkill(sessionId, skill);
}

describe("board run → tasks skill reachability", () => {
	test("`tasks` groups task_update/task_get under one on-demand skill", () => {
		const sm = buildSkillManager();
		expect(sm.skillNameForTool("task_update")).toBe("tasks");
		expect(sm.skillNameForTool("task_get")).toBe("tasks");
		expect(sm.getSkill("tasks")?.alwaysActive).toBe(false); // on-demand (#180)
	});

	test("a board run (agent wrapped with withSkill) can call task_update", () => {
		const sm = buildSkillManager();
		const sid = "agent-default-1";
		activateAgentSkills(sm, withSkill(baseAgent, "tasks"), sid);
		const tools = sm.getActiveToolNames(sid);
		expect(tools.has("task_update")).toBe(true);
		expect(tools.has("task_get")).toBe(true);
	});

	test("pre-change (bare agent, no tasks skill) cannot — guards the regression", () => {
		const sm = buildSkillManager();
		const sid = "agent-default-2";
		activateAgentSkills(sm, baseAgent, sid); // no withSkill wrap
		const tools = sm.getActiveToolNames(sid);
		expect(tools.has("task_update")).toBe(false);
		expect(tools.has("task_get")).toBe(false);
	});
});
