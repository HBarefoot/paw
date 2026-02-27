import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../../src/agents/registry.js";
import { createSpawnAgentTool } from "../../src/agents/spawn-agent-tool.js";
import type {
	AgentDefinition,
	AgentRunResult,
} from "../../src/agents/types.js";
import type { StreamChunk } from "../../src/ai/base-provider.js";
import { SkillManager } from "../../src/ai/skills.js";
import { ToolRegistry } from "../../src/ai/tools.js";

const mockLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};

function setupSpawnTool(
	runResult: AgentRunResult = {
		text: "Task completed successfully.",
		sessionId: "agent-test-123",
		ok: true,
	},
	streamChunks: StreamChunk[] = [],
) {
	const registry = new AgentRegistry(mockLogger);
	registry.register({
		name: "icp-discovery",
		description: "Discovers franchise leads",
		systemPrompt: "You discover ICP leads.",
		skills: ["icp-discovery"],
	});

	const skillManager = new SkillManager();
	// Register a minimal tool so skill manager has something
	const toolRegistry = new ToolRegistry(mockLogger);
	toolRegistry.register([
		{
			name: "test_tool",
			description: "A test tool",
			input_schema: { type: "object", properties: {} },
			plugin: "test-plugin",
			handler: async () => ({ content: "ok" }),
		},
	]);
	skillManager.buildFromRegistry(toolRegistry);

	const calls: Array<{
		agent: AgentDefinition;
		task: string;
		parentSessionId: string;
	}> = [];
	const streamCalls: typeof calls = [];

	const agentDepths = new Map<string, number>();

	const tool = createSpawnAgentTool({
		agentRegistry: registry,
		skillManager,
		agentDepths,
		maxAgentDepth: 3,
		runAgentTurn: async (agent, task, parentSessionId) => {
			calls.push({ agent, task, parentSessionId });
			return runResult;
		},
		runAgentTurnStream: async function* (agent, task, parentSessionId) {
			streamCalls.push({ agent, task, parentSessionId });
			for (const chunk of streamChunks) {
				yield chunk;
			}
			return runResult;
		},
	});

	return { tool, calls, streamCalls, registry, agentDepths };
}

