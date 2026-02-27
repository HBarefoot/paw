export interface AgentDefinition {
	/** Unique identifier for this agent (e.g. "icp-discovery", "researcher"). */
	name: string;
	/** Short description shown in the spawn_agent tool presets. */
	description: string;
	/** System prompt for this agent — replaces the default agent personality. */
	systemPrompt: string;
	/** Skills to auto-activate when this agent runs. */
	skills: string[];
	/** Optional provider override (uses kernel default if omitted). */
	provider?: "claude" | "ollama" | "openai" | "gemini";
	/** Max tool roundtrips for this agent (defaults to kernel config). */
	maxRoundtrips?: number;
	/** Memory scope for this agent. Defaults to "global". */
	memoryScope?: string;
}

export interface AgentRunResult {
	/** The agent's final text response. */
	text: string;
	/** The sub-session ID created for this run. */
	sessionId: string;
	/** Number of tool roundtrips used. */
	roundtrips?: number;
	/** Whether the run completed successfully. */
	ok: boolean;
	/** Error message if ok is false. */
	error?: string;
}
