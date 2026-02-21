import type { ToolRegistry } from "./tools.js";
import type { Attachment, ToolResultImage } from "../types/message.js";

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	attachments?: Attachment[];
}

export interface ChatResponse {
	text: string;
	images?: ToolResultImage[];
}

export interface AIProvider {
	readonly name: string;
	readonly toolRegistry: ToolRegistry;
	chat(
		messages: ChatMessage[],
		systemPrompt?: string,
		sessionId?: string,
	): Promise<ChatResponse>;
}
