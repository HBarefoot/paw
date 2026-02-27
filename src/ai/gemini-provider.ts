import { ToolRegistry } from "./tools.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import { withRetry } from "./retry.js";
import type { AIProvider, ChatMessage, ChatResponse } from "./base-provider.js";
import { executeToolsParallel, type ToolCallRequest } from "./parallel-tools.js";
import type { ToolResultImage } from "../types/message.js";
import type { SkillManager } from "./skills.js";
import type { Logger } from "../types/plugin.js";

export interface GeminiProviderConfig {
	apiKey: string;
	model: string;
	maxTokens: number;
	maxToolRoundtrips: number;
}

interface GeminiContent {
	role: "user" | "model";
	parts: GeminiPart[];
}

type GeminiPart =
	| { text: string }
	| { inlineData: { mimeType: string; data: string } }
	| { functionCall: { name: string; args: Record<string, unknown> } }
	| { functionResponse: { name: string; response: { content: string } } };

interface GeminiTool {
	functionDeclarations: Array<{
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	}>;
}

interface GeminiResponse {
	candidates: Array<{
		content: { role: string; parts: GeminiPart[] };
		finishReason: string;
	}>;
}

export class GeminiProvider implements AIProvider {
	readonly name = "gemini";
	private apiKey: string;
	private model: string;
	private maxTokens: number;
	private maxToolRoundtrips: number;
	readonly toolRegistry: ToolRegistry;
	private skillManager: SkillManager | null;
	private logger: Logger;

	constructor(
		config: GeminiProviderConfig,
		toolRegistry: ToolRegistry,
		logger: Logger,
		skillManager?: SkillManager,
	) {
		this.apiKey = config.apiKey;
		this.model = config.model;
		this.maxTokens = config.maxTokens;
		this.maxToolRoundtrips = config.maxToolRoundtrips;
		this.toolRegistry = toolRegistry;
		this.skillManager = skillManager ?? null;
		this.logger = logger;

		this.logger.info("Gemini provider initialized", { model: this.model });
	}

	private getTools(sessionId?: string): GeminiTool[] {
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

		const declarations = raw.map((t) => ({
			name: t.name,
			description: t.description,
			parameters: t.input_schema,
		}));

		if (declarations.length === 0) return [];
		return [{ functionDeclarations: declarations }];
	}

	async chat(
		messages: ChatMessage[],
		systemPrompt?: string,
		sessionId?: string,
	): Promise<ChatResponse> {
		let roundtrips = 0;
		const collectedImages: ToolResultImage[] = [];

		const contents: GeminiContent[] = messages.map((m) => {
			const parts: GeminiPart[] = [];
			if (m.role === "user" && m.attachments && m.attachments.length > 0) {
				for (const att of m.attachments) {
					if (att.type === "image" && att.data && att.mimeType) {
						parts.push({
							inlineData: {
								mimeType: att.mimeType,
								data: att.data.toString("base64"),
							},
						});
					} else if (att.type === "text" && att.data) {
						const header = att.name ? `[File: ${att.name}]\n` : "";
						parts.push({ text: header + att.data.toString("utf-8") });
					}
				}
			}
			parts.push({ text: m.content });
			return {
				role: m.role === "assistant" ? ("model" as const) : ("user" as const),
				parts,
			};
		});

		while (roundtrips < this.maxToolRoundtrips) {
			const tools = this.getTools(sessionId);
			this.logger.debug("Sending request to Gemini", {
				roundtrip: roundtrips,
				model: this.model,
			});

			const body: Record<string, unknown> = {
				contents,
				generationConfig: {
					maxOutputTokens: this.maxTokens,
				},
			};

			if (systemPrompt ?? DEFAULT_SYSTEM_PROMPT) {
				body.systemInstruction = {
					parts: [{ text: systemPrompt ?? DEFAULT_SYSTEM_PROMPT }],
				};
			}

			if (tools.length > 0) {
				body.tools = tools;
			}

			const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

			const data = await withRetry(async () => {
				const res = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});

				if (!res.ok) {
					const text = await res.text();
					throw new Error(`Gemini error (${res.status}): ${text}`);
				}

				return (await res.json()) as GeminiResponse;
			}, this.logger);
			const candidate = data.candidates?.[0];
			if (!candidate) throw new Error("Gemini returned no candidates");

			const parts = candidate.content.parts;
			const functionCalls = parts.filter(
				(
					p,
				): p is {
					functionCall: { name: string; args: Record<string, unknown> };
				} => "functionCall" in p,
			);

			// No function calls — return text
			if (functionCalls.length === 0) {
				const textParts = parts
					.filter((p): p is { text: string } => "text" in p)
					.map((p) => p.text);
				return {
					text: textParts.join("\n"),
					images: collectedImages.length > 0 ? collectedImages : undefined,
				};
			}

			// Add model response to conversation
			contents.push({ role: "model", parts });

			// Phase 1: Handle activate_skill calls first
			const responseParts: GeminiPart[] = [];
			const regularCalls: ToolCallRequest[] = [];

			for (const call of functionCalls) {
				if (
					call.functionCall.name === "activate_skill" &&
					this.skillManager &&
					sessionId
				) {
					const skillName = call.functionCall.args.skill as string;
					const entry = this.skillManager.activateSkill(sessionId, skillName);
					if (entry) {
						this.logger.info("Skill activated", {
							skill: skillName,
							tools: entry.toolNames,
						});
						responseParts.push({
							functionResponse: {
								name: call.functionCall.name,
								response: {
									content: `Skill "${skillName}" activated. You now have access to: ${entry.toolNames.join(", ")}`,
								},
							},
						});
						continue;
					}
				}

				const toolArgs = { ...call.functionCall.args };
				if (call.functionCall.name === "spawn_agent" && sessionId) {
					toolArgs.__sessionId = sessionId;
				}
				regularCalls.push({ id: call.functionCall.name, name: call.functionCall.name, input: toolArgs });
			}

			// Phase 2: Execute remaining tools in parallel
			if (regularCalls.length > 0) {
				const results = await executeToolsParallel(
					regularCalls, this.toolRegistry, this.logger,
				);
				for (const r of results) {
					if (r.images) collectedImages.push(...r.images);
					responseParts.push({
						functionResponse: {
							name: r.name,
							response: { content: r.content },
						},
					});
				}
			}

			contents.push({ role: "user", parts: responseParts });
			roundtrips++;
		}

		return {
			text: "I've reached the maximum number of tool-use steps. Here's what I've done so far - please let me know if you'd like me to continue.",
			images: collectedImages.length > 0 ? collectedImages : undefined,
		};
	}
}
