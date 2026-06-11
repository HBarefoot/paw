import { beforeEach, describe, expect, test } from "bun:test";
import { SkillManager } from "../../src/ai/skills.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import type { ToolDefinition } from "../../src/types/message.js";

const tool = (name: string, plugin: string): ToolDefinition => ({
	name,
	description: `${name} desc`,
	plugin,
	input_schema: { type: "object", properties: {} },
	handler: async () => ({ content: "" }),
});

function buildManager(): SkillManager {
	const registry = new ToolRegistry();
	registry.register([
		tool("canvas_write", "kernel"), // → canvas (always-on)
		tool("memory_recall", "kernel"), // → memory (always-on)
		tool("spawn_agent", "kernel"), // → core (always-on)
		tool("file_read", "kernel"), // → files (deferred)
		tool("browser_navigate", "web-pilot"), // → web-pilot (deferred)
		tool("mcp__n8n__run", "mcp:n8n"), // → mcp:n8n (deferred)
	]);
	const sm = new SkillManager();
	sm.buildFromRegistry(registry);
	return sm;
}

describe("SkillManager.deriveSkillName (via skillNameForTool)", () => {
	const sm = buildManager();
	test("canvas_* groups under always-active canvas skill (B4 regression)", () => {
		expect(sm.skillNameForTool("canvas_write")).toBe("canvas");
		expect(sm.getSkill("canvas")?.alwaysActive).toBe(true);
	});
	test("kernel tools map to memory / core / files by name", () => {
		expect(sm.skillNameForTool("memory_recall")).toBe("memory");
		expect(sm.skillNameForTool("spawn_agent")).toBe("core");
		expect(sm.skillNameForTool("file_read")).toBe("files");
	});
	test("plugin tools map to their plugin / mcp server", () => {
		expect(sm.skillNameForTool("browser_navigate")).toBe("web-pilot");
		expect(sm.skillNameForTool("mcp__n8n__run")).toBe("mcp:n8n");
	});
	test("unknown tool → undefined", () => {
		expect(sm.skillNameForTool("nope")).toBeUndefined();
	});
});

describe("SkillManager always-on set", () => {
	test("memory, core, canvas are always active; others are not", () => {
		const sm = buildManager();
		const alwaysOn = sm
			.getAllSkills()
			.filter((s) => s.alwaysActive)
			.map((s) => s.name)
			.sort();
		expect(alwaysOn).toEqual(["canvas", "core", "memory"]);
		expect(sm.getSkill("files")?.alwaysActive).toBe(false);
		expect(sm.getSkill("web-pilot")?.alwaysActive).toBe(false);
		expect(sm.getSkill("mcp:n8n")?.alwaysActive).toBe(false);
	});
});

describe("SkillManager activation", () => {
	let sm: SkillManager;
	beforeEach(() => {
		sm = buildManager();
	});

	test("with nothing activated, only always-on tools are available", () => {
		const tools = sm.getActiveToolNames("s1");
		expect(tools.has("canvas_write")).toBe(true);
		expect(tools.has("memory_recall")).toBe(true);
		expect(tools.has("spawn_agent")).toBe(true);
		expect(tools.has("browser_navigate")).toBe(false);
		expect(tools.has("mcp__n8n__run")).toBe(false);
	});

	test("activateSkill activates exactly the requested group", () => {
		const entry = sm.activateSkill("s1", "web-pilot");
		expect(entry?.name).toBe("web-pilot");
		const tools = sm.getActiveToolNames("s1");
		expect(tools.has("browser_navigate")).toBe(true); // now active
		expect(tools.has("mcp__n8n__run")).toBe(false); // a different group stays off
	});

	test("unknown skill → null, nothing activated", () => {
		expect(sm.activateSkill("s1", "ghost")).toBeNull();
		expect(sm.getActiveToolNames("s1").has("mcp__n8n__run")).toBe(false);
	});

	test("activation is per-session and resets on clearSession", () => {
		sm.activateSkill("s1", "web-pilot");
		// Different session is unaffected.
		expect(sm.getActiveToolNames("s2").has("browser_navigate")).toBe(false);
		// Clearing s1 returns it to always-on only.
		sm.clearSession("s1");
		expect(sm.getActiveToolNames("s1").has("browser_navigate")).toBe(false);
		expect(sm.getActiveToolNames("s1").has("canvas_write")).toBe(true);
	});
});
