import type { Attachment, ToolResultImage } from "../types/message.js";
import type { ToolRegistry } from "./tools.js";

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	attachments?: Attachment[];
}

export interface ChatResponse {
	text: string;
	images?: ToolResultImage[];
	usage?: {
		inputTokens: number;
		outputTokens: number;
	};
}

export interface StreamChunk {
	type:
		| "text_delta"
		| "tool_start"
		| "tool_end"
		| "error"
		| "done"
		| "thinking"
		| "thinking_delta"
		| "roundtrip_start"
		| "usage";
	text?: string;
	thinkingText?: string;
	toolName?: string;
	toolId?: string;
	toolInput?: Record<string, unknown>;
	toolSummary?: string;
	toolResult?: string;
	toolIsError?: boolean;
	/** Skill/group key the tool belongs to (e.g. "web-pilot", "mcp:n8n"), set
	 * server-side so the canvas portrait can light up the matching pill. */
	skillKey?: string;
	durationMs?: number;
	roundtrip?: number;
	error?: string;
	messageId?: string;
	usage?: {
		inputTokens: number;
		outputTokens: number;
		estimatedCostUsd?: number;
		provider?: string;
		model?: string;
	};
}

export interface AIProvider {
	readonly name: string;
	readonly toolRegistry: ToolRegistry;
	chat(
		messages: ChatMessage[],
		systemPrompt?: string,
		sessionId?: string,
		opts?: { signal?: AbortSignal },
	): Promise<ChatResponse>;
	chatStream?(
		messages: ChatMessage[],
		systemPrompt?: string,
		sessionId?: string,
		opts?: { signal?: AbortSignal },
	): AsyncGenerator<StreamChunk>;
}
