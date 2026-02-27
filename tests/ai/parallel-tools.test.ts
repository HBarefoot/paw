import { describe, expect, test } from "bun:test";
import {
	executeToolsParallel,
	executeToolsParallelStreaming,
	type ToolCallRequest,
} from "../../src/ai/parallel-tools.js";
import type { StreamChunk } from "../../src/ai/base-provider.js";
import { ToolRegistry } from "../../src/ai/tools.js";

const mockLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};

function createRegistry(
	tools: Array<{
		name: string;
		delayMs?: number;
		result?: string;
		error?: boolean;
		throwError?: boolean;
	}>,
): ToolRegistry {
	const registry = new ToolRegistry(mockLogger);
	registry.register(
		tools.map((t) => ({
			name: t.name,
			description: `Test tool ${t.name}`,
			input_schema: { type: "object" as const, properties: {} },
			plugin: "test",
			handler: async () => {
				if (t.delayMs) await new Promise((r) => setTimeout(r, t.delayMs));
				if (t.throwError) throw new Error("Handler exploded");
				return {
					content: t.result ?? `${t.name} done`,
					is_error: t.error,
				};
			},
		})),
	);
	return registry;
}

describe("executeToolsParallel", () => {
	test("executes tools in parallel (faster than sequential)", async () => {
		const registry = createRegistry([
			{ name: "slow_a", delayMs: 50, result: "a" },
			{ name: "slow_b", delayMs: 50, result: "b" },
			{ name: "slow_c", delayMs: 50, result: "c" },
		]);

		const calls: ToolCallRequest[] = [
			{ id: "1", name: "slow_a", input: {} },
			{ id: "2", name: "slow_b", input: {} },
			{ id: "3", name: "slow_c", input: {} },
		];

		const start = Date.now();
		const results = await executeToolsParallel(calls, registry, mockLogger, 10_000);
		const elapsed = Date.now() - start;

		// Parallel: ~50ms. Sequential would be ~150ms.
		expect(elapsed).toBeLessThan(120);
		expect(results).toHaveLength(3);
		expect(results[0].content).toBe("a");
		expect(results[1].content).toBe("b");
		expect(results[2].content).toBe("c");
	});

	test("returns results in original call order", async () => {
		const registry = createRegistry([
			{ name: "fast", delayMs: 10, result: "fast" },
			{ name: "slow", delayMs: 80, result: "slow" },
		]);

		const calls: ToolCallRequest[] = [
			{ id: "1", name: "slow", input: {} },
			{ id: "2", name: "fast", input: {} },
		];

		const results = await executeToolsParallel(calls, registry, mockLogger);
		// slow was called first, so it should be first in results
		expect(results[0].content).toBe("slow");
		expect(results[1].content).toBe("fast");
	});

	test("isolates per-tool errors", async () => {
		const registry = createRegistry([
			{ name: "ok_tool", result: "ok" },
			{ name: "bad_tool", throwError: true },
		]);

		const calls: ToolCallRequest[] = [
			{ id: "1", name: "ok_tool", input: {} },
			{ id: "2", name: "bad_tool", input: {} },
		];

		const results = await executeToolsParallel(calls, registry, mockLogger);
		expect(results[0].is_error).toBeUndefined();
		expect(results[0].content).toBe("ok");
		expect(results[1].is_error).toBe(true);
		expect(results[1].content).toContain("Tool error");
	});

	test("handles timeout per tool", async () => {
		const registry = createRegistry([
			{ name: "fast_tool", result: "ok" },
			{ name: "stuck_tool", delayMs: 500 },
		]);

		const calls: ToolCallRequest[] = [
			{ id: "1", name: "fast_tool", input: {} },
			{ id: "2", name: "stuck_tool", input: {} },
		];

		const results = await executeToolsParallel(calls, registry, mockLogger, 100);
		expect(results[0].content).toBe("ok");
		expect(results[1].is_error).toBe(true);
		expect(results[1].content).toContain("timed out");
	});
});

