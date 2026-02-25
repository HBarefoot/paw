import Anthropic from "@anthropic-ai/sdk";
import type {
	MessageParam,
	ContentBlockParam,
	ToolUseBlock,
	ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { ToolRegistry } from "./tools.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import { withRetry } from "./retry.js";
import type {
	AIProvider,
	ChatMessage,
	ChatResponse,
	StreamChunk,
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
}

export class ClaudeProvider implements AIProvider {
	readonly name = "claude";
	private client: Anthropic;
	private model: string;
	private maxTokens: number;
	private maxToolRoundtrips: number;
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
		return this.toolRegistry.toAnthropicToolsFiltered(allowed);
	}

	async chat(
		messages: ChatMessage[],
		systemPrompt?: string,
		sessionId?: string,
	): Promise<ChatResponse> {
		let roundtrips = 0;
		const collectedImages: ToolResultImage[] = [];
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

		while (roundtrips < this.maxToolRoundtrips) {
			const tools = this.getTools(sessionId);
			this.logger.debug("Sending request to Claude", {
				roundtrip: roundtrips,
				messageCount: conversation.length,
				toolCount: tools.length,
			});

			const response = await withRetry(
				() =>
					this.client.messages
						.stream({
							model: this.model,
							max_tokens: this.maxTokens,
							system: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
							messages: conversation,
							...(tools.length > 0
								? { tools: tools as Anthropic.Messages.Tool[] }
								: {}),
						})
						.finalMessage(),
				this.logger,
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
				};
			}

			conversation.push({
				role: "assistant",
				content: response.content as ContentBlockParam[],
			});

			const toolResults: ToolResultBlockParam[] = [];
			for (const block of toolUseBlocks) {
				if (block.name === "activate_skill" && this.skillManager && sessionId) {
					const skillName = (block.input as Record<string, unknown>)
						.skill as string;
					const entry = this.skillManager.activateSkill(sessionId, skillName);
					if (entry) {
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

				this.logger.info("Executing tool", { tool: block.name, id: block.id });
				const TOOL_TIMEOUT_MS = 600_000;
				let result: ToolResult;
				try {
					result = await Promise.race([
						this.toolRegistry.execute(block.name, block.input as Record<string, unknown>),
						new Promise<never>((_, reject) =>
							setTimeout(
								() => reject(new Error(`Tool "${block.name}" timed out after 10 minutes`)),
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

				if (result.images && result.images.length > 0) {
					collectedImages.push(...result.images);
					// Build a multi-part content array with text + image blocks
					const contentParts: Array<
						| { type: "text"; text: string }
						| {
								type: "image";
								source: { type: "base64"; media_type: string; data: string };
						  }
					> = [];
					if (result.content) {
						contentParts.push({ type: "text", text: result.content });
					}
					for (const img of result.images) {
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
						tool_use_id: block.id,
						content: contentParts as any,
						is_error: result.is_error,
					});
				} else {
					toolResults.push({
						type: "tool_result",
						tool_use_id: block.id,
						content: result.content ?? "",
						is_error: result.is_error,
					});
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
		systemPrompt?: string,
		sessionId?: string,
	): AsyncGenerator<StreamChunk> {
		let roundtrips = 0;
		const conversation: MessageParam[] = this.buildConversation(messages);

		while (roundtrips < this.maxToolRoundtrips) {
			yield { type: "roundtrip_start", roundtrip: roundtrips };

			const tools = this.getTools(sessionId);
			this.logger.debug("Streaming request to Claude", {
				roundtrip: roundtrips,
				messageCount: conversation.length,
				toolCount: tools.length,
			});

			const stream = this.client.messages.stream({
				model: this.model,
				max_tokens: this.maxTokens,
				system: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
				messages: conversation,
				...(tools.length > 0
					? { tools: tools as Anthropic.Messages.Tool[] }
					: {}),
			});

			for await (const event of stream) {
				if (
					event.type === "content_block_delta" &&
					event.delta.type === "text_delta"
				) {
					yield { type: "text_delta", text: event.delta.text };
				}
			}

			const response = await stream.finalMessage();
			const toolUseBlocks = response.content.filter(
				(b): b is ToolUseBlock => b.type === "tool_use",
			);

			if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
				yield { type: "done" };
				return;
			}

			conversation.push({
				role: "assistant",
				content: response.content as ContentBlockParam[],
			});

			yield { type: "thinking" };

			const toolResults: ToolResultBlockParam[] = [];
			for (const block of toolUseBlocks) {
				const toolInput = block.input as Record<string, unknown>;

				if (block.name === "activate_skill" && this.skillManager && sessionId) {
					const skillName = toolInput.skill as string;
					const entry = this.skillManager.activateSkill(sessionId, skillName);
					if (entry) {
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

				const summary = summarizeToolInput(block.name, toolInput);
				yield {
					type: "tool_start",
					toolName: block.name,
					toolId: block.id,
					toolInput,
					toolSummary: summary,
					roundtrip: roundtrips,
				};

				this.logger.info("Executing tool (stream)", {
					tool: block.name,
					id: block.id,
				});

				const TOOL_TIMEOUT_MS = 600_000; // 5 minutes
				const startTime = Date.now();
				let result: ToolResult;
				try {
					result = await Promise.race([
						this.toolRegistry.execute(block.name, toolInput),
						new Promise<never>((_, reject) =>
							setTimeout(
								() => reject(new Error(`Tool "${block.name}" timed out after 10 minutes`)),
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
					toolName: block.name,
					toolId: block.id,
					toolResult: (result.content ?? "").slice(0, 500),
					toolIsError: result.is_error,
					durationMs,
				};

				if (result.images && result.images.length > 0) {
					const contentParts: Array<
						| { type: "text"; text: string }
						| {
								type: "image";
								source: { type: "base64"; media_type: string; data: string };
						  }
					> = [];
					if (result.content) {
						contentParts.push({ type: "text", text: result.content });
					}
					for (const img of result.images) {
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
						tool_use_id: block.id,
						content: contentParts as any,
						is_error: result.is_error,
					});
				} else {
					toolResults.push({
						type: "tool_result",
						tool_use_id: block.id,
						content: result.content ?? "",
						is_error: result.is_error,
					});
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
		yield { type: "done" };
	}
}
