import { describe, expect, test } from "bun:test";
import type {
	MessageParam,
	Tool,
} from "@anthropic-ai/sdk/resources/messages";
import { buildClaudeRequest } from "../../src/ai/provider.js";

const CONVO: MessageParam[] = [{ role: "user", content: "hi" }];
const TOOLS: Tool[] = [
	{ name: "a", description: "tool a", input_schema: { type: "object" } },
	{ name: "b", description: "tool b", input_schema: { type: "object" } },
];

describe("buildClaudeRequest — prompt caching", () => {
	test("promptCache on: system is a cached text block", () => {
		const req = buildClaudeRequest({
			model: "claude-test",
			maxTokens: 64,
			systemPrompt: "SYS",
			tools: [],
			conversation: CONVO,
			promptCache: true,
		});
		expect(req.system).toEqual([
			{ type: "text", text: "SYS", cache_control: { type: "ephemeral" } },
		]);
	});

	test("promptCache on: only the LAST tool carries the breakpoint", () => {
		const req = buildClaudeRequest({
			model: "claude-test",
			maxTokens: 64,
			systemPrompt: "SYS",
			tools: TOOLS,
			conversation: CONVO,
			promptCache: true,
		});
		const tools = req.tools as Tool[];
		expect(tools).toHaveLength(2);
		expect(
			(tools[0] as { cache_control?: unknown }).cache_control,
		).toBeUndefined();
		expect(tools[1].cache_control).toEqual({ type: "ephemeral" });
	});

	test("promptCache on: does NOT mutate the caller's tools array", () => {
		const tools: Tool[] = [
			{ name: "a", description: "a", input_schema: { type: "object" } },
		];
		buildClaudeRequest({
			model: "m",
			maxTokens: 1,
			systemPrompt: "S",
			tools,
			conversation: CONVO,
			promptCache: true,
		});
		expect(
			(tools[0] as { cache_control?: unknown }).cache_control,
		).toBeUndefined();
	});

	test("promptCache off: byte-identical to the legacy request shape", () => {
		const req = buildClaudeRequest({
			model: "claude-test",
			maxTokens: 64,
			systemPrompt: "SYS",
			tools: TOOLS,
			conversation: CONVO,
			promptCache: false,
		});
		// String system, untouched tools, no cache_control anywhere — exactly the
		// object the provider built before caching was added.
		expect(req).toEqual({
			model: "claude-test",
			max_tokens: 64,
			system: "SYS",
			messages: CONVO,
			tools: TOOLS,
		});
		expect(JSON.stringify(req)).not.toContain("cache_control");
	});

	test("no tools: the tools key is omitted in both modes", () => {
		for (const promptCache of [true, false]) {
			const req = buildClaudeRequest({
				model: "m",
				maxTokens: 1,
				systemPrompt: "S",
				tools: [],
				conversation: CONVO,
				promptCache,
			});
			expect("tools" in req).toBe(false);
		}
	});
});