describe("executeToolsParallelStreaming", () => {
	test("single tool uses streamHandler when available", async () => {
		const registry = new ToolRegistry(mockLogger);
		const yieldedChunks: StreamChunk[] = [];

		registry.register([
			{
				name: "stream_tool",
				description: "Streams stuff",
				input_schema: { type: "object", properties: {} },
				plugin: "test",
				handler: async () => ({ content: "handler result" }),
				streamHandler: async function* () {
					yield { type: "thinking" } as StreamChunk;
					yield { type: "thinking" } as StreamChunk;
					return { content: "stream result" };
				},
			},
		]);

		const calls: ToolCallRequest[] = [
			{ id: "t1", name: "stream_tool", input: {} },
		];

		const gen = executeToolsParallelStreaming(calls, registry, mockLogger, 0);
		let next = await gen.next();
		while (!next.done) {
			yieldedChunks.push(next.value);
			next = await gen.next();
		}

		const results = next.value;
		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("stream result");

		// Should have: tool_start, 2x thinking (from streamHandler), tool_end
		expect(yieldedChunks[0].type).toBe("tool_start");
		expect(yieldedChunks[1].type).toBe("thinking");
		expect(yieldedChunks[2].type).toBe("thinking");
		expect(yieldedChunks[3].type).toBe("tool_end");
	});

	test("multiple tools run in parallel and yield tool_start before tool_end", async () => {
		const registry = createRegistry([
			{ name: "tool_a", delayMs: 30, result: "a" },
			{ name: "tool_b", delayMs: 30, result: "b" },
		]);

		const calls: ToolCallRequest[] = [
			{ id: "t1", name: "tool_a", input: {} },
			{ id: "t2", name: "tool_b", input: {} },
		];

		const chunks: StreamChunk[] = [];
		const gen = executeToolsParallelStreaming(calls, registry, mockLogger, 0);
		let next = await gen.next();
		while (!next.done) {
			chunks.push(next.value);
			next = await gen.next();
		}

		const results = next.value;
		expect(results).toHaveLength(2);

		// All tool_start events should come before any tool_end events
		const startIndices = chunks
			.map((c, i) => (c.type === "tool_start" ? i : -1))
			.filter((i) => i >= 0);
		const endIndices = chunks
			.map((c, i) => (c.type === "tool_end" ? i : -1))
			.filter((i) => i >= 0);

		expect(startIndices).toHaveLength(2);
		expect(endIndices).toHaveLength(2);
		// All starts come before all ends
		expect(Math.max(...startIndices)).toBeLessThan(Math.min(...endIndices));
	});

	test("multiple tools: does NOT use streamHandler (falls back to regular handler)", async () => {
		let streamHandlerCalled = false;

		const registry = new ToolRegistry(mockLogger);
		registry.register([
			{
				name: "stream_a",
				description: "A",
				input_schema: { type: "object", properties: {} },
				plugin: "test",
				handler: async () => ({ content: "handler a" }),
				streamHandler: async function* () {
					streamHandlerCalled = true;
					return { content: "stream a" };
				},
			},
			{
				name: "stream_b",
				description: "B",
				input_schema: { type: "object", properties: {} },
				plugin: "test",
				handler: async () => ({ content: "handler b" }),
			},
		]);

		const calls: ToolCallRequest[] = [
			{ id: "t1", name: "stream_a", input: {} },
			{ id: "t2", name: "stream_b", input: {} },
		];

		const gen = executeToolsParallelStreaming(calls, registry, mockLogger, 0);
		let next = await gen.next();
		while (!next.done) {
			next = await gen.next();
		}

		const results = next.value;
		expect(streamHandlerCalled).toBe(false);
		expect(results[0].content).toBe("handler a"); // Used regular handler, not stream
		expect(results[1].content).toBe("handler b");
	});
});
