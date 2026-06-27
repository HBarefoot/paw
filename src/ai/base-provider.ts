import type { Attachment, ToolResultImage } from "../types/message.js";
import type { ToolRegistry } from "./tools.js";

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	attachments?: Attachment[];
}

/**
 * System prompt passed to a provider. Either a plain string, or a
 * stable/volatile split so the Claude provider can place the Anthropic
 * prompt-cache breakpoint after the STABLE prefix only — keeping the cached
 * bytes identical across turns while per-turn memory/feedback/brand still
 * reach the model (after the breakpoint, uncached). Non-Claude providers
 * simply concatenate the two halves.
 */
export type SystemPromptInput = string | { stable: string; volatile: string };

/** Normalize a {@link SystemPromptInput} to a single string (non-Claude path). */
export function systemPromptToString(sp: SystemPromptInput): string {
	return typeof sp === "string" ? sp : sp.stable + sp.volatile;
}

export interface ChatResponse {
	text: string;
	images?: ToolResultImage[];
	usage?: {
		inputTokens: number;
		outputTokens: number;
		/** Anthropic prompt-cache accounting (Claude only; undefined elsewhere). */
		cacheCreationInputTokens?: number;
		cacheReadInputTokens?: number;
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
	/** Acting sub-agent name (the stripped "[agentName] " prefix), set
	 * server-side so the companion can route a tether beam to that agent. */
	agentName?: string;
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
		/** Anthropic prompt-cache accounting (Claude only; undefined elsewhere). */
		cacheCreationInputTokens?: number;
		cacheReadInputTokens?: number;
	};
}

export interface AIProvider {
	readonly name: string;
	readonly toolRegistry: ToolRegistry;
	chat(
		messages: ChatMessage[],
		systemPrompt?: SystemPromptInput,
		sessionId?: string,
		opts?: { signal?: AbortSignal },
	): Promise<ChatResponse>;
	chatStream?(
		messages: ChatMessage[],
		systemPrompt?: SystemPromptInput,
		sessionId?: string,
		opts?: { signal?: AbortSignal },
	): AsyncGenerator<StreamChunk>;
}
