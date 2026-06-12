import { afterEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../src/ai/base-provider.js";
import { GeminiProvider } from "../../src/ai/gemini-provider.js";
import { OllamaProvider } from "../../src/ai/ollama-provider.js";
import { OpenAIProvider } from "../../src/ai/openai-provider.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import type { Logger } from "../../src/types/plugin.js";

// Each routable provider must pass an inbound image attachment in its native
// format. We capture the outgoing request and assert the image payload shape.
const noop = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as unknown as Logger;

const IMG = Buffer.from("PNGDATA");
const B64 = IMG.toString("base64");
const imageTurn: ChatMessage[] = [
	{
		role: "user",
		content: "what is in this photo?",
		attachments: [{ type: "image", data: IMG, mimeType: "image/png" }],
	},
];

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Mock fetch that records the JSON body and returns a fixed response. */
function capture(response: unknown): () => Record<string, unknown> | null {
	let body: Record<string, unknown> | null = null;
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		body = JSON.parse(init.body as string);
		return new Response(JSON.stringify(response), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return () => body;
}

describe("inbound image payload per provider", () => {
	test("OpenAI → image_url data URI", async () => {
		const getBody = capture({
			choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		});
		const p = new OpenAIProvider(
			{
				apiKey: "k",
				model: "gpt-4o",
				maxTokens: 64,
				maxToolRoundtrips: 1,
				baseUrl: "https://api.openai.com/v1",
			},
			new ToolRegistry(),
			noop,
		);
		await p.chat(imageTurn, "sys");
		const messages = getBody()?.messages as Array<{ content: unknown }>;
		const parts = messages
			.map((m) => m.content)
			.find((c) => Array.isArray(c)) as Array<{
			type: string;
			image_url?: { url: string };
		}>;
		const img = parts.find((x) => x.type === "image_url");
		expect(img?.image_url?.url).toBe(`data:image/png;base64,${B64}`);
	});

	test("Gemini → inlineData", async () => {
		const getBody = capture({
			candidates: [
				{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" },
			],
			usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
		});
		const p = new GeminiProvider(
			{
				apiKey: "k",
				model: "gemini-2.0-flash",
				maxTokens: 64,
				maxToolRoundtrips: 1,
			},
			new ToolRegistry(),
			noop,
		);
		await p.chat(imageTurn, "sys");
		const contents = getBody()?.contents as Array<{
			parts: Array<{ inlineData?: { mimeType: string; data: string } }>;
		}>;
		const inline = contents.flatMap((c) => c.parts).find((x) => x.inlineData);
		expect(inline?.inlineData).toEqual({ mimeType: "image/png", data: B64 });
	});

	test("Ollama → images[]", async () => {
		const getBody = capture({
			message: { role: "assistant", content: "ok" },
			done: true,
			prompt_eval_count: 1,
			eval_count: 1,
		});
		const p = new OllamaProvider(
			{
				baseUrl: "http://localhost:11434",
				model: "llava",
				maxToolRoundtrips: 1,
				maxTokens: 64,
			},
			new ToolRegistry(),
			noop,
		);
		await p.chat(imageTurn, "sys");
		const messages = getBody()?.messages as Array<{
			role: string;
			images?: string[];
		}>;
		const userMsg = messages.find((m) => m.role === "user");
		expect(userMsg?.images).toEqual([B64]);
	});
});
