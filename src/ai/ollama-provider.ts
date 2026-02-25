import { ToolRegistry } from "./tools.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import { withRetry } from "./retry.js";
import type {
	AIProvider,
	ChatMessage,
	ChatResponse,
	StreamChunk,
} from "./base-provider.js";
import { summarizeToolInput } from "./tool-summary.js";
import type { ToolResultImage } from "../types/message.js";
import type { SkillManager } from "./skills.js";
import type { Logger } from "../types/plugin.js";

export interface OllamaProviderConfig {
	baseUrl: string;
	model: string;
	maxToolRoundtrips: number;
	requestTimeoutMs?: number;
	apiKey?: string;
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
	return (
		content.slice(0, MAX_TOOL_RESULT_CHARS) +
		`\n\n[Truncated — original was ${content.length} chars]`
	);
}

export class OllamaProvider implements AIProvider {
	readonly name = "ollama";
	private baseUrl: string;
	private model: string;
	private maxToolRoundtrips: number;
	private requestTimeoutMs: number;
	private apiKey: string | undefined;
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

	async chat(
		messages: ChatMessage[],
		systemPrompt?: string,
		sessionId?: string,
	): Promise<ChatResponse> {
		let roundtrips = 0;
		const collectedImages: ToolResultImage[] = [];

		const actualSystemPrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
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
			};

			if (tools.length > 0) {
				body.tools = tools;
			}

			const data = await withRetry(async () => {
				const res = await fetch(`${this.baseUrl}/api/chat`, {
					method: "POST",
					headers: this.headers,
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(this.requestTimeoutMs),
				});

				if (!res.ok) {
					const text = await res.text();
					throw new Error(`Ollama error (${res.status}): ${text}`);
				}

				return (await res.json()) as OllamaResponse;
			}, this.logger);
			const toolCalls = data.message.tool_calls;

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

			// Execute each tool call and add results
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

