import { describe, expect, mock, test } from "bun:test";
import type { ChatMessage, StreamChunk } from "../../src/ai/base-provider.js";
import type { ToolDefinition } from "../../src/types/message.js";
import type { Logger } from "../../src/types/plugin.js";

// When a provider's tool-use loop exhausts its roundtrip budget it must NOT
// return the old canned "I've reached the maximum number of tool-use steps…"
// string. Instead it reports a STRUCTURED stop (`stopReason: "max_roundtrips"`)
// plus a compact `checkpoint` (chat) / a `checkpoint` StreamChunk (stream), so
// the kernel can drive a continuation. These tests FAIL on the pre-fix code,
// which returned/yielded the canned string with no stopReason or checkpoint.

const noop = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as unknown as Logger;

type Final = {
	content: Array<Record<string, unknown>>;
	stop_reason: string;
	usage?: { input_tokens: number; output_tokens: number };
};

const CANNED = "I've reached the maximum number of tool-use steps";

/**
 * Mock the Anthropic SDK so `client.messages.stream(params).finalMessage()`
 * returns a scripted sequence, capturing the `tools` handed to each call. The
 * stream is also async-iterable (no text deltas needed for these assertions).
 */
function mockAnthropic(script: Final[], capturedTools: unknown[][]) {
	let i = 0;
	mock.module("@anthropic-ai/sdk", () => ({
		default: class {
			messages = {
				stream: (params: { tools?: unknown[] }) => {
					capturedTools.push((params.tools ?? []) as unknown[]);
					const final = script[Math.min(i, script.length - 1)];
					i++;
					return {
						controller: { abort() {} },
						async *[Symbol.asyncIterator]() {
							/* no content_block_delta events needed */
						},
						finalMessage: async () => final,
					};
				},
			};
		},
	}));
}

const PING: ToolDefinition = {
	name: "ping",
	description: "always-active ping",
	input_schema: { type: "object" },
	plugin: "core", // skill "core" is always-active
	handler: async () => ({ content: "pong" }),
};

const toolUse: Final = {
	content: [{ type: "tool_use", id: "t1", name: "ping", input: {} }],
	stop_reason: "tool_use",
};
const checkpointReply: Final = {
	content: [
		{
			type: "text",
			text: "DONE: pinged twice\nLEFT: nothing important\nKEY ARTIFACTS/IDS: ping-1",
		},
	],
	stop_reason: "end_turn",
};

async function makeProvider(maxToolRoundtrips: number) {
	const { ClaudeProvider } = await import("../../src/ai/provider.js");
	const { ToolRegistry } = await import("../../src/ai/tools.js");
	const { SkillManager } = await import("../../src/ai/skills.js");

	const registry = new ToolRegistry();
	registry.register([PING]);
	const skills = new SkillManager();
	skills.buildFromRegistry(registry);

	return new ClaudeProvider(
		{
			apiKey: "k",
			authMethod: "api_key",
			model: "claude-test",
			maxTokens: 64,
			maxToolRoundtrips,
		},
		registry,
		noop,
		skills,
	);
}

const userTurn: ChatMessage[] = [{ role: "user", content: "go" }];

describe("Claude provider — max_roundtrips checkpoint (non-stream)", () => {
	test("returns a structured stop + checkpoint instead of the canned string", async () => {
		const captured: unknown[][] = [];
		// Budget = 2. Every roundtrip requests a tool so the loop never ends
		// naturally; the 3rd stream() call is the tool-less checkpoint call.
		mockAnthropic([toolUse, toolUse, checkpointReply], captured);

		const provider = await makeProvider(2);
		const res = await provider.chat(userTurn, "sys", "s-cap");

		expect(res.stopReason).toBe("max_roundtrips");
		expect(res.roundtripsUsed).toBe(2);
		expect(res.checkpoint).toContain("DONE:");
		expect(res.text).not.toContain(CANNED);

		// The extra (3rd) call is the checkpoint: it ran, with tools DISABLED.
		expect(captured.length).toBe(3);
		expect(captured[2]).toEqual([]);
	});

	test("a naturally-finishing turn carries no max_roundtrips stop", async () => {
		const captured: unknown[][] = [];
		mockAnthropic(
			[
				toolUse,
				{
					content: [{ type: "text", text: "all done" }],
					stop_reason: "end_turn",
				},
			],
			captured,
		);
		const provider = await makeProvider(5);
		const res = await provider.chat(userTurn, "sys", "s-ok");

		expect(res.stopReason).not.toBe("max_roundtrips");
		expect(res.checkpoint).toBeUndefined();
		expect(res.text).toBe("all done");
		// No checkpoint call — only the two real roundtrips.
		expect(captured.length).toBe(2);
	});
});

describe("Claude provider — max_roundtrips checkpoint (stream)", () => {
	test("emits a checkpoint chunk (never the canned text) on budget exhaustion", async () => {
		const captured: unknown[][] = [];
		mockAnthropic([toolUse, toolUse, checkpointReply], captured);

		const provider = await makeProvider(2);
		if (!provider.chatStream) throw new Error("expected a streaming provider");
		const chunks: StreamChunk[] = [];
		for await (const c of provider.chatStream(
			userTurn,
			"sys",
			"s-cap-stream",
		)) {
			chunks.push(c);
		}

		const checkpointChunk = chunks.find((c) => c.type === "checkpoint");
		expect(checkpointChunk).toBeDefined();
		expect(checkpointChunk?.stopReason).toBe("max_roundtrips");
		expect(checkpointChunk?.roundtripsUsed).toBe(2);
		expect(checkpointChunk?.checkpoint).toContain("DONE:");

		// The dead-end string is never streamed as visible text.
		const streamedText = chunks
			.filter((c) => c.type === "text_delta")
			.map((c) => c.text ?? "")
			.join("");
		expect(streamedText).not.toContain(CANNED);
		expect(captured[captured.length - 1]).toEqual([]); // checkpoint call: tools off
	});
});
