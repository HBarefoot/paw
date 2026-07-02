import { FRAME_CLOSE, FRAME_OPEN } from "../security/untrusted.js";
import type { ToolResultImage } from "../types/message.js";
import type { Logger } from "../types/plugin.js";
import type {
	AIProvider,
	ChatMessage,
	ChatResponse,
	StreamChunk,
	SystemPromptInput,
} from "./base-provider.js";
import {
	CHECKPOINT_PROMPT,
	maxRoundtripsResponse,
	systemPromptToString,
} from "./base-provider.js";
import {
	type ToolCallRequest,
	executeToolsParallel,
	executeToolsParallelStreaming,
} from "./parallel-tools.js";
import { withRetry } from "./retry.js";
import type { SkillManager } from "./skills.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import { needsSessionId } from "./tool-context.js";
import { summarizeToolInput } from "./tool-summary.js";
import type { ToolRegistry } from "./tools.js";

export interface OllamaProviderConfig {
	baseUrl: string;
	model: string;
	maxToolRoundtrips: number;
	requestTimeoutMs?: number;
	apiKey?: string;
	/** Max tokens to generate per response (Ollama `options.num_predict`). */
	maxTokens?: number;
}

interface OllamaMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	tool_calls?: OllamaToolCall[];
	images?: string[];
}

interface OllamaToolCall {
	function: {
		name: string;
		arguments: Record<string, unknown>;
	};
}

interface OllamaTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

interface OllamaResponse {
	message: {
		role: string;
		content: string;
		tool_calls?: OllamaToolCall[];
	};
	done: boolean;
}

/** Cap tool-result content pushed into the Ollama conversation to avoid
 *  blowing up the context window / request payload on cloud endpoints. */
const MAX_TOOL_RESULT_CHARS = 4_000;

function truncateToolResult(content: string): string {
	if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
	const head = `${content.slice(
		0,
		MAX_TOOL_RESULT_CHARS,
	)}\n\n[Truncated — original was ${content.length} chars]`;
	// If the content was framed as untrusted tool output, re-append the closing
	// sentinel so truncation never leaves the data boundary open.
	return content.startsWith(FRAME_OPEN) ? `${head}\n${FRAME_CLOSE}` : head;
}

/** Absolute ceiling on a single model response. Ollama has no server-side
 *  max-tokens unless we send `num_predict`, and a degenerate/looping model can
 *  stream the same text until the request times out — accumulating megabytes in
 *  memory and (with many roundtrips) OOM-ing the process. This ceiling is far
 *  above any legitimate response (full canvas HTML is tens of KB), so it never
 *  truncates real output; it only stops runaway generation. */
const MAX_RESPONSE_CHARS = 300_000;
/** Generous floor for `num_predict` so we never truncate legit long output
 *  (e.g. a full inline HTML canvas page) even if the user configured a small
 *  maxTokens for chat. The char ceiling above is the real OOM safety net. */
const MIN_NUM_PREDICT = 8_192;

/** Detect a degenerate repetition loop: the same short tail repeated many times
 *  back-to-back. Returns true once the response is clearly stuck repeating. */
function isRepeatingTail(s: string): boolean {
	const n = s.length;
	if (n < 2_400) return false;
	// Check a few unit sizes; if the last `unit` chars equal the `unit` before
	// them for ~20 consecutive windows, it's a loop.
	for (const unit of [40, 80, 120]) {
		if (n < unit * 20) continue;
		let reps = 0;
		const last = s.slice(n - unit);
		for (let k = 2; k <= 20; k++) {
			const seg = s.slice(n - unit * k, n - unit * (k - 1));
			if (seg === last) reps++;
			else break;
		}
		if (reps >= 19) return true;
	}
	return false;
}

export class OllamaProvider implements AIProvider {
	readonly name = "ollama";
	private baseUrl: string;
	private model: string;
	private maxToolRoundtrips: number;
	private requestTimeoutMs: number;
	private apiKey: string | undefined;
	private numPredict: number;
	readonly toolRegistry: ToolRegistry;
	private skillManager: SkillManager | null;
	private logger: Logger;