				this.logger.info("Executing tool", { tool: call.function.name });
				const TOOL_TIMEOUT_MS = 300_000;
				let result: { content?: string; is_error?: boolean; images?: Array<{ media_type: string; base64: string }> };
				try {
					result = await Promise.race([
						this.toolRegistry.execute(call.function.name, call.function.arguments),
						new Promise<never>((_, reject) =>
							setTimeout(
								() => reject(new Error(`Tool "${call.function.name}" timed out after 10 minutes`)),
								TOOL_TIMEOUT_MS,
							),
						),
					]);
				} catch (err) {
					result = {
						content: err instanceof Error ? err.message : String(err),
						is_error: true,
					};
				}
				if (result.images) {
					collectedImages.push(...result.images);
				}
				conversation.push({
					role: "tool",
					content: truncateToolResult(result.content ?? ""),
				});
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
		return {
			text: `I've reached the maximum number of tool-use steps (${roundtrips}/${this.maxToolRoundtrips}). Here's what I've done so far - please let me know if you'd like me to continue.`,
			images: collectedImages.length > 0 ? collectedImages : undefined,
		};
	}

	async *chatStream(
		messages: ChatMessage[],
		systemPrompt?: string,
		sessionId?: string,
	): AsyncGenerator<StreamChunk> {
		let roundtrips = 0;

		const actualSystemPrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
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
			};

			if (tools.length > 0) {
				body.tools = tools;
			}

			let res!: Response;
			const MAX_STREAM_RETRIES = 3;
			let lastStreamErr: string | undefined;
			let fetchOk = false;
			for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
				try {
					res = await fetch(`${this.baseUrl}/api/chat`, {
						method: "POST",
						headers: this.headers,
						body: JSON.stringify(body),
						signal: AbortSignal.timeout(this.requestTimeoutMs),
					});
				} catch (err) {
					lastStreamErr = err instanceof Error ? err.message : String(err);
					if (attempt < MAX_STREAM_RETRIES) {
						const delayMs = Math.min(1000 * Math.pow(2, attempt), 15_000);
						this.logger.warn("Stream fetch failed, retrying", { attempt: attempt + 1, delayMs, error: lastStreamErr });
						await new Promise((r) => setTimeout(r, delayMs));
						continue;
					}
					yield { type: "error", error: `Unable to connect to Ollama at ${this.baseUrl}. ${lastStreamErr}` };
					yield { type: "done" };
					return;
				}

				if (!res!.ok) {
					const text = await res!.text();
					const status = res!.status;
					const isRetryable = [429, 500, 502, 503, 529].includes(status);
					if (isRetryable && attempt < MAX_STREAM_RETRIES) {
						const delayMs = Math.min(1000 * Math.pow(2, attempt), 15_000);
						this.logger.warn("Stream request failed, retrying", { attempt: attempt + 1, delayMs, status, error: text });
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
				yield { type: "error", error: `Ollama stream failed after ${MAX_STREAM_RETRIES} retries: ${lastStreamErr}` };
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

			try {
				while (true) {
					const readResult = await Promise.race([
						reader.read(),
						new Promise<never>((_, reject) =>
							setTimeout(
								() => reject(new Error("Ollama stream read timed out")),
								this.requestTimeoutMs,
							),
						),
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
							}
							if (chunk.message?.tool_calls) {
								toolCalls = chunk.message.tool_calls;
							}
						} catch {
							// Skip malformed lines
						}
					}
				}

				// Process remaining buffer
				if (buffer.trim()) {
					try {
						const chunk = JSON.parse(buffer) as OllamaResponse;
						if (chunk.message?.content) {
							fullContent += chunk.message.content;
							yield { type: "text_delta", text: chunk.message.content };
						}
						if (chunk.message?.tool_calls) {
							toolCalls = chunk.message.tool_calls;
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

			// Execute each tool call
			for (let i = 0; i < toolCalls.length; i++) {
				const call = toolCalls[i];
				const toolInput = call.function.arguments;
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

				yield {
					type: "tool_start",
					toolName: call.function.name,
					toolId,
					toolInput,
					toolSummary: summary,
					roundtrip: roundtrips,
				};

				this.logger.info("Executing tool (stream)", {
					tool: call.function.name,
				});

				const TOOL_TIMEOUT_MS = 600_000; // 10 minutes
				const startTime = Date.now();
				let result: { content?: string; is_error?: boolean; images?: Array<{ media_type: string; base64: string }> };
				try {
					result = await Promise.race([
						this.toolRegistry.execute(call.function.name, toolInput),
						new Promise<never>((_, reject) =>
							setTimeout(
								() => reject(new Error(`Tool "${call.function.name}" timed out after 10 minutes`)),
								TOOL_TIMEOUT_MS,
							),
						),
					]);
				} catch (err) {
					result = {
						content: err instanceof Error ? err.message : String(err),
						is_error: true,
					};
				}
				const durationMs = Date.now() - startTime;

				yield {
					type: "tool_end",
					toolName: call.function.name,
					toolId,
					toolResult: (result.content ?? "").slice(0, 500),
					toolIsError: result.is_error,
					durationMs,
				};

				conversation.push({
					role: "tool",
					content: truncateToolResult(result.content ?? ""),
				});
			}

			roundtrips++;
			this.logger.info("Tool roundtrip completed (stream)", {
				roundtrip: roundtrips,
				maxRoundtrips: this.maxToolRoundtrips,
			});

			yield { type: "thinking" };
		}

		yield {
			type: "text_delta",
			text: `I've reached the maximum number of tool-use steps (${roundtrips}/${this.maxToolRoundtrips}). Here's what I've done so far - please let me know if you'd like me to continue.`,
		};
		yield { type: "done" };
	}

	async healthCheck(): Promise<{ ok: boolean; details?: string }> {
		try {
			const res = await fetch(`${this.baseUrl}/api/tags`, { headers: this.headers });
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
