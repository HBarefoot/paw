import { describe, expect, test } from "bun:test";
import { AgentRegistry, withSkill } from "../../src/agents/registry.js";
import type { AgentDefinition } from "../../src/agents/types.js";

const mockLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
	return {
		name: "test-agent",
		description: "A test agent",
		systemPrompt: "You are a test agent.",
		skills: ["files"],
		...overrides,
	};
}

describe("AgentRegistry", () => {
	test("register and retrieve an agent", () => {
		const registry = new AgentRegistry(mockLogger);
		const agent = makeAgent();
		registry.register(agent);

		expect(registry.get("test-agent")).toEqual(agent);
		expect(registry.has("test-agent")).toBe(true);
		expect(registry.size).toBe(1);
	});

	test("list all agents", () => {
		const registry = new AgentRegistry(mockLogger);
		registry.register(makeAgent({ name: "a" }));
		registry.register(makeAgent({ name: "b" }));

		const list = registry.list();
		expect(list).toHaveLength(2);
		expect(list.map((a) => a.name).sort()).toEqual(["a", "b"]);
	});

	test("agentNames returns names", () => {
		const registry = new AgentRegistry(mockLogger);
		registry.register(makeAgent({ name: "alpha" }));
		registry.register(makeAgent({ name: "beta" }));

		expect(registry.agentNames.sort()).toEqual(["alpha", "beta"]);
	});

	test("get returns undefined for unknown agent", () => {
		const registry = new AgentRegistry(mockLogger);
		expect(registry.get("nonexistent")).toBeUndefined();
		expect(registry.has("nonexistent")).toBe(false);
	});

	test("remove an agent", () => {
		const registry = new AgentRegistry(mockLogger);
		registry.register(makeAgent({ name: "removable" }));

		expect(registry.remove("removable")).toBe(true);
		expect(registry.has("removable")).toBe(false);
		expect(registry.size).toBe(0);
	});

	test("remove returns false for unknown agent", () => {
		const registry = new AgentRegistry(mockLogger);
		expect(registry.remove("ghost")).toBe(false);
	});

	test("overwrite existing agent on re-register", () => {
		const registry = new AgentRegistry(mockLogger);
		registry.register(makeAgent({ description: "v1" }));
		registry.register(makeAgent({ description: "v2" }));

		expect(registry.get("test-agent")?.description).toBe("v2");
		expect(registry.size).toBe(1);
	});

	test("loadFromConfig loads multiple agents", () => {
		const registry = new AgentRegistry(mockLogger);
		registry.loadFromConfig({
			"icp-discovery": {
				description: "Discovers leads",
				systemPrompt: "You find leads.",
				skills: ["icp-discovery"],
			},
			researcher: {
				description: "Researches topics",
				systemPrompt: "You research.",
				skills: ["web-pilot"],
			},
		});

		expect(registry.size).toBe(2);
		expect(registry.get("icp-discovery")?.skills).toEqual(["icp-discovery"]);
		expect(registry.get("researcher")?.description).toBe("Researches topics");
	});
});

describe("withSkill", () => {
	test("appends a missing skill (board runs get `tasks`)", () => {
		const base = makeAgent({ skills: ["files"] });
		const got = withSkill(base, "tasks");
		expect(got.skills).toContain("tasks");
		expect(got.skills).toEqual(["files", "tasks"]);
		// pure: the base definition is untouched.
		expect(base.skills).toEqual(["files"]);
	});

	test("idempotent — already-present skill returns the agent unchanged", () => {
		const base = makeAgent({ skills: ["files", "tasks"] });
		const got = withSkill(base, "tasks");
		expect(got).toBe(base); // same reference, no copy
		expect(got.skills).toEqual(["files", "tasks"]);
	});
});
