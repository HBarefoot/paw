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

	test("split system: stable is cached, volatile rides AFTER the breakpoint", () => {
		const req = buildClaudeRequest({
			model: "m",
			maxTokens: 1,
			systemPrompt: { stable: "STABLE", volatile: "\n<memory>v1</memory>" },
			tools: [],
			conversation: CONVO,
			promptCache: true,
		});
		expect(req.system).toEqual([
			{ type: "text", text: "STABLE", cache_control: { type: "ephemeral" } },
			{ type: "text", text: "\n<memory>v1</memory>" },
		]);
	});

	test("split system: the cached stable block is byte-identical across turns with different memory", () => {
		const build = (volatile: string) =>
			buildClaudeRequest({
				model: "m",
				maxTokens: 1,
				systemPrompt: { stable: "STABLE", volatile },
				tools: [],
				conversation: CONVO,
				promptCache: true,
			}).system as Array<{ text: string; cache_control?: unknown }>;
		const t1 = build("\n<memory>turn-1</memory>");
		const t2 = build("\n<memory>turn-2 differs</memory>");
		// Block 0 (the cached prefix) is identical — the cache reads across turns.
		expect(t1[0]).toEqual(t2[0]);
		expect(t1[0].cache_control).toEqual({ type: "ephemeral" });
		// Only the uncached volatile block (no cache_control) differs.
		expect(t1[1].text).not.toBe(t2[1].text);
		expect(t1[1].cache_control).toBeUndefined();
	});

	test("split system, empty volatile: a single cached block (no empty trailing block)", () => {
		const req = buildClaudeRequest({
			model: "m",
			maxTokens: 1,
			systemPrompt: { stable: "STABLE", volatile: "" },
			tools: [],
			conversation: CONVO,
			promptCache: true,
		});
		expect(req.system).toEqual([
			{ type: "text", text: "STABLE", cache_control: { type: "ephemeral" } },
		]);
	});

	test("split system, promptCache off: concatenated string, no cache_control", () => {
		const req = buildClaudeRequest({
			model: "m",
			maxTokens: 1,
			systemPrompt: { stable: "STABLE", volatile: "\nVOL" },
			tools: [],
			conversation: CONVO,
			promptCache: false,
		});
		expect(req.system).toBe("STABLE\nVOL");
		expect(JSON.stringify(req)).not.toContain("cache_control");
	});
});
