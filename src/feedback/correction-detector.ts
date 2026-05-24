import type { ChatMessage } from "../ai/base-provider.js";

/**
 * Correction patterns — phrases that indicate the user is correcting
 * the AI's previous response.
 */
const CORRECTION_PATTERNS = [
	/^no[,.]?\s/i,
	/^actually[,.]?\s/i,
	/^i meant\s/i,
	/^not that[,.]?\s/i,
	/^that'?s (?:not|wrong)/i,
	/^wrong[,.]?\s/i,
	/^instead[,.]?\s/i,
	/^correction[:.]\s/i,
	/^let me clarify/i,
	/^that'?s incorrect/i,
	/^i said\s/i,
	/^no no/i,
];

export interface CorrectionResult {
	detected: boolean;
	correctionText: string;
	originalAssistantMessageIndex: number;
}

/**
 * Detect if the latest user message is correcting the AI's previous response.
 * Looks at the last 2-3 messages for correction patterns.
 */
export function detectCorrection(
	messages: ChatMessage[],
): CorrectionResult | null {
	if (messages.length < 2) return null;

	const lastMsg = messages[messages.length - 1];
	if (lastMsg.role !== "user") return null;

	const userText = lastMsg.content.trim();

	// Check if the message matches a correction pattern
	const isCorrection = CORRECTION_PATTERNS.some((p) => p.test(userText));
	if (!isCorrection) return null;

	// Find the most recent assistant message index
	for (let i = messages.length - 2; i >= 0; i--) {
		if (messages[i].role === "assistant") {
			return {
				detected: true,
				correctionText: userText,
				originalAssistantMessageIndex: i,
			};
		}
	}

	return null;
}
