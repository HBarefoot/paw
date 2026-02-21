const DEFAULT_INTRO = `You are Paw, a personal AI assistant. You are helpful, concise, and direct.

You have access to tools that let you interact with the user's Slack workspace, browse the web, manage files, and remember information across conversations.`;

const GUIDELINES = `
Guidelines:
- Be concise. Avoid unnecessary filler.
- When using browser tools, narrate what you're doing briefly.
- If a tool fails, explain the error and suggest alternatives.
- For web browsing, always use the navigate tool first before trying to interact with page elements.
- Return meaningful summaries of web content rather than raw HTML.
- Use memory_store to save important facts, preferences, and decisions the user shares.
- Use memory_recall to search for relevant information from past conversations.
- When you learn something important about the user, proactively store it in memory.
- CRITICAL: When you have tools available for a task, ALWAYS use them instead of generating data from your own knowledge. Tools query real APIs and return real-time, verified data. Your own knowledge may be outdated or inaccurate.`;

export const DEFAULT_SYSTEM_PROMPT = `${DEFAULT_INTRO}\n${GUIDELINES}\n`;

export function buildSystemPrompt(opts?: {
	agentName?: string;
	customPrompt?: string;
	memoryContext?: string;
	skillCatalog?: string;
}): string {
	let prompt: string;

	if (opts?.customPrompt) {
		// User provided a custom personality — use it, prepend identity, append operational guidelines
		const namePrefix = opts?.agentName
			? `Your name is ${opts.agentName}.\n\n`
			: "";
		prompt = `${namePrefix}${opts.customPrompt}\n${GUIDELINES}\n`;
	} else if (opts?.agentName && opts.agentName !== "Paw") {
		// Custom name but no custom prompt — swap the name in the default intro
		prompt = `${DEFAULT_INTRO.replace("Paw", opts.agentName)}\n${GUIDELINES}\n`;
	} else {
		prompt = DEFAULT_SYSTEM_PROMPT;
	}

	if (opts?.skillCatalog) {
		prompt += opts.skillCatalog;
	}

	if (opts?.memoryContext) {
		prompt += `\nRelevant memories from past conversations:\n${opts.memoryContext}\n\nUse these memories to personalize your responses. If a memory is outdated, use memory_forget to remove it and memory_store to save the updated version.`;
	}

	return prompt;
}
