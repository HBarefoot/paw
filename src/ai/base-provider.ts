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
}

export interface StreamChunk {
	type:
		| "text_delta"
		| "tool_start"
		| "tool_end"
		| "error"
		| "done"
		| "thinking"
		| "roundtrip_start";
	text?: string;
	toolName?: string;
	toolId?: string;
	toolInput?: Record<string, unknown>;
	toolSummary?: string;
	toolResult?: string;
	toolIsError?: boolean;
	durationMs?: number;
	roundtrip?: number;
	error?: string;
}

export interface AIProvider {
	readonly name: string;
	readonly toolRegistry: ToolRegistry;
	chat(
		messages: ChatMessage[],
		systemPrompt?: string,
		sessionId?: string,
	): Promise<ChatResponse>;
	chatStream?(
		messages: ChatMessage[],
		systemPrompt?: string,
		sessionId?: string,
	): AsyncGenerator<StreamChunk>;
}
