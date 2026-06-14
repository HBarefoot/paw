import { describe, expect, test } from "bun:test";
import type { StreamChunk } from "../../src/ai/base-provider.js";
import type { InboundMessage } from "../../src/types/message.js";
import {
	type OpenAiApiDeps,
	buildTurnContent,
	constantTimeEqual,
	createOpenAiApi,
} from "../../src/web/routes/openai-api.js";

function textTurn(...texts: string[]): AsyncGenerator<StreamChunk> {
	return (async function* () {
		for (const t of texts) yield { type: "text_delta", text: t } as StreamChunk;
		yield { type: "done" } as StreamChunk;
	})();
}

function makeApp(overrides: Partial<OpenAiApiDeps> = {}) {
	const seen: InboundMessage[] = [];
	const deps: OpenAiApiDeps = {
		runTurn: (msg) => {
			seen.push(msg);
			return textTurn("Hello", " world");
		},
		getBearer: () => "secret-key",
		rateLimit: () => ({ allowed: true }),
		getClientIp: () => "1.2.3.4",
		listModels: () => ["paw-model", "vision-model"],
		now: () => 1_000_000,
		...overrides,
	};
	return { app: createOpenAiApi(deps), seen };
}

const AUTH = {
	Authorization: "Bearer secret-key",
	"Content-Type": "application/json",
};

function post(
	app: ReturnType<typeof makeApp>["app"],
	body: unknown,
	headers: Record<string, string> = AUTH,
) {
	return app.request("/v1/chat/completions", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

describe("pure helpers", () => {
	test("constantTimeEqual", () => {
		expect(constantTimeEqual("abc", "abc")).toBe(true);
		expect(constantTimeEqual("abc", "abd")).toBe(false);
		expect(constantTimeEqual("abc", "abcd")).toBe(false);
	});
	test("buildTurnContent: single user message passes through", () => {
		expect(buildTurnContent([{ role: "user", content: "hi there" }])).toBe(
			"hi there",
		);
	});
	test("buildTurnContent: multi-turn folds into a transcript, ignores system", () => {
		const out = buildTurnContent([
			{ role: "system", content: "ignored" },
			{ role: "user", content: "first" },
			{ role: "assistant", content: "reply" },
			{ role: "user", content: "second" },
		]);
		expect(out).not.toContain("ignored");
		expect(out).toContain("user: first");
		expect(out).toContain("assistant: reply");
		expect(out).toContain("second");
	});
});

describe("auth", () => {
	test("valid bearer non-stream → OpenAI completion shape", async () => {
		const { app } = makeApp();
		const res = await post(app, {
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			object: string;
			choices: Array<{ message: { role: string; content: string } }>;
		};
		expect(json.object).toBe("chat.completion");
		expect(json.choices[0].message).toEqual({
			role: "assistant",
			content: "Hello world",
		});
	});

	test("stream:true → OpenAI SSE chunks + [DONE]", async () => {
		const { app } = makeApp();
		const res = await post(app, {
			messages: [{ role: "user", content: "hi" }],
			stream: true,
		});
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("chat.completion.chunk");
		expect(body).toContain('"content":"Hello"');
		expect(body).toContain('"finish_reason":"stop"');
		expect(body).toContain("[DONE]");
	});

	test("missing bearer → 401", async () => {
		const { app, seen } = makeApp();
		const res = await post(
			app,
			{ messages: [{ role: "user", content: "hi" }] },
			{
				"Content-Type": "application/json",
			},
		);
		expect(res.status).toBe(401);
		expect(seen).toHaveLength(0); // turn never ran
	});

	test("invalid bearer → 401", async () => {
		const { app } = makeApp();
		const res = await post(
			app,
			{ messages: [{ role: "user", content: "hi" }] },
			{
				Authorization: "Bearer wrong",
				"Content-Type": "application/json",
			},
		);
		expect(res.status).toBe(401);
	});

	test("no key configured → endpoint disabled (401) even with a bearer", async () => {
		const { app, seen } = makeApp({ getBearer: () => "" });
		const res = await post(app, {
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.status).toBe(401);
		expect(seen).toHaveLength(0);
	});
});

describe("behavior", () => {
	test("unknown params are ignored (no error)", async () => {
		const { app } = makeApp();
		const res = await post(app, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			temperature: 0.7,
			top_p: 1,
			frequency_penalty: 0,
			stop: ["x"],
		});
		expect(res.status).toBe(200);
	});

	test("/v1/models shape", async () => {
		const { app } = makeApp();
		const res = await app.request("/v1/models", { headers: AUTH });
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			object: string;
			data: Array<{ id: string; object: string }>;
		};
		expect(json.object).toBe("list");
		expect(json.data.map((m) => m.id)).toEqual(["paw-model", "vision-model"]);
		expect(json.data[0].object).toBe("model");
	});

	test("two requests without x-paw-session get distinct ephemeral sessions", async () => {
		const { app, seen } = makeApp();
		await post(app, { messages: [{ role: "user", content: "a" }] });
		await post(app, { messages: [{ role: "user", content: "b" }] });
		expect(seen).toHaveLength(2);
		expect(seen[0].sessionId).not.toBe(seen[1].sessionId);
		expect(seen[0].sessionId.startsWith("api-")).toBe(true);
		expect(seen[0].channel).toBe("api");
	});

	test("x-paw-session header reuses the named session", async () => {
		const { app, seen } = makeApp();
		await post(
			app,
			{ messages: [{ role: "user", content: "a" }] },
			{
				...AUTH,
				"x-paw-session": "api-fixed",
			},
		);
		expect(seen[0].sessionId).toBe("api-fixed");
	});

	test("429 when rate-limited", async () => {
		const { app } = makeApp({
			rateLimit: () => ({ allowed: false, retryAfterMs: 1000 }),
		});
		const res = await post(app, {
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.status).toBe(429);
	});
});
