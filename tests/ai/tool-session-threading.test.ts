import { describe, expect, test } from "bun:test";
import {
	executeToolsParallel,
	executeToolsParallelStreaming,
} from "../../src/ai/parallel-tools.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import type { ToolLog } from "../../src/observability/tool-log.js";
import type { ToolDefinition, ToolResult } from "../../src/types/message.js";

// Every provider tool loop (Claude/OpenAI/Gemini/Ollama, streaming + not) routes
// through executeToolsParallel / executeToolsParallelStreaming → ToolRegistry
// .execute. These lock the additive sessionId threading at that shared chokepoint
// (the provider→dispatcher hop is type-checked), so a regression in any provider
// loop that drops sessionId fails here. sessionId is OPTIONAL — omitting it works.

const logger = { info() {} };
const call = { id: "1", name: "t", input: { a: 1 } };

function captureRegistry(sink: { sessionId?: string }): ToolRegistry {
	return {
		get: () => undefined,
		execute: async (
			_n: string,
			_i: Record<string, unknown>,
			sessionId?: string,
		) => {
			sink.sessionId = sessionId;
			return { content: "ok" } as ToolResult;
		},
	} as unknown as ToolRegistry;
}

function tool(
	name: string,
	handler: (i: Record<string, unknown>) => Promise<ToolResult>,
): ToolDefinition {
	return { name, description: "", input_schema: {}, plugin: "kernel", handler };
}

describe("sessionId threading through the tool dispatch chain", () => {
	test("executeToolsParallel forwards sessionId to execute", async () => {
		const sink: { sessionId?: string } = {};
		await executeToolsParallel(
			[call],
			captureRegistry(sink),
			logger,
			undefined,
			"sess-A",
		);
		expect(sink.sessionId).toBe("sess-A");
	});

	test("executeToolsParallel omits sessionId when not provided (additive)", async () => {
		const sink: { sessionId?: string } = { sessionId: "stale" };
		await executeToolsParallel([call], captureRegistry(sink), logger);
		expect(sink.sessionId).toBeUndefined();
	});

	test("executeToolsParallelStreaming forwards sessionId to execute", async () => {
		const sink: { sessionId?: string } = {};
		const gen = executeToolsParallelStreaming(
			[call],
			captureRegistry(sink),
			logger,
			0,
			undefined,
			"sess-B",
		);
		let n = await gen.next();
		while (!n.done) n = await gen.next();
		expect(sink.sessionId).toBe("sess-B");
	});

	test("ToolRegistry.execute records sessionId to tool_log + in-flight", async () => {
		const reg = new ToolRegistry();
		const recorded: Array<{ sessionId?: string }> = [];
		reg.setToolLog({
			record: (o: { sessionId?: string }) => recorded.push(o),
		} as unknown as ToolLog);

		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		reg.register([
			tool("t", async () => {
				await gate;
				return { content: "ok" };
			}),
		]);

		const p = reg.execute("t", {}, "sess-C");
		expect(reg.getInFlight()[0]?.sessionId).toBe("sess-C");
		release();
		await p;
		expect(recorded[0]?.sessionId).toBe("sess-C");
	});
});
