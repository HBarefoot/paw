import Anthropic from "@anthropic-ai/sdk";
import type {
	MessageParam,
	ContentBlockParam,
	ToolUseBlock,
	ToolResultBlockParam,
	MessageCreateParamsBase,
	TextBlockParam,
	Tool,
} from "@anthropic-ai/sdk/resources/messages";
import { ToolRegistry } from "./tools.js";
import { needsSessionId } from "./tool-context.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import { withRetry } from "./retry.js";
import {
	executeToolsParallel,
	executeToolsParallelStreaming,
	type ToolCallRequest,
} from "./parallel-tools.js";
import type {
	AIProvider,
	ChatMessage,
	ChatResponse,
	StreamChunk,
	SystemPromptInput,
} from "./base-provider.js";
import type { ToolResult, ToolResultImage } from "../types/message.js";
import type { SkillManager } from "./skills.js";
import type { Logger } from "../types/plugin.js";
import { summarizeToolInput } from "./tool-summary.js";

export interface ClaudeProviderConfig {
	apiKey: string;
	authMethod: "api_key" | "oauth";
	model: string;
	maxTokens: number;
	maxToolRoundtrips: number;
	/** Anthropic prompt caching for the stable prefix. Defaults to true. */
	promptCache?: boolean;
}

/**
 * Build the Claude `messages.stream(...)` request params. Pure + exported so the
 * cache-control wiring is unit-testable without a live client.
 *
 * When `promptCache` is on we mark the stable prefix with `cache_control:
 * ephemeral` so Anthropic bills it once per ~5-min window instead of every turn:
 *   - the system prompt's STABLE half becomes a cached text block, and any
 *     VOLATILE half (per-turn memory/feedback/brand) follows it as a second,
 *     uncached block — so volatile content reaches the model every turn without
 *     invalidating the cached prefix, and
 *   - the LAST tool carries the breakpoint (one breakpoint covers the whole
 *     tool-definitions prefix).
 * The moving conversation history is intentionally left uncached — it changes
 * every turn, and the system + tools prefix is the bulk of the win.
 *
 * `systemPrompt` may be a plain string (whole thing cached / concatenated) or a
 * `{ stable, volatile }` split. When `promptCache` is off the returned object is
 * byte-identical to the legacy shape (string `system`, untouched tools) so
 * disabling it is a true no-op.
 */
export function buildClaudeRequest(opts: {
	model: string;
	maxTokens: number;
	systemPrompt: SystemPromptInput;
	tools: Tool[];
	conversation: MessageParam[];
	promptCache: boolean;
}): MessageCreateParamsBase {
	const { model, maxTokens, systemPrompt, tools, conversation, promptCache } =
		opts;

	const stable =
		typeof systemPrompt === "string" ? systemPrompt : systemPrompt.stable;
	const volatile =
		typeof systemPrompt === "string" ? "" : systemPrompt.volatile;

	let system: string | TextBlockParam[];
	if (promptCache) {
		const blocks: TextBlockParam[] = [
			{ type: "text", text: stable, cache_control: { type: "ephemeral" } },
		];
		// Volatile context after the breakpoint: still sent every turn, but it
		// no longer changes the cached prefix bytes.
		if (volatile) blocks.push({ type: "text", text: volatile });
		system = blocks;
	} else {
		// Legacy shape: a string `system` is byte-identical to pre-cache builds.
		system = volatile ? `${stable}${volatile}` : stable;
	}

	let toolsField: Tool[] | undefined;
	if (tools.length > 0) {
		toolsField =
			promptCache && tools.length > 0
				? tools.map((t, i) =>
						i === tools.length - 1
							? { ...t, cache_control: { type: "ephemeral" } }
							: t,
					)
				: tools;
	}

	return {
		model,
		max_tokens: maxTokens,
		system,
		messages: conversation,
		...(toolsField ? { tools: toolsField } : {}),
	};
}

export class ClaudeProvider implements AIProvider {
	readonly name = "claude";
	private client: Anthropic;
	private model: string;
	private maxTokens: number;
	private maxToolRoundtrips: number;
	private promptCache: boolean;
	readonly toolRegistry: ToolRegistry;
	private skillManager: SkillManager | null;
	private logger: Logger;

