import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { StreamChunk } from "../../ai/base-provider.js";
import type { InboundMessage } from "../../types/message.js";

/**
 * OpenAI-compatible API surface (B7). `POST /v1/chat/completions` (+ a probe
 * `GET /v1/models`) maps onto Paw's EXISTING turn path (kernel.handleInboundStream)
 * — tools, skills, memory all apply — and returns the OpenAI response shape.
 *
 * Threat model: this is a programmatic door to the whole agent.
 *   - Bearer required (vault slot `api.bearerToken`); DISABLED when unset (401).
 *   - Rate-limited (action class, per-IP) via the injected `rateLimit`.
 *   - Session-isolated: an `x-paw-session` header reuses that session (server-side
 *     history); otherwise each request gets an ephemeral `api-<uuid>` session, so
 *     callers never see each other's history.
 */

type OpenAiContent = string | Array<{ type?: string; text?: string }>;
interface OpenAiMessage {
	role: string;
	content?: OpenAiContent;
}
interface ChatCompletionsBody {
	model?: string;
	messages?: OpenAiMessage[];
	stream?: boolean;
	// Any other OpenAI params (temperature, top_p, …) are accepted and ignored.
}

export interface OpenAiApiDeps {
	/** Run one turn for a synthetic inbound message; yields Paw stream chunks. */
	runTurn: (msg: InboundMessage) => AsyncGenerator<StreamChunk>;
	/** Configured bearer token (vault/config). Empty string ⇒ endpoint disabled. */
	getBearer: () => string;
	/** Per-IP rate-limit check (action class). */
	rateLimit: (ip: string) => { allowed: boolean; retryAfterMs?: number };
	getClientIp: (c: Context) => string;
	/** Model ids to advertise from /v1/models. */
	listModels: () => string[];
	/** Monotonic-ish timestamp source (injectable for tests). */
	now?: () => number;
}

/** Constant-time string compare (avoid leaking the key length/contents via timing). */
export function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}

function contentToString(content: OpenAiContent | undefined): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((p) => (typeof p?.text === "string" ? p.text : ""))
			.join("");
	}
	return "";
}

/**
 * Flatten OpenAI `messages[]` into Paw's single-string turn input. System
 * messages are dropped (Paw builds its own). A single user turn passes through;
 * a multi-turn payload from a stateless client is folded into a transcript so
 * context survives even on an ephemeral session.
 */
export function buildTurnContent(
	messages: OpenAiMessage[] | undefined,
): string {
	const turns = (messages ?? []).filter(
		(m) => m.role === "user" || m.role === "assistant",
	);
	if (turns.length === 0) return "";
	const last = turns[turns.length - 1];
	if (turns.length === 1) return contentToString(last.content);
	const prior = turns
		.slice(0, -1)
		.map((m) => `${m.role}: ${contentToString(m.content)}`)
		.join("\n");
	return `Conversation so far:\n${prior}\n\nCurrent ${last.role} message:\n${contentToString(last.content)}`;
}

export function completionResponse(
	content: string,
	model: string,
	id: string,
	created: number,
): Record<string, unknown> {
	return {
		id,
		object: "chat.completion",
		created,
		model,
		choices: [
			{
				index: 0,
				message: { role: "assistant", content },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
	};
}

export function streamChunk(
	text: string,
	model: string,
	id: string,
	created: number,
): Record<string, unknown> {
	return {
		id,
		object: "chat.completion.chunk",
		created,
		model,
		choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
	};
}

export function finalStreamChunk(
	model: string,
	id: string,
	created: number,
): Record<string, unknown> {
	return {
		id,
		object: "chat.completion.chunk",
		created,
		model,
		choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
	};
}

export function modelsResponse(
	models: string[],
	created: number,
): Record<string, unknown> {
	return {
		object: "list",
		data: models.map((id) => ({
			id,
			object: "model",
			created,
			owned_by: "paw",
		})),
	};
}

export function createOpenAiApi(deps: OpenAiApiDeps): Hono {
	const app = new Hono();
	const nowMs = deps.now ?? (() => Date.now());

	/** Bearer + rate-limit gate shared by all /v1 routes. Returns a Response on reject, else null. */
	const guard = (c: Context): Response | null => {
		const expected = deps.getBearer();
		// Disabled unless a key is configured.
		if (!expected) return c.json({ error: { message: "API disabled" } }, 401);
		const auth = c.req.header("Authorization") ?? "";
		const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
		if (!provided || !constantTimeEqual(provided, expected)) {
			return c.json({ error: { message: "Unauthorized" } }, 401);
		}
		const { allowed, retryAfterMs } = deps.rateLimit(deps.getClientIp(c));
		if (!allowed) {
			c.header(
				"Retry-After",
				String(Math.ceil((retryAfterMs ?? 60_000) / 1000)),
			);
			return c.json({ error: { message: "Too many requests" } }, 429);
		}
		return null;
	};

	app.get("/v1/models", (c) => {
		const rejected = guard(c);
		if (rejected) return rejected;
		const sec = Math.floor(nowMs() / 1000);
		return c.json(modelsResponse(deps.listModels(), sec));
	});

	app.post("/v1/chat/completions", async (c) => {
		const rejected = guard(c);
		if (rejected) return rejected;

		let body: ChatCompletionsBody;
		try {
			body = await c.req.json<ChatCompletionsBody>();
		} catch {
			return c.json({ error: { message: "Invalid JSON body" } }, 400);
		}
		const content = buildTurnContent(body.messages);
		if (!content.trim()) {
			return c.json({ error: { message: "No user message provided" } }, 400);
		}

		const model = body.model || deps.listModels()[0] || "paw";
		const created = Math.floor(nowMs() / 1000);
		const id = `chatcmpl-${crypto.randomUUID()}`;
		// Reuse a named session (server-side history) or isolate per request.
		const headerSession = c.req.header("x-paw-session");
		const sessionId = headerSession || `api-${crypto.randomUUID()}`;
		const msg: InboundMessage = {
			id: crypto.randomUUID(),
			sessionId,
			channel: "api",
			content,
			user: { id: "api", name: "API" },
			timestamp: new Date(nowMs()).toISOString(),
		};

		if (body.stream) {
			return streamSSE(c, async (stream) => {
				try {
					for await (const chunk of deps.runTurn(msg)) {
						if (chunk.type === "text_delta" && chunk.text) {
							await stream.writeSSE({
								data: JSON.stringify(
									streamChunk(chunk.text, model, id, created),
								),
							});
						}
					}
					await stream.writeSSE({
						data: JSON.stringify(finalStreamChunk(model, id, created)),
					});
					await stream.writeSSE({ data: "[DONE]" });
				} catch (err) {
					await stream.writeSSE({
						data: JSON.stringify({
							error: {
								message: err instanceof Error ? err.message : String(err),
							},
						}),
					});
					await stream.writeSSE({ data: "[DONE]" });
				}
			});
		}

		// Non-streaming: accumulate text deltas from the same turn path.
		let text = "";
		try {
			for await (const chunk of deps.runTurn(msg)) {
				if (chunk.type === "text_delta" && chunk.text) text += chunk.text;
			}
		} catch (err) {
			return c.json(
				{
					error: { message: err instanceof Error ? err.message : String(err) },
				},
				500,
			);
		}
		return c.json(completionResponse(text, model, id, created));
	});

	return app;
}
