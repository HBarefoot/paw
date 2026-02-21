import type { AIProvider, ChatMessage } from "../ai/base-provider.js";

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
		const lines = response
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && l.toUpperCase() !== "NONE");

		// Clean up lines - remove leading bullets/dashes/numbers
		return lines
			.map((l) => l.replace(/^[\-\*\d.)\]]+\s*/, "").trim())
			.filter((l) => l.length > 5); // Skip very short fragments
	} catch {
		return [];
	}
}