	constructor(
		config: ClaudeProviderConfig,
		toolRegistry: ToolRegistry,
		logger: Logger,
		skillManager?: SkillManager,
	) {
		if (config.authMethod === "oauth") {
			this.client = new Anthropic({ authToken: config.apiKey, apiKey: null });
		} else {
			this.client = new Anthropic({ apiKey: config.apiKey });
		}

		this.model = config.model;
		this.maxTokens = config.maxTokens;
		this.maxToolRoundtrips = config.maxToolRoundtrips;
		this.promptCache = config.promptCache ?? true;
		this.toolRegistry = toolRegistry;
		this.skillManager = skillManager ?? null;
		this.logger = logger;

		this.logger.info("Claude provider initialized", {
			authMethod: config.authMethod,
			model: config.model,
		});
	}

	private getTools(sessionId?: string) {
		if (!this.skillManager || !sessionId) {
			return this.toolRegistry.toAnthropicTools();
		}
		const allowed = this.skillManager.getActiveToolNames(sessionId);
		allowed.add("activate_skill");
		// spawn_agent is always available for dynamic agent spawning
		if (this.toolRegistry.get("spawn_agent")) {
			allowed.add("spawn_agent");
		}
		return this.toolRegistry.toAnthropicToolsFiltered(allowed);
	}

	async chat(
		messages: ChatMessage[],
		systemPrompt?: SystemPromptInput,
		sessionId?: string,
		opts?: { signal?: AbortSignal },
	): Promise<ChatResponse> {
		let roundtrips = 0;
		const collectedImages: ToolResultImage[] = [];
		const signal = opts?.signal;
		const conversation: MessageParam[] = messages.map((m) => {
			if (m.role === "user" && m.attachments && m.attachments.length > 0) {
				const contentParts: ContentBlockParam[] = [];
				for (const att of m.attachments) {
					if (att.type === "image" && att.data && att.mimeType) {
						contentParts.push({
							type: "image",
							source: {
								type: "base64",
								media_type: att.mimeType as
									| "image/png"
									| "image/jpeg"
									| "image/gif"
									| "image/webp",
								data: att.data.toString("base64"),
							},
						} as ContentBlockParam);
					} else if (att.type === "text" && att.data) {
						const header = att.name ? `[File: ${att.name}]\n` : "";
						contentParts.push({
							type: "text",
							text: header + att.data.toString("utf-8"),
						} as ContentBlockParam);
					}
				}
				contentParts.push({
					type: "text",
					text: m.content,
				} as ContentBlockParam);
				return { role: m.role, content: contentParts };
			}
			return { role: m.role, content: m.content };
		});

		// Hoisted out of the loop: the tool list is stable across roundtrips, so
		// computing it once keeps the cached tool prefix byte-identical (and skips
		// re-running the full registry filter up to maxToolRoundtrips times). Only
		// an activate_skill in this turn flips `toolsDirty` to force a recompute.
		let tools = this.getTools(sessionId);
		let toolsDirty = false;

		while (roundtrips < this.maxToolRoundtrips) {
			if (toolsDirty) {
				tools = this.getTools(sessionId);
				toolsDirty = false;
			}
			this.logger.debug("Sending request to Claude", {
				roundtrip: roundtrips,
				messageCount: conversation.length,
				toolCount: tools.length,
			});

			const response = await withRetry(
				() =>
					this.client.messages
						.stream(
							buildClaudeRequest({
								model: this.model,
								maxTokens: this.maxTokens,
								systemPrompt: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
								tools: tools as Tool[],
								conversation,
								promptCache: this.promptCache,
							}),
						)
						.finalMessage(),
				this.logger,
				{ signal },
			);

			const toolUseBlocks = response.content.filter(
				(b): b is ToolUseBlock => b.type === "tool_use",
			);

			if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
				const textParts = response.content
					.filter((b) => b.type === "text")
					.map((b) => (b as { type: "text"; text: string }).text);
				return {
					text: textParts.join("\n"),
					images: collectedImages.length > 0 ? collectedImages : undefined,
					usage: response.usage
						? {
								inputTokens: response.usage.input_tokens,
								outputTokens: response.usage.output_tokens,
								cacheCreationInputTokens:
									response.usage.cache_creation_input_tokens ?? undefined,
								cacheReadInputTokens:
									response.usage.cache_read_input_tokens ?? undefined,
							}
						: undefined,
				};
			}

			conversation.push({
				role: "assistant",
				content: response.content as ContentBlockParam[],
			});

			// Phase 1: Handle activate_skill calls first
			const toolResults: ToolResultBlockParam[] = [];
			const regularCalls: ToolCallRequest[] = [];

			for (const block of toolUseBlocks) {
				if (block.name === "activate_skill" && this.skillManager && sessionId) {
					const skillName = (block.input as Record<string, unknown>)
						.skill as string;
					const entry = this.skillManager.activateSkill(sessionId, skillName);
					if (entry) {
						// New tools become available next roundtrip — recompute then.
						toolsDirty = true;
						this.logger.info("Skill activated", {
							skill: skillName,
							tools: entry.toolNames,
						});
						toolResults.push({
							type: "tool_result",
							tool_use_id: block.id,
							content: `Skill "${skillName}" activated. You now have access to: ${entry.toolNames.join(", ")}`,
						});
						continue;
					}
				}

				const toolInput = { ...(block.input as Record<string, unknown>) };
				if (needsSessionId(block.name) && sessionId) {
					toolInput.__sessionId = sessionId;
				}
				regularCalls.push({ id: block.id, name: block.name, input: toolInput });
			}

			// Phase 2: Execute remaining tools in parallel
			if (regularCalls.length > 0) {
				const results = await executeToolsParallel(
					regularCalls, this.toolRegistry, this.logger, undefined, sessionId,
				);
				for (const r of results) {
					if (r.images && r.images.length > 0) {
						collectedImages.push(...r.images);
						const contentParts: Array<
							| { type: "text"; text: string }
							| {
									type: "image";
									source: { type: "base64"; media_type: string; data: string };
							  }
						> = [];
						if (r.content) {
							contentParts.push({ type: "text", text: r.content });
						}
						for (const img of r.images) {
							contentParts.push({
								type: "image",
								source: {
									type: "base64",
									media_type: img.media_type,
									data: img.base64,
								},
							});
						}
						toolResults.push({
							type: "tool_result",
							tool_use_id: r.id,
							content: contentParts as any,
							is_error: r.is_error,
						});
					} else {
						toolResults.push({
							type: "tool_result",
							tool_use_id: r.id,
							content: r.content,
							is_error: r.is_error,
						});
					}
				}
			}

			conversation.push({ role: "user", content: toolResults });
			roundtrips++;
		}

