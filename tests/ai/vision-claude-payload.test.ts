import { describe, expect, mock, test } from "bun:test";
import type { ChatMessage } from "../../src/ai/base-provider.js";
import type { Logger } from "../../src/types/plugin.js";

// The Anthropic SDK doesn't route through globalThis.fetch, so we mock the SDK
// module and capture the params handed to messages.stream(); Claude's `chat`
// uses `client.messages.stream(...).finalMessage()`.
const noop = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as unknown as Logger;

const IMG = Buffer.from("PNGDATA");
const B64 = IMG.toString("base64");

describe("inbound image payload — Claude", () => {
	test("emits a base64 image content block", async () => {
		let captured: {
			messages?: Array<{ role: string; content: unknown }>;
		} | null = null;
		mock.module("@anthropic-ai/sdk", () => ({
			default: class {
				messages = {
					stream: (params: {
						messages: Array<{ role: string; content: unknown }>;
					}) => {
						captured = params;
						return {
							finalMessage: async () => ({
								content: [{ type: "text", text: "ok" }],
								stop_reason: "end_turn",
							}),
						};
					},
				};
			},
		}));

		const { ClaudeProvider } = await import("../../src/ai/provider.js");
		const { ToolRegistry } = await import("../../src/ai/tools.js");

		const p = new ClaudeProvider(
			{
				apiKey: "k",
				authMethod: "api_key",
				model: "claude-test",
				maxTokens: 64,
				maxToolRoundtrips: 1,
			},
			new ToolRegistry(),
			noop,
		);
		const imageTurn: ChatMessage[] = [
			{
				role: "user",
				content: "what is in this photo?",
				attachments: [{ type: "image", data: IMG, mimeType: "image/png" }],
			},
		];
		await p.chat(imageTurn, "sys");

		const cap = captured as {
			messages?: Array<{ role: string; content: unknown }>;
		} | null;
		const userMsg = cap?.messages?.find((m) => m.role === "user");
		const parts = userMsg?.content as Array<{
			type: string;
			source?: { type: string; media_type: string; data: string };
		}>;
		const img = parts.find((x) => x.type === "image");
		expect(img?.source).toEqual({
			type: "base64",
			media_type: "image/png",
			data: B64,
		});
	});
});