	constructor(
		config: OllamaProviderConfig,
		toolRegistry: ToolRegistry,
		logger: Logger,
		skillManager?: SkillManager,
	) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
		this.model = config.model;
		this.maxToolRoundtrips = config.maxToolRoundtrips;
		this.requestTimeoutMs = config.requestTimeoutMs ?? 300_000;
		this.apiKey = config.apiKey;
		// Generous cap so legitimate long output (canvas HTML) is never cut off.
		this.numPredict = Math.max(config.maxTokens ?? 0, MIN_NUM_PREDICT);
		this.toolRegistry = toolRegistry;
		this.skillManager = skillManager ?? null;
		this.logger = logger;

		this.logger.info("Ollama provider initialized", {
			baseUrl: this.baseUrl,
			model: this.model,
		});
	}

	private get headers(): Record<string, string> {
		const h: Record<string, string> = { "Content-Type": "application/json" };
		if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
		return h;
	}

	private getTools(sessionId?: string): OllamaTool[] {
		const raw =
			!this.skillManager || !sessionId
				? this.toolRegistry.toAnthropicTools()
				: (() => {
						const allowed = this.skillManager.getActiveToolNames(sessionId);
						allowed.add("activate_skill");
						if (this.toolRegistry.get("spawn_agent")) {
							allowed.add("spawn_agent");
						}
						return this.toolRegistry.toAnthropicToolsFiltered(allowed);
					})();

		return raw.map((t) => ({
			type: "function" as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.input_schema,
			},
		}));
	}

	/**
	 * One extra, tool-less request to distill the in-turn transcript into a
	 * compact checkpoint when the roundtrip budget is exhausted. Runs at most
	 * once per turn; returns undefined on any failure/abort.
	 */
	private async generateCheckpoint(
		conversation: OllamaMessage[],
		signal?: AbortSignal,
	): Promise<string | undefined> {
		try {
			const cpConversation: OllamaMessage[] = [
				...conversation,
				{ role: "user", content: CHECKPOINT_PROMPT },
			];
			const data = await withRetry(async () => {
				const res = await fetch(`${this.baseUrl}/api/chat`, {
					method: "POST",
					headers: this.headers,
					body: JSON.stringify({
						model: this.model,
						messages: cpConversation,
						stream: false,
						options: { num_predict: this.numPredict },
						// tools intentionally omitted — the checkpoint is text-only.
					}),
					signal: signal
						? AbortSignal.any([
								signal,
								AbortSignal.timeout(this.requestTimeoutMs),
							])
						: AbortSignal.timeout(this.requestTimeoutMs),
				});
				if (!res.ok) {
					throw new Error(`Ollama error (${res.status}): ${await res.text()}`);
				}
				return (await res.json()) as OllamaResponse;
			}, this.logger);
			return data.message.content?.trim() || undefined;
		} catch (err) {
			this.logger.warn("Checkpoint generation failed", { error: String(err) });
			return undefined;
		}
	}

	async chat(
		messages: ChatMessage[],
		systemPrompt?: SystemPromptInput,
		sessionId?: string,
		opts?: { signal?: AbortSignal },
	): Promise<ChatResponse> {
		let roundtrips = 0;
		let lastText = "";
		const collectedImages: ToolResultImage[] = [];
		const signal = opts?.signal;

		const actualSystemPrompt = systemPrompt
			? systemPromptToString(systemPrompt)
			: DEFAULT_SYSTEM_PROMPT;
		const conversation: OllamaMessage[] = [
			{ role: "system", content: actualSystemPrompt },
			...messages.map((m) => {
				const msg: OllamaMessage = {
					role: m.role as "user" | "assistant",
					content: m.content,
				};
				if (m.role === "user" && m.attachments && m.attachments.length > 0) {
					msg.images = m.attachments
						.filter((a) => a.type === "image" && a.data)
						.map((a) => a.data!.toString("base64"));

					// Ollama has no separate channel for non-image attachments, so
					// inline any text attachments as fenced blocks in the content.
					const textParts = m.attachments
						.filter((a) => a.type === "text" && a.data)
						.map((a) => {
							const name = a.name ? ` (${a.name})` : "";
							const body = a.data!.toString("utf-8");
							return `\n\n--- attached text${name} ---\n${body}`;
						});
					if (textParts.length > 0) {
						msg.content = m.content + textParts.join("");
					}
				}
				return msg;
			}),
		];

		this.logger.debug("Ollama system prompt", {
			fromArg: !!systemPrompt,
			length: actualSystemPrompt.length,
		});

		while (roundtrips < this.maxToolRoundtrips) {
			const tools = this.getTools(sessionId);
			this.logger.debug("Sending request to Ollama", {
				roundtrip: roundtrips,
				model: this.model,
				toolCount: tools.length,
			});

			const body: Record<string, unknown> = {
				model: this.model,
				messages: conversation,
				stream: false,
				options: { num_predict: this.numPredict },
			};

			if (tools.length > 0) {
				body.tools = tools;
			}

			const data = await withRetry(async () => {
				const res = await fetch(`${this.baseUrl}/api/chat`, {
					method: "POST",
					headers: this.headers,
					body: JSON.stringify(body),
					// H-NEW-5: combine the caller's signal with the
					// per-request timeout so cancel + hard timeout both work.
					signal: signal
						? AbortSignal.any([
								signal,
								AbortSignal.timeout(this.requestTimeoutMs),
							])
						: AbortSignal.timeout(this.requestTimeoutMs),
				});

				if (!res.ok) {
					const text = await res.text();
					throw new Error(`Ollama error (${res.status}): ${text}`);
				}

				return (await res.json()) as OllamaResponse;
			}, this.logger);
			const toolCalls = data.message.tool_calls;
			lastText = data.message.content || "";

			// No tool calls — return the text response
			if (!toolCalls || toolCalls.length === 0) {
				return {
					text: data.message.content || "",
					images: collectedImages.length > 0 ? collectedImages : undefined,
				};
			}

			// Add assistant message with tool calls
			conversation.push({
				role: "assistant",
				content: data.message.content || "",
				tool_calls: toolCalls,
			});

			// Phase 1: Handle activate_skill calls first (they change available tools)
			const regularCalls: ToolCallRequest[] = [];
			for (const call of toolCalls) {
				if (
					call.function.name === "activate_skill" &&
					this.skillManager &&
					sessionId
				) {
					const skillName = call.function.arguments.skill as string;
					const entry = this.skillManager.activateSkill(sessionId, skillName);
					if (entry) {
						this.logger.info("Skill activated", {
							skill: skillName,
							tools: entry.toolNames,
						});
						conversation.push({
							role: "tool",
							content: `Skill "${skillName}" activated. You now have access to: ${entry.toolNames.join(", ")}`,
						});
						continue;
					}
				}

				const toolArgs = { ...call.function.arguments };
				if (needsSessionId(call.function.name) && sessionId) {
					toolArgs.__sessionId = sessionId;
				}
				regularCalls.push({
					id: call.function.name,
					name: call.function.name,
					input: toolArgs,
				});
			}

			// Phase 2: Execute remaining tools in parallel
			if (regularCalls.length > 0) {
				const results = await executeToolsParallel(
					regularCalls,
					this.toolRegistry,
					this.logger,
					300_000,
					sessionId,
				);
				for (const r of results) {
					if (r.images) collectedImages.push(...r.images);
					// M-NEW-8: surface is_error to the model.
					const raw = r.is_error
						? `[Tool error] ${r.content}\n(Fix and call again.)`
						: r.content;
					conversation.push({
						role: "tool",
						content: truncateToolResult(raw),
					});
				}
			}

			roundtrips++;
			this.logger.info("Tool roundtrip completed", {
				roundtrip: roundtrips,
				maxRoundtrips: this.maxToolRoundtrips,
			});
		}

		this.logger.warn("Max tool roundtrips reached", {
			roundtrips,
			maxRoundtrips: this.maxToolRoundtrips,
		});
		const checkpoint = await this.generateCheckpoint(conversation, signal);
		return maxRoundtripsResponse(
			lastText,
			roundtrips,
			checkpoint,
			collectedImages,
		);
	}

	async *chatStream(
		messages: ChatMessage[],
		systemPrompt?: SystemPromptInput,
		sessionId?: string,
		opts?: { signal?: AbortSignal },
	): AsyncGenerator<StreamChunk> {
		let roundtrips = 0;
		const signal = opts?.signal;
		const collectedImages: ToolResultImage[] = [];

		const actualSystemPrompt = systemPrompt
			? systemPromptToString(systemPrompt)
			: DEFAULT_SYSTEM_PROMPT;
		const conversation: OllamaMessage[] = [
			{ role: "system", content: actualSystemPrompt },
			...messages.map((m) => {
				const msg: OllamaMessage = {
					role: m.role as "user" | "assistant",
					content: m.content,
				};
				if (m.role === "user" && m.attachments && m.attachments.length > 0) {
					msg.images = m.attachments
						.filter((a) => a.type === "image" && a.data)
						.map((a) => a.data!.toString("base64"));

					// Ollama has no separate channel for non-image attachments, so
					// inline any text attachments as fenced blocks in the content.
					const textParts = m.attachments
						.filter((a) => a.type === "text" && a.data)
						.map((a) => {
							const name = a.name ? ` (${a.name})` : "";
							const body = a.data!.toString("utf-8");
							return `\n\n--- attached text${name} ---\n${body}`;
						});
					if (textParts.length > 0) {
						msg.content = m.content + textParts.join("");
					}
				}
				return msg;
			}),
		];

		while (roundtrips < this.maxToolRoundtrips) {
			yield { type: "roundtrip_start", roundtrip: roundtrips };

			const tools = this.getTools(sessionId);
			this.logger.debug("Streaming request to Ollama", {
				roundtrip: roundtrips,
				model: this.model,
				toolCount: tools.length,
			});

			const body: Record<string, unknown> = {
				model: this.model,
				messages: conversation,
				stream: true,
				options: { num_predict: this.numPredict },
			};

			if (tools.length > 0) {
				body.tools = tools;
			}

			let res!: Response;
			const MAX_STREAM_RETRIES = 3;
			let lastStreamErr: string | undefined;
			let fetchOk = false;
			for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
				if (signal?.aborted) throw new Error("Aborted");
				try {
					res = await fetch(`${this.baseUrl}/api/chat`, {
						method: "POST",
						headers: this.headers,
						body: JSON.stringify(body),
						// H-NEW-5: combine signal with per-request timeout.
						signal: signal
							? AbortSignal.any([
									signal,
									AbortSignal.timeout(this.requestTimeoutMs),
								])
							: AbortSignal.timeout(this.requestTimeoutMs),
					});
				} catch (err) {
					if (signal?.aborted) throw err;
					lastStreamErr = err instanceof Error ? err.message : String(err);
					if (attempt < MAX_STREAM_RETRIES) {
						const delayMs = Math.min(1000 * Math.pow(2, attempt), 15_000);
						this.logger.warn("Stream fetch failed, retrying", {
							attempt: attempt + 1,
							delayMs,
							error: lastStreamErr,
						});
						await new Promise((r) => setTimeout(r, delayMs));
						continue;
					}
					yield {
						type: "error",
						error: `Unable to connect to Ollama at ${this.baseUrl}. ${lastStreamErr}`,
					};
					yield { type: "done" };
					return;
				}

				if (!res!.ok) {
					const text = await res!.text();
					const status = res!.status;
					const isRetryable = [429, 500, 502, 503, 529].includes(status);
					if (isRetryable && attempt < MAX_STREAM_RETRIES) {
						const delayMs = Math.min(1000 * Math.pow(2, attempt), 15_000);
						this.logger.warn("Stream request failed, retrying", {
							attempt: attempt + 1,
							delayMs,
							status,
							error: text,
						});
						await new Promise((r) => setTimeout(r, delayMs));
						continue;
					}
					yield { type: "error", error: `Ollama error (${status}): ${text}` };
					yield { type: "done" };
					return;
				}

				fetchOk = true;
				break;
			}
			if (!fetchOk) {
				yield {
					type: "error",
					error: `Ollama stream failed after ${MAX_STREAM_RETRIES} retries: ${lastStreamErr}`,
				};
				yield { type: "done" };
				return;
			}

			// Read NDJSON stream
			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let fullContent = "";
			let toolCalls: OllamaToolCall[] | undefined;
			let streamError = false;
			// Guard against a runaway/looping model that streams forever (Ollama
			// has no hard server-side stop): bail out of the read loop once the
			// response is absurdly large or stuck repeating, before it OOMs us.
			let runawayCut = false;

			try {
				while (true) {
					// H-NEW-5: race the read against both the caller's
					// cancel signal and the per-request timeout.
					const readResult = await Promise.race([
						reader.read(),
						new Promise<never>((_, reject) => {
							if (signal) {
								const onAbort = () => reject(new Error("Aborted"));
								if (signal.aborted) onAbort();
								else signal.addEventListener("abort", onAbort, { once: true });
							}
							setTimeout(
								() => reject(new Error("Ollama stream read timed out")),
								this.requestTimeoutMs,
							);
						}),
					]);
					const { done, value } = readResult;
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";

					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							const chunk = JSON.parse(line) as OllamaResponse;
							if (chunk.message?.content) {
								fullContent += chunk.message.content;
								yield { type: "text_delta", text: chunk.message.content };
								if (
									fullContent.length > MAX_RESPONSE_CHARS ||
									isRepeatingTail(fullContent)
								) {
									runawayCut = true;
									break;
								}
							}
							if (chunk.message?.tool_calls) {
								// Accumulate across NDJSON chunks — some Ollama
								// models stream tool calls in a separate/late
								// chunk, and overwriting would drop earlier ones.
								toolCalls = [...(toolCalls ?? []), ...chunk.message.tool_calls];
							}
						} catch {
							// Skip malformed lines
						}
					}
					if (runawayCut) break;
				}

				if (runawayCut) {
					this.logger.warn("Ollama response cut off (runaway/oversized)", {
						chars: fullContent.length,
						model: this.model,
					});
					try {
						await reader.cancel();
					} catch {
						/* best-effort */
					}
					yield {
						type: "text_delta",
						text: "\n\n[Response stopped — the model was generating an unusually long or repeating output.]",
					};
				}

				// Process remaining buffer
				if (!runawayCut && buffer.trim()) {
					try {
						const chunk = JSON.parse(buffer) as OllamaResponse;
						if (chunk.message?.content) {
							fullContent += chunk.message.content;
							yield { type: "text_delta", text: chunk.message.content };
						}
						if (chunk.message?.tool_calls) {
							toolCalls = [...(toolCalls ?? []), ...chunk.message.tool_calls];
						}
					} catch {
						// Skip
					}
				}
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				this.logger.error("Stream read error", { error: errMsg });
				yield {
					type: "error",
					error: `Ollama stream interrupted: ${errMsg}`,
				};
				yield { type: "done" };
				streamError = true;
				// H-NEW-5: cancel the reader so the connection is released
				// immediately on abort/timeout, not when the GC eventually
				// finalizes the body stream.
				try {
					reader.cancel();
				} catch {
					// already closed — fine
				}
			}

			if (streamError) return;

			// No tool calls — done
			if (!toolCalls || toolCalls.length === 0) {
				yield { type: "done" };
				return;
			}

			// Add assistant message with tool calls
			conversation.push({
				role: "assistant",
				content: fullContent,
				tool_calls: toolCalls,
			});

			yield { type: "thinking" };

			// Phase 1: Handle activate_skill calls first
			const streamRegularCalls: ToolCallRequest[] = [];
			for (let i = 0; i < toolCalls.length; i++) {
				const call = toolCalls[i];
				const toolInput = { ...call.function.arguments };
				if (needsSessionId(call.function.name) && sessionId) {
					toolInput.__sessionId = sessionId;
				}
				const toolId = `ollama-${roundtrips}-${call.function.name}-${i}`;
				const summary = summarizeToolInput(call.function.name, toolInput);

				if (
					call.function.name === "activate_skill" &&
					this.skillManager &&
					sessionId
				) {
					const skillName = toolInput.skill as string;
					const entry = this.skillManager.activateSkill(sessionId, skillName);
					if (entry) {
						this.logger.info("Skill activated (stream)", {
							skill: skillName,
							tools: entry.toolNames,
						});
						conversation.push({
							role: "tool",
							content: `Skill "${skillName}" activated. You now have access to: ${entry.toolNames.join(", ")}`,
						});
						yield {
							type: "tool_start",
							toolName: call.function.name,
							toolId,
							toolInput,
							toolSummary: summary,
							roundtrip: roundtrips,
						};
						yield {
							type: "tool_end",
							toolName: call.function.name,
							toolId,
							toolResult: `Activated: ${entry.toolNames.join(", ")}`,
							toolIsError: false,
							durationMs: 0,
						};
						continue;
					}
				}

				streamRegularCalls.push({
					id: toolId,
					name: call.function.name,
					input: toolInput,
				});
			}

			// Phase 2: Execute remaining tools in parallel with streaming
			if (streamRegularCalls.length > 0) {
				const gen = executeToolsParallelStreaming(
					streamRegularCalls,
					this.toolRegistry,
					this.logger,
					roundtrips,
					undefined,
					sessionId,
				);
				let next = await gen.next();
				while (!next.done) {
					yield next.value;
					next = await gen.next();
				}
				for (const r of next.value) {
					if (r.images) collectedImages.push(...r.images);
					// M-NEW-8: surface is_error to the model.
					const raw = r.is_error
						? `[Tool error] ${r.content}\n(Fix and call again.)`
						: r.content;
					conversation.push({
						role: "tool",
						content: truncateToolResult(raw),
					});
				}
			}

			roundtrips++;
			this.logger.info("Tool roundtrip completed (stream)", {
				roundtrip: roundtrips,
				maxRoundtrips: this.maxToolRoundtrips,
			});

			yield { type: "thinking" };
		}

		// Budget exhausted: emit a provider→kernel-only checkpoint chunk (never
		// forwarded to the browser). The kernel drives the continuation leg.
		const checkpoint = await this.generateCheckpoint(conversation, signal);
		yield {
			type: "checkpoint",
			stopReason: "max_roundtrips",
			roundtripsUsed: roundtrips,
			checkpoint,
		};
		yield { type: "done" };
	}

	async healthCheck(): Promise<{ ok: boolean; details?: string }> {
		try {
			const res = await fetch(`${this.baseUrl}/api/tags`, {
				headers: this.headers,
			});
			if (!res.ok) return { ok: false, details: `HTTP ${res.status}` };
			const data = (await res.json()) as { models?: Array<{ name: string }> };
			const models = data.models?.map((m) => m.name) ?? [];
			const hasModel = models.some((m) => m.startsWith(this.model));
			return {
				ok: true,
				details: hasModel
					? `Connected, model "${this.model}" available`
					: `Connected, but model "${this.model}" not found. Available: ${models.join(", ")}`,
			};
		} catch (err) {
			return {
				ok: false,
				details: `Cannot reach Ollama at ${this.baseUrl}: ${err}`,
			};
		}
	}
}
