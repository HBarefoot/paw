import { describe, expect, test } from "bun:test";
import { SkillManager } from "../../src/ai/skills.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import { createCanvasTools } from "../../src/tools/canvas-tools.js";

describe("SkillManager canvas grouping", () => {
	function buildManager(): SkillManager {
		const registry = new ToolRegistry();
		// Canvas tools carry plugin: "kernel" but must group under "canvas".
		registry.register(createCanvasTools({ canvasRoot: "/tmp/paw-canvas-test" }));
		const skills = new SkillManager();
		skills.buildFromRegistry(registry);
		return skills;
	}

	test("canvas tools group under a dedicated 'canvas' skill", () => {
		const skill = buildManager().getSkill("canvas");
		expect(skill).toBeDefined();
		expect(skill!.toolNames).toContain("canvas_write");
		expect(skill!.toolNames).toContain("canvas_read");
		expect(skill!.toolNames).toContain("canvas_list");
	});

	test("the 'canvas' skill is always-active (native, no activation needed)", () => {
		expect(buildManager().getSkill("canvas")!.alwaysActive).toBe(true);
	});

	test("canvas tools are NOT lumped into the 'files' skill", () => {
		const files = buildManager().getSkill("files");
		// No file/exec tools registered here, so there should be no "files"
		// skill at all — canvas must not have leaked into it.
		expect(files?.toolNames ?? []).not.toContain("canvas_write");
	});
});