describe("spawn_agent tool", () => {
	test("has correct schema", () => {
		const { tool } = setupSpawnTool();

		expect(tool.name).toBe("spawn_agent");
		expect(tool.plugin).toBe("kernel");
		expect(tool.input_schema.required).toEqual(["name", "task"]);

		const props = tool.input_schema.properties as Record<
			string,
			{ type: string }
		>;
		expect(props.name.type).toBe("string");
		expect(props.task.type).toBe("string");
		expect(props.system_prompt.type).toBe("string");
		expect(props.skills.type).toBe("array");
	});

	test("description includes presets and available skills", () => {
		const { tool } = setupSpawnTool();

		expect(tool.description).toContain("icp-discovery");
		expect(tool.description).toContain("Discovers franchise leads");
		expect(tool.description).toContain("Available skills");
	});

	test("spawns agent dynamically and returns result", async () => {
		const { tool, calls } = setupSpawnTool();

		const result = await tool.handler({
			name: "my-researcher",
			task: "Research something important",
			system_prompt: "You are a researcher.",
			skills: ["memory"],
			__sessionId: "parent-session-1",
		});

		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain('Agent "my-researcher" completed');
		expect(result.content).toContain("Task completed successfully.");
		expect(calls).toHaveLength(1);
		expect(calls[0].agent.name).toBe("my-researcher");
		expect(calls[0].agent.systemPrompt).toBe("You are a researcher.");
		expect(calls[0].agent.skills).toEqual(["memory"]);
		expect(calls[0].task).toBe("Research something important");
		expect(calls[0].parentSessionId).toBe("parent-session-1");
	});

	test("returns error for empty task", async () => {
		const { tool } = setupSpawnTool();

		const result = await tool.handler({
			name: "test",
			task: "",
		});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("cannot be empty");
	});

	test("returns error for missing name", async () => {
		const { tool } = setupSpawnTool();

		const result = await tool.handler({
			task: "Do something",
		});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("name is required");
	});

	test("returns error when agent run fails", async () => {
		const { tool } = setupSpawnTool({
			text: "",
			sessionId: "agent-fail-123",
			ok: false,
			error: "Provider timeout",
		});

		const result = await tool.handler({
			name: "doomed-agent",
			task: "A doomed task",
			__sessionId: "parent-1",
		});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("failed");
		expect(result.content).toContain("Provider timeout");
	});

	test("uses 'unknown' when no __sessionId provided", async () => {
		const { tool, calls } = setupSpawnTool();

		await tool.handler({
			name: "test-agent",
			task: "No session context",
		});

		expect(calls[0].parentSessionId).toBe("unknown");
	});

	test("streamHandler is present when runAgentTurnStream is provided", () => {
		const { tool } = setupSpawnTool();
		expect(tool.streamHandler).toBeDefined();
	});

	test("streamHandler yields sub-agent chunks", async () => {
		const mockChunks: StreamChunk[] = [
			{
				type: "tool_start",
				toolName: "discover_franchises",
				toolId: "t1",
				toolSummary: "Discovering franchises",
			},
			{
				type: "tool_end",
				toolName: "discover_franchises",
				toolId: "t1",
				toolResult: "Found 5 brands",
				durationMs: 1200,
			},
		];

		const { tool, streamCalls } = setupSpawnTool(
			{
				text: "Found 5 brands matching ICP.",
				sessionId: "agent-icp-123",
				ok: true,
			},
			mockChunks,
		);

		const gen = tool.streamHandler?.({
			name: "icp-researcher",
			task: "Find leads in NAICS 722513",
			skills: ["icp-discovery"],
			__sessionId: "parent-1",
		});

		const yielded: StreamChunk[] = [];
		let next = await gen.next();
		while (!next.done) {
			yielded.push(next.value);
			next = await gen.next();
		}

		expect(yielded).toHaveLength(2);
		expect(yielded[0].type).toBe("tool_start");
		expect(yielded[0].toolName).toBe("discover_franchises");
		expect(yielded[1].type).toBe("tool_end");

		const finalResult = next.value;
		expect(finalResult.is_error).toBeUndefined();
		expect(finalResult.content).toContain('Agent "icp-researcher" completed');

		expect(streamCalls).toHaveLength(1);
		expect(streamCalls[0].agent.name).toBe("icp-researcher");
	});

	test("streamHandler returns error for invalid input", async () => {
		const { tool } = setupSpawnTool();

		const gen = tool.streamHandler?.({
			task: "Something",
		});

		const next = await gen.next();
		expect(next.done).toBe(true);
		expect(next.value.is_error).toBe(true);
		expect(next.value.content).toContain("name is required");
	});

	test("accepts skills as comma-separated string", async () => {
		const { tool, calls } = setupSpawnTool();

		await tool.handler({
			name: "flexible-agent",
			task: "Test skills parsing",
			skills: "icp-discovery, memory, files",
		});

		expect(calls[0].agent.skills).toEqual(["icp-discovery", "memory", "files"]);
	});

	test("blocks spawning when max agent depth reached", async () => {
		const { tool, calls, agentDepths } = setupSpawnTool();

		// Simulate parent session already at max depth (3)
		agentDepths.set("deep-parent", 3);

		const result = await tool.handler({
			name: "too-deep",
			task: "This should be blocked",
			__sessionId: "deep-parent",
		});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Maximum agent nesting depth");
		expect(calls).toHaveLength(0);
	});

	test("allows spawning when under max depth", async () => {
		const { tool, calls, agentDepths } = setupSpawnTool();

		// Simulate parent at depth 2 (under limit of 3)
		agentDepths.set("shallow-parent", 2);

		const result = await tool.handler({
			name: "still-ok",
			task: "This should work",
			__sessionId: "shallow-parent",
		});

		expect(result.is_error).toBeUndefined();
		expect(calls).toHaveLength(1);
	});
});