		return {
			text: "I've reached the maximum number of tool-use steps. Here's what I've done so far - please let me know if you'd like me to continue.",
			images: collectedImages.length > 0 ? collectedImages : undefined,
		};
	}

	private buildConversation(messages: ChatMessage[]): MessageParam[] {
		return messages.map((m) => {
			if (m.role === "user" && m.attachments && m.attachments.length > 0) {
				const contentParts: ContentBlockParam[] = [];
				for (const att of m.attachments) {
					if (att.type === "image" && att.data && att.mimeType) {
						contentParts.push({
							type: "image",
							source: {
								type: "base64",
								media_type: att.mimeType as
									| "image/png"
									| "image/jpeg"
									| "image/gif"
									| "image/webp",
								data: att.data.toString("base64"),
							},
						} as ContentBlockParam);
					} else if (att.type === "text" && att.data) {
						const header = att.name ? `[File: ${att.name}]\n` : "";
						contentParts.push({
							type: "text",
							text: header + att.data.toString("utf-8"),
						} as ContentBlockParam);
					}
				}
				contentParts.push({
					type: "text",
					text: m.content,
				} as ContentBlockParam);
				return { role: m.role, content: contentParts };
			}
			return { role: m.role, content: m.content };
		});
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
		const conversation: MessageParam[] = this.buildConversation(messages);

		// Hoisted out of the loop (see chat()): stable across roundtrips, recomputed
		// only when an activate_skill in this turn flips `toolsDirty`.
		let tools = this.getTools(sessionId);
		let toolsDirty = false;

		while (roundtrips < this.maxToolRoundtrips) {
			yield { type: "roundtrip_start", roundtrip: roundtrips };

			if (toolsDirty) {
				tools = this.getTools(sessionId);
				toolsDirty = false;
			}
			this.logger.debug("Streaming request to Claude", {
				roundtrip: roundtrips,
				messageCount: conversation.length,
				toolCount: tools.length,
			});

			const stream = this.client.messages.stream(
				buildClaudeRequest({
					model: this.model,
					maxTokens: this.maxTokens,
					systemPrompt: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
					tools: tools as Tool[],
					conversation,
					promptCache: this.promptCache,
				}),
			);
			// H-NEW-5: Anthropic SDK's MessageStream exposes its own
			// AbortController. Wire the caller's cancel signal so a
			// "Stop" click tears down the in-flight HTTP request.
			// NB: `signal` is an AbortSignal (no `.abort()` of its own —
			// that lives on AbortController), so we only listen for its
			// abort and forward it to the stream's controller.
			if (signal) {
				if (signal.aborted) {
					stream.controller.abort();
				} else {
					signal.addEventListener(
						"abort",
						() => stream.controller.abort(),
						{ once: true },
					);
				}
			}

			for await (const event of stream) {
				if (event.type === "content_block_delta") {
					if (event.delta.type === "text_delta") {
						yield { type: "text_delta", text: event.delta.text };
					} else if (
						(event.delta as any).type === "thinking_delta" &&
						(event.delta as any).thinking
					) {
						yield {
							type: "thinking_delta",
							thinkingText: (event.delta as any).thinking,
						};
					}
				}
			}

			const response = await stream.finalMessage();

			// Emit usage data after each roundtrip
			if (response.usage) {
				yield {
					type: "usage",
					usage: {
						inputTokens: response.usage.input_tokens,
						outputTokens: response.usage.output_tokens,
						cacheCreationInputTokens:
							response.usage.cache_creation_input_tokens ?? undefined,
						cacheReadInputTokens:
							response.usage.cache_read_input_tokens ?? undefined,
						provider: "claude",
						model: this.model,
					},
				};
			}
			const toolUseBlocks = response.content.filter(
				(b): b is ToolUseBlock => b.type === "tool_use",
			);

			if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
				return;
			}

			conversation.push({
				role: "assistant",
				content: response.content as ContentBlockParam[],
			});

			yield { type: "thinking" };

			// Phase 1: Handle activate_skill calls first
			const toolResults: ToolResultBlockParam[] = [];
			const streamRegularCalls: ToolCallRequest[] = [];

			for (const block of toolUseBlocks) {
				const toolInput = { ...(block.input as Record<string, unknown>) };
				if (needsSessionId(block.name) && sessionId) {
					toolInput.__sessionId = sessionId;
				}

				if (block.name === "activate_skill" && this.skillManager && sessionId) {
					const skillName = toolInput.skill as string;
					const entry = this.skillManager.activateSkill(sessionId, skillName);
					if (entry) {
						// New tools become available next roundtrip — recompute then.
						toolsDirty = true;
						this.logger.info("Skill activated (stream)", {
							skill: skillName,
							tools: entry.toolNames,
						});
						toolResults.push({
							type: "tool_result",
							tool_use_id: block.id,
							content: `Skill "${skillName}" activated. You now have access to: ${entry.toolNames.join(", ")}`,
						});
						const summary = summarizeToolInput(block.name, toolInput);
						yield {
							type: "tool_start",
							toolName: block.name,
							toolId: block.id,
							toolInput,
							toolSummary: summary,
							roundtrip: roundtrips,
						};
						yield {
							type: "tool_end",
							toolName: block.name,
							toolId: block.id,
							toolResult: `Activated: ${entry.toolNames.join(", ")}`,
							toolIsError: false,
							durationMs: 0,
						};
						continue;
					}
				}

				streamRegularCalls.push({ id: block.id, name: block.name, input: toolInput });
			}

			// Phase 2: Execute remaining tools in parallel with streaming
			if (streamRegularCalls.length > 0) {
				const gen = executeToolsParallelStreaming(
					streamRegularCalls, this.toolRegistry, this.logger, roundtrips, undefined, sessionId,
				);
				let next = await gen.next();
				while (!next.done) {
					yield next.value;
					next = await gen.next();
				}
				for (const r of next.value) {
					if (r.images && r.images.length > 0) {
						collectedImages.push(...r.images);
						const contentParts: Array<
							| { type: "text"; text: string }
							| {
									type: "image";
									source: { type: "base64"; media_type: string; data: string };
							  }
						> = [];
						if (r.content) {
							contentParts.push({ type: "text", text: r.content });
						}
						for (const img of r.images) {
							contentParts.push({
								type: "image",
								source: {
									type: "base64",
									media_type: img.media_type,
									data: img.base64,
								},
							});
						}
						toolResults.push({
							type: "tool_result",
							tool_use_id: r.id,
							content: contentParts as any,
							is_error: r.is_error,
						});
					} else {
						toolResults.push({
							type: "tool_result",
							tool_use_id: r.id,
							content: r.content,
							is_error: r.is_error,
						});
					}
				}
			}

			conversation.push({ role: "user", content: toolResults });
			roundtrips++;

			yield { type: "thinking" };
		}

		yield {
			type: "text_delta",
			text: "I've reached the maximum number of tool-use steps. Here's what I've done so far - please let me know if you'd like me to continue.",
		};
	}
}
