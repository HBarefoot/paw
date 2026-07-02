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
	/**
	 * Why the provider's tool-use loop stopped. `"end_turn"` (the default when
	 * absent) means the model finished naturally; `"max_roundtrips"` means the
	 * per-turn roundtrip budget was exhausted mid-task. The kernel owns what
	 * happens next — it does NOT belong in a user-facing string here.
	 */
	stopReason?: "end_turn" | "max_roundtrips";
	/** Roundtrips consumed this turn (set alongside a `max_roundtrips` stop). */
	roundtripsUsed?: number;
	/**
	 * Compact self-summary (DONE / LEFT / KEY ARTIFACTS & IDS) produced by the
	 * model when the loop hit `max_roundtrips`, so a continuation leg can resume
	 * without re-deriving state. Undefined if the checkpoint call failed/aborted.
	 */
	checkpoint?: string;
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
		| "usage"
		/** Provider→kernel only: signals a `max_roundtrips` stop mid-stream and
		 * carries the checkpoint. The kernel consumes it to drive continuation and
		 * never forwards it to the browser (so no chat.tsx/SSE changes needed). */
		| "checkpoint";
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
	/** Set on a `"checkpoint"` chunk (see the type union above). */
	stopReason?: "end_turn" | "max_roundtrips";
	roundtripsUsed?: number;
	checkpoint?: string;
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

// ---------------------------------------------------------------------------
// Roundtrip checkpoint / continuation (shared across all providers + the kernel)
//
// When a provider's tool-use loop exhausts its roundtrip budget it does NOT emit
// a canned "I've reached the maximum…" string. Instead it asks the model for one
// compact checkpoint and reports a structured `max_roundtrips` stop; the kernel
// decides whether to continue. Centralizing the wording here keeps the six loop
// sites and the kernel from drifting.
// ---------------------------------------------------------------------------

/** Prompt appended (as a final user turn, tools disabled) to elicit the checkpoint. */
export const CHECKPOINT_PROMPT =
	"You've reached the step limit for this turn. Do NOT call any more tools. " +
	"In at most 6 short lines, write a compact checkpoint so a fresh continuation " +
	"can resume without re-deriving state:\n" +
	"DONE: what you have completed\n" +
	"LEFT: what still needs doing\n" +
	"KEY ARTIFACTS/IDS: files, PR/ticket numbers, record or session ids the continuation needs\n" +
	"No preamble, no apology.";

/** Shape the structured `max_roundtrips` response returned by a provider's `chat()`. */
export function maxRoundtripsResponse(
	partialText: string,
	roundtripsUsed: number,
	checkpoint: string | undefined,
	images: ToolResultImage[] | undefined,
): ChatResponse {
	return {
		text: partialText,
		images: images && images.length > 0 ? images : undefined,
		stopReason: "max_roundtrips",
		roundtripsUsed,
		checkpoint,
	};
}

/** First non-empty line of a checkpoint, trimmed for a one-line progress note. */
function checkpointHeadline(checkpoint?: string): string {
	const first = (checkpoint ?? "")
		.split("\n")
		.map((s) => s.trim())
		.find(Boolean);
	if (!first) return "continuing work";
	return first.length > 140 ? `${first.slice(0, 139)}…` : first;
}

/** The lightweight "▸ Checkpoint … continuing" line surfaced to the UI between legs. */
export function checkpointProgressLine(checkpoint?: string): string {
	return `▸ Checkpoint: ${checkpointHeadline(checkpoint)} — continuing…`;
}

/** The user turn that carries a checkpoint into the continuation leg. */
export function continuationNote(checkpoint?: string): string {
	const cp = checkpoint?.trim();
	return cp
		? `You hit the step limit and paused. Here is your own checkpoint of progress so far:\n\n${cp}\n\n` +
				"Continue the task from here. Reuse the artifacts/IDs above instead of re-deriving them, and don't repeat completed work."
		: "You hit the step limit and paused. Continue the task from where you left off — don't repeat completed work.";
}

/** Final message when a run still can't finish after its continuation — names done/left. */
export function composeStopMessage(checkpoint?: string): string {
	const cp = checkpoint?.trim();
	return cp
		? `I've done as much as I can in one turn. Here's where things stand:\n\n${cp}\n\nSay "continue" and I'll pick up from here.`
		: "I've done as much as I can in one turn. Say \"continue\" and I'll pick up from where I left off.";
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
