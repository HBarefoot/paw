import type { StreamChunk } from "../ai/base-provider.js";
import type { ToolDefinition, ToolResult } from "../types/message.js";
import type { AgentRegistry } from "./registry.js";
import type { AgentRunResult } from "./types.js";

export interface DelegateToolDeps {
	agentRegistry: AgentRegistry;
	runAgentTurn: (
		agentName: string,
		task: string,
		parentSessionId: string,
	) => Promise<AgentRunResult>;
	runAgentTurnStream?: (
		agentName: string,
		task: string,
		parentSessionId: string,
	) => AsyncGenerator<StreamChunk, AgentRunResult>;
}

function validateInput(
	input: Record<string, unknown>,
	agentRegistry: AgentRegistry,
): ToolResult | null {
	const agentName = input.agent as string;
	const task = input.task as string;

	if (!agentRegistry.has(agentName)) {
		return {
			content: `Unknown agent: "${agentName}". Available agents: ${agentRegistry.agentNames.join(", ")}`,
			is_error: true,
		};
	}

	if (!task || task.trim().length === 0) {
		return {
			content: "Task description cannot be empty.",
			is_error: true,
		};
	}

	return null;
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
 * Creates the delegate_task tool. Providers inject `__sessionId` into
 * the tool input before execution (same pattern as activate_skill).
 *
 * Includes a `streamHandler` that providers use in streaming mode to
 * forward sub-agent chunks to the parent activity timeline.
 */
export function createDelegateTool(deps: DelegateToolDeps): ToolDefinition {
	const { agentRegistry, runAgentTurn, runAgentTurnStream } = deps;

	return {
		name: "delegate_task",
		description: buildDescription(agentRegistry),
		input_schema: {
			type: "object",
			properties: {
				agent: {
					type: "string",
					description: "Name of the agent to delegate to.",
					enum: agentRegistry.agentNames,
				},
				task: {
					type: "string",
					description:
						"Clear description of the task for the agent. Include all relevant context — the agent starts with no conversation history.",
				},
			},
			required: ["agent", "task"],
		},
		plugin: "kernel",

		// Non-streaming handler (used by Slack, cron, non-stream web calls)
		handler: async (input: Record<string, unknown>): Promise<ToolResult> => {
			const error = validateInput(input, agentRegistry);
			if (error) return error;

			const agentName = input.agent as string;
			const task = input.task as string;
			const parentSessionId = (input.__sessionId as string) || "unknown";

			const result = await runAgentTurn(agentName, task, parentSessionId);
			return formatResult(agentName, result);
		},

		// Streaming handler (used by Claude/Ollama chatStream)
		// Yields sub-agent StreamChunks, returns ToolResult
		streamHandler: runAgentTurnStream
			? async function* (
					input: Record<string, unknown>,
				): AsyncGenerator<StreamChunk, ToolResult> {
					const error = validateInput(input, agentRegistry);
					if (error) return error;

					const agentName = input.agent as string;
					const task = input.task as string;
					const parentSessionId = (input.__sessionId as string) || "unknown";

					const gen = runAgentTurnStream(agentName, task, parentSessionId);
					let next = await gen.next();
					while (!next.done) {
						yield next.value;
						next = await gen.next();
					}

					// next.value is the AgentRunResult (generator return value)
					return formatResult(agentName, next.value);
				}
			: undefined,
	};
}

function buildDescription(registry: AgentRegistry): string {
	const agents = registry.list();
	if (agents.length === 0) {
		return "Delegate a task to a specialized agent. No agents are currently registered.";
	}

	const catalog = agents
		.map((a) => `- **${a.name}**: ${a.description}`)
		.join("\n");

	return `Delegate a task to a specialized agent that runs autonomously with its own tools and context. Available agents:\n${catalog}\n\nThe agent runs in its own session and returns the result. Provide a clear, self-contained task description.`;
}
