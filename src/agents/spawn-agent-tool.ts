import type { StreamChunk } from "../ai/base-provider.js";
import type { SkillManager } from "../ai/skills.js";
import type { ToolDefinition, ToolResult } from "../types/message.js";
import type { AgentRegistry } from "./registry.js";
import type { AgentDefinition, AgentRunResult } from "./types.js";

export interface SpawnAgentToolDeps {
	agentRegistry: AgentRegistry;
	skillManager: SkillManager;
	agentDepths: Map<string, number>;
	maxAgentDepth: number;
	runAgentTurn: (
		agent: AgentDefinition,
		task: string,
		parentSessionId: string,
	) => Promise<AgentRunResult>;
	runAgentTurnStream?: (
		agent: AgentDefinition,
		task: string,
		parentSessionId: string,
	) => AsyncGenerator<StreamChunk, AgentRunResult>;
}

function validateInput(
	input: Record<string, unknown>,
): { agent: AgentDefinition; task: string } | ToolResult {
	const task = input.task as string;
	if (!task || task.trim().length === 0) {
		return { content: "Task description cannot be empty.", is_error: true };
	}

	const name = (input.name as string)?.trim();
	if (!name) {
		return { content: "Agent name is required.", is_error: true };
	}

	const systemPrompt = (input.system_prompt as string)?.trim() || "";
	const skills = Array.isArray(input.skills)
		? (input.skills as string[])
		: typeof input.skills === "string"
			? (input.skills as string)
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: [];

	const agent: AgentDefinition = {
		name,
		description: `Dynamic agent: ${name}`,
		systemPrompt,
		skills,
	};

	return { agent, task };
}

function formatResult(agentName: string, result: AgentRunResult): ToolResult {
	if (!result.ok) {
		return {
			content: `Agent "${agentName}" failed: ${result.error ?? "unknown error"}\n\nSession: ${result.sessionId}`,
			is_error: true,
		};
	}

	return {
		content: [
			`**Agent "${agentName}" completed** (session: ${result.sessionId})`,
			"",
			result.text,
		].join("\n"),
	};
}

/**
 * Creates the spawn_agent tool for dynamic agent spawning.
 * The main AI defines the agent inline — no pre-registration required.
 * Config-based agent presets appear in the description as suggestions.
 */
export function createSpawnAgentTool(deps: SpawnAgentToolDeps): ToolDefinition {
	const {
		agentRegistry,
		skillManager,
		agentDepths,
		maxAgentDepth,
		runAgentTurn,
		runAgentTurnStream,
	} = deps;

	return {
		name: "spawn_agent",
		description: buildDescription(agentRegistry, skillManager),
		input_schema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description:
						'Short identifier for this agent (e.g. "icp-researcher", "data-analyst"). Used in logs and session tracking.',
				},
				task: {
					type: "string",
					description:
						"Clear, self-contained task description. Include all relevant context — the agent starts with no conversation history.",
				},
				system_prompt: {
					type: "string",
					description:
						"System prompt for the agent. Defines its role, behavior, and approach. If omitted, uses a generic assistant prompt.",
				},
				skills: {
					type: "array",
					items: { type: "string" },
					description:
						'Skills to activate for this agent (e.g. ["icp-discovery", "memory"]). Each skill gives the agent access to a group of tools.',
				},
			},
			required: ["name", "task"],
		},
		plugin: "kernel",

		handler: async (input: Record<string, unknown>): Promise<ToolResult> => {
			const parsed = validateInput(input);
			if ("is_error" in parsed) return parsed;

			const parentSessionId = (input.__sessionId as string) || "unknown";
			const parentDepth = agentDepths.get(parentSessionId) ?? 0;
			if (parentDepth >= maxAgentDepth) {
				return {
					content:
						"Maximum agent nesting depth reached. Execute your task directly using available tools.",
					is_error: true,
				};
			}

			const { agent, task } = parsed;
			const result = await runAgentTurn(agent, task, parentSessionId);
			return formatResult(agent.name, result);
		},

		streamHandler: runAgentTurnStream
			? async function* (
					input: Record<string, unknown>,
				): AsyncGenerator<StreamChunk, ToolResult> {
					const parsed = validateInput(input);
					if ("is_error" in parsed) return parsed;

					const parentSessionId = (input.__sessionId as string) || "unknown";
					const parentDepth = agentDepths.get(parentSessionId) ?? 0;
					if (parentDepth >= maxAgentDepth) {
						return {
							content:
								"Maximum agent nesting depth reached. Execute your task directly using available tools.",
							is_error: true,
						};
					}

					const { agent, task } = parsed;

					const gen = runAgentTurnStream(agent, task, parentSessionId);
					let next = await gen.next();
					while (!next.done) {
						yield next.value;
						next = await gen.next();
					}

					return formatResult(agent.name, next.value);
				}
			: undefined,
	};
}

function buildDescription(
	registry: AgentRegistry,
	skillManager: SkillManager,
): string {
	const parts = [
		"Spawn a specialized agent that runs autonomously with its own tools and context.",
		"Define the agent's name, task, system prompt, and which skills to activate.",
		"The agent runs in its own session and returns the result when done.",
	];

	const presets = registry.list();
	if (presets.length > 0) {
		const catalog = presets
			.map(
				(a) =>
					`- **${a.name}**: ${a.description} (skills: ${a.skills.join(", ")})`,
			)
			.join("\n");
		parts.push(`\nPre-configured agent presets:\n${catalog}`);
	}

	const skills = skillManager.skillNames;
	if (skills.length > 0) {
		parts.push(`\nAvailable skills: ${skills.join(", ")}`);
	}

	return parts.join("\n");
}
