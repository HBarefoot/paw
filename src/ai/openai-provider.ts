import { ToolRegistry } from "./tools.js";
import { needsSessionId } from "./tool-context.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import { withRetry } from "./retry.js";
import type {
	AIProvider,
	ChatMessage,
	ChatResponse,
	SystemPromptInput,
} from "./base-provider.js";
import { systemPromptToString } from "./base-provider.js";
import { executeToolsParallel, type ToolCallRequest } from "./parallel-tools.js";
import type { ToolResultImage } from "../types/message.js";
import type { SkillManager } from "./skills.js";
import type { Logger } from "../types/plugin.js";

export interface OpenAIProviderConfig {
	apiKey: string;
	model: string;
	maxTokens: number;
	maxToolRoundtrips: number;
	baseUrl?: string;
}

type OpenAIContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string } };

interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | OpenAIContentPart[] | null;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

interface OpenAIToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface OpenAITool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

interface OpenAIResponse {
	choices: Array<{
		message: {
			role: string;
			content: string | null;
			tool_calls?: OpenAIToolCall[];
		};
		finish_reason: string;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export class OpenAIProvider implements AIProvider {
	readonly name = "openai";
	private apiKey: string;
	private model: string;
	private maxTokens: number;
	private maxToolRoundtrips: number;
	private baseUrl: string;
	readonly toolRegistry: ToolRegistry;
	private skillManager: SkillManager | null;
	private logger: Logger;

	constructor(
		config: OpenAIProviderConfig,
		toolRegistry: ToolRegistry,
		logger: Logger,
		skillManager?: SkillManager,
	) {
		this.apiKey = config.apiKey;
		this.model = config.model;
		this.maxTokens = config.maxTokens;
		this.maxToolRoundtrips = config.maxToolRoundtrips;
		this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(
			/\/$/,
			"",
		);
		this.toolRegistry = toolRegistry;
		this.skillManager = skillManager ?? null;
		this.logger = logger;

		this.logger.info("OpenAI provider initialized", {
			model: this.model,
			baseUrl: this.baseUrl,
		});
	}

	private getTools(sessionId?: string): OpenAITool[] {
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

	async chat(
		messages: ChatMessage[],
		systemPrompt?: SystemPromptInput,
		sessionId?: string,
		opts?: { signal?: AbortSignal },
	): Promise<ChatResponse> {
		let roundtrips = 0;
		const collectedImages: ToolResultImage[] = [];
		const signal = opts?.signal;
		const systemText = systemPrompt
			? systemPromptToString(systemPrompt)
			: DEFAULT_SYSTEM_PROMPT;

		const conversation: OpenAIMessage[] = [
			{ role: "system", content: systemText },
			...messages.map((m) => {
				if (m.role === "user" && m.attachments && m.attachments.length > 0) {
					const parts: OpenAIContentPart[] = [];
					for (const att of m.attachments) {
						if (att.type === "image" && att.data && att.mimeType) {
							parts.push({
								type: "image_url",
								image_url: {
									url: `data:${att.mimeType};base64,${att.data.toString("base64")}`,
								},
							});
						} else if (att.type === "text" && att.data) {
							const header = att.name ? `[File: ${att.name}]\n` : "";
							parts.push({
								type: "text",
								text: header + att.data.toString("utf-8"),
							});
						}
					}
					parts.push({ type: "text", text: m.content });
					return { role: m.role as "user" | "assistant", content: parts };
				}
				return { role: m.role as "user" | "assistant", content: m.content };
			}),
		];

		while (roundtrips < this.maxToolRoundtrips) {
			const tools = this.getTools(sessionId);
			this.logger.debug("Sending request to OpenAI", {
				roundtrip: roundtrips,
				model: this.model,
				toolCount: tools.length,
			});

			const body: Record<string, unknown> = {
				model: this.model,
				messages: conversation,
				max_tokens: this.maxTokens,
			};

			if (tools.length > 0) {
				body.tools = tools;
			}

			const data = await withRetry(async () => {
				const res = await fetch(`${this.baseUrl}/chat/completions`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.apiKey}`,
					},
					body: JSON.stringify(body),
					// H-NEW-5: forward the caller's abort signal so
					// cancelSession() actually tears down the in-flight
					// HTTP request, not just the SSE read loop.
					signal,
				});

				if (!res.ok) {
					const text = await res.text();
					throw new Error(`OpenAI error (${res.status}): ${text}`);
				}

				return (await res.json()) as OpenAIResponse;
			}, this.logger);
			const choice = data.choices[0];
			if (!choice) throw new Error("OpenAI returned no choices");

			const toolCalls = choice.message.tool_calls;

			// No tool calls — return text response
			if (
				!toolCalls ||
				toolCalls.length === 0 ||
				choice.finish_reason === "stop"
			) {
				return {
					text: choice.message.content ?? "",
					images: collectedImages.length > 0 ? collectedImages : undefined,
					// M-NEW-12: surface OpenAI usage so the kernel can
					// record real cost instead of estimating.
					usage: data.usage
						? {
								inputTokens: data.usage.prompt_tokens,
								outputTokens: data.usage.completion_tokens,
							}
						: undefined,
				};
			}

			// Add assistant message with tool calls
			conversation.push({
				role: "assistant",
				content: choice.message.content,
				tool_calls: toolCalls,
			});

			// Phase 1: Handle activate_skill calls first
			const regularCalls: ToolCallRequest[] = [];
			for (const call of toolCalls) {
				let args: Record<string, unknown>;
				try {
					args = JSON.parse(call.function.arguments);
				} catch (err) {
					// H-NEW-7: surface the JSON parse error to the model
					// instead of silently coercing to `{}` and re-asking
					// forever. We feed the error back as a tool result so
					// the model sees the malformed call and can self-correct.
					const msg =
						err instanceof Error ? err.message : String(err);
					conversation.push({
						role: "tool",
						content: `Tool "${call.function.name}" arguments are not valid JSON: ${msg}. Fix the arguments and call again.`,
						tool_call_id: call.id,
					});
					continue;
				}

				if (
					call.function.name === "activate_skill" &&
					this.skillManager &&
					sessionId
				) {
					const skillName = args.skill as string;
					const entry = this.skillManager.activateSkill(sessionId, skillName);
					if (entry) {
						this.logger.info("Skill activated", {
							skill: skillName,
							tools: entry.toolNames,
						});
						conversation.push({
							role: "tool",
							content: `Skill "${skillName}" activated. You now have access to: ${entry.toolNames.join(", ")}`,
							tool_call_id: call.id,
						});
						continue;
					}
				}

				if (needsSessionId(call.function.name) && sessionId) {
					args.__sessionId = sessionId;
				}
				regularCalls.push({ id: call.id, name: call.function.name, input: args });
			}

			// Phase 2: Execute remaining tools in parallel
			if (regularCalls.length > 0) {
				const results = await executeToolsParallel(
					regularCalls, this.toolRegistry, this.logger, undefined, sessionId,
				);
				for (const r of results) {
					if (r.images) collectedImages.push(...r.images);
					// M-NEW-8: surface `is_error` to the model. OpenAI's
					// message format doesn't have a per-tool error flag,
					// so we prefix the content with a clear marker.
					const content = r.is_error
						? `[Tool error] ${r.content}\n(Fix and call again.)`
						: r.content;
					conversation.push({
						role: "tool",
						content,
						tool_call_id: r.id,
					});
				}
			}

			roundtrips++;
		}

		return {
			text: "I've reached the maximum number of tool-use steps. Here's what I've done so far - please let me know if you'd like me to continue.",
			images: collectedImages.length > 0 ? collectedImages : undefined,
		};
	}
}
