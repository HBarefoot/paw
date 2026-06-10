import type { AIProvider, ChatMessage } from "../ai/base-provider.js";
import type { MemoryStore } from "./store.js";

/** H-NEW-9: per-line cap on extracted memory length. */
const MAX_MEMORY_LINE_LENGTH = 500;

const EXTRACT_PROMPT = `You are a memory extraction system. Analyze the conversation below and extract key facts, preferences, or decisions that should be remembered for future conversations.

Rules:
- Only extract genuinely important information (names, preferences, technical details, decisions made)
- Skip trivial or transient information (greetings, acknowledgments)
- Each memory should be a single, self-contained sentence
- Return one memory per line, or "NONE" if nothing worth remembering

Conversation:
`;

export async function extractMemories(
	provider: AIProvider,
	messages: ChatMessage[],
): Promise<string[]> {
	if (messages.length === 0) return [];

	const conversationText = messages
		.map((m) => `${m.role}: ${m.content}`)
		.join("\n");

	const extractMessages: ChatMessage[] = [
		{ role: "user", content: EXTRACT_PROMPT + conversationText },
	];

	try {
		const response = await provider.chat(
			extractMessages,
			"You are a concise memory extraction system. Return one memory per line, or NONE.",
		);
		const lines = response.text
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && l.toUpperCase() !== "NONE");

		// Clean up lines - remove leading bullets/dashes/numbers, cap
		// length, drop fragments. M-NEW-23: also reject "none of the
		// above" / "none of the above is worth" type variants that the
		// original `!== "NONE"` check missed.
		return lines
			.map((l) => l.replace(/^[\-\*\d.)\]]+\s*/, "").trim())
			.filter(
				(l) =>
					l.length > 5 &&
					!/\bnone\s+of\s+the\s+above\b/i.test(l) &&
					l.length <= MAX_MEMORY_LINE_LENGTH,
			);
	} catch {
		return [];
	}
}

/**
 * Store extracted memories with contradiction detection.
 * For each extracted memory, checks if it contradicts existing memories.
 * If a contradiction is found, creates a supersedes link and lowers
 * the old memory's confidence.
 */
export async function storeExtractedMemories(
	memoryStore: MemoryStore,
	memories: string[],
	opts?: { scope?: string; source?: string; ownerUserId?: string },
): Promise<string[]> {
	const scope = opts?.scope ?? "global";
	const source = opts?.source ?? "auto-extract";
	const ownerUserId = opts?.ownerUserId ?? null;
	const storedIds: string[] = [];

	for (const text of memories) {
		try {
			// Check for contradictions
			const candidates = await memoryStore.findContradictionCandidates(text, {
				scope,
				limit: 3,
			});

			// If a very high-similarity match exists (score > 0.8), it's likely
			// an update rather than a new fact — supersede the top match
			const topMatch = candidates[0];
			const supersedes =
				topMatch && topMatch.score > 0.8 ? topMatch.id : undefined;

			const id = await memoryStore.store(
				text,
				{ scope, category: "fact", source, ownerUserId },
				{ supersedes },
			);
			storedIds.push(id);
		} catch {
			// Non-critical — skip this memory
		}
	}

	return storedIds;
}
