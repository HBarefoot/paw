import { describe, expect, test } from "bun:test";
import { createDelegateTool } from "../../src/agents/delegate-tool.js";
import { AgentRegistry } from "../../src/agents/registry.js";
import type { AgentRunResult } from "../../src/agents/types.js";
import type { StreamChunk } from "../../src/ai/base-provider.js";

const mockLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};

function setupDelegateTool(
	runResult: AgentRunResult = {
		text: "Task completed successfully.",
		sessionId: "agent-test-123",
		ok: true,
	},
	streamChunks: StreamChunk[] = [],
) {
	const registry = new AgentRegistry(mockLogger);
	registry.register({
		name: "test-agent",
		description: "A test agent for unit tests",
		systemPrompt: "You are a test agent.",
		skills: ["files"],
	});
	registry.register({
		name: "icp-discovery",
		description: "Discovers franchise leads",
		systemPrompt: "You discover ICP leads.",
		skills: ["icp-discovery"],
	});

	const calls: Array<{
		agentName: string;
		task: string;
		parentSessionId: string;
	}> = [];
	const streamCalls: typeof calls = [];

	const tool = createDelegateTool({
		agentRegistry: registry,
		runAgentTurn: async (agentName, task, parentSessionId) => {
			calls.push({ agentName, task, parentSessionId });
			return runResult;
		},
		runAgentTurnStream: async function* (agentName, task, parentSessionId) {
			streamCalls.push({ agentName, task, parentSessionId });
			for (const chunk of streamChunks) {
				yield chunk;
			}
			return runResult;
		},
	});

	return { tool, calls, streamCalls, registry };
}

describe("delegate_task tool", () => {
	test("has correct schema with agent enum", () => {
		const { tool } = setupDelegateTool();

		expect(tool.name).toBe("delegate_task");
		expect(tool.plugin).toBe("kernel");
		expect(tool.input_schema.required).toEqual(["agent", "task"]);

		const agentProp = (
			tool.input_schema.properties as Record<string, { enum?: string[] }>
		).agent;
		expect(agentProp.enum).toContain("test-agent");
		expect(agentProp.enum).toContain("icp-discovery");
	});

	test("description includes agent catalog", () => {
		const { tool } = setupDelegateTool();

		expect(tool.description).toContain("test-agent");
		expect(tool.description).toContain("A test agent for unit tests");
		expect(tool.description).toContain("icp-discovery");
	});

	test("delegates to agent and returns result", async () => {
		const { tool, calls } = setupDelegateTool();

		const result = await tool.handler({
			agent: "test-agent",
			task: "Do something useful",
			__sessionId: "parent-session-1",
		});

		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain('Agent "test-agent" completed');
		expect(result.content).toContain("Task completed successfully.");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			agentName: "test-agent",
			task: "Do something useful",
			parentSessionId: "parent-session-1",
		});
	});

	test("returns error for unknown agent", async () => {
		const { tool } = setupDelegateTool();

		const result = await tool.handler({
			agent: "nonexistent",
			task: "Something",
		});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Unknown agent");
	});

	test("returns error for empty task", async () => {
		const { tool } = setupDelegateTool();

		const result = await tool.handler({
			agent: "test-agent",
			task: "",
		});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("cannot be empty");
	});

	test("returns error when agent run fails", async () => {
		const { tool } = setupDelegateTool({
			text: "",
			sessionId: "agent-fail-123",
			ok: false,
			error: "Provider timeout",
		});

		const result = await tool.handler({
			agent: "test-agent",
			task: "A doomed task",
			__sessionId: "parent-1",
		});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("failed");
		expect(result.content).toContain("Provider timeout");
	});

	test("uses 'unknown' when no __sessionId provided", async () => {
		const { tool, calls } = setupDelegateTool();

		await tool.handler({
			agent: "test-agent",
			task: "No session context",
		});

		expect(calls[0].parentSessionId).toBe("unknown");
	});

	test("streamHandler is present when runAgentTurnStream is provided", () => {
		const { tool } = setupDelegateTool();
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

		const { tool, streamCalls } = setupDelegateTool(
			{
				text: "Found 5 brands matching ICP.",
				sessionId: "agent-icp-123",
				ok: true,
			},
			mockChunks,
		);

		const gen = tool.streamHandler?.({
			agent: "icp-discovery",
			task: "Find leads in NAICS 722513",
			__sessionId: "parent-1",
		});

		const yielded: StreamChunk[] = [];
		let next = await gen.next();
		while (!next.done) {
			yielded.push(next.value);
			next = await gen.next();
		}

		// Check yielded chunks match
		expect(yielded).toHaveLength(2);
		expect(yielded[0].type).toBe("tool_start");
		expect(yielded[0].toolName).toBe("discover_franchises");
		expect(yielded[1].type).toBe("tool_end");

		// Check return value is the ToolResult
		const finalResult = next.value;
		expect(finalResult.is_error).toBeUndefined();
		expect(finalResult.content).toContain('Agent "icp-discovery" completed');

		// Verify the stream function was called
		expect(streamCalls).toHaveLength(1);
		expect(streamCalls[0].agentName).toBe("icp-discovery");
	});

	test("streamHandler returns error for invalid input", async () => {
		const { tool } = setupDelegateTool();

		const gen = tool.streamHandler?.({
			agent: "nonexistent",
			task: "Something",
		});

		const next = await gen.next();
		// Should return immediately with error (generator returns, not yields)
		expect(next.done).toBe(true);
		expect(next.value.is_error).toBe(true);
		expect(next.value.content).toContain("Unknown agent");
	});
});
