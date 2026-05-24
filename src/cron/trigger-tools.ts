import type { CronScheduler } from "./scheduler.js";
import type { ToolDefinition } from "../types/message.js";

export function createProactiveTriggerTools(
	scheduler: CronScheduler,
): ToolDefinition[] {
	return [
		{
			name: "create_proactive_trigger",
			description:
				"Create a proactive trigger — a scheduled job that evaluates a condition before acting. Unlike regular cron jobs, proactive triggers fetch data from a source (URL or file) and ask the AI whether action is needed. Use this for monitoring, alerting, and smart automation.",
			input_schema: {
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "A descriptive name for this trigger",
					},
					expression: {
						type: "string",
						description:
							"Cron expression for how often to check (e.g., '*/5 * * * *' for every 5 minutes, '0 9 * * *' for daily at 9am)",
					},
					timezone: {
						type: "string",
						description: "Timezone (default: UTC)",
					},
					condition: {
						type: "string",
						description:
							"The condition to evaluate. Describe what should trigger the action (e.g., 'The stock price dropped below $100', 'There are new error logs')",
					},
					data_source: {
						type: "string",
						description:
							"URL or file path to fetch data from before evaluating the condition. Data is passed to the AI for evaluation.",
					},
					action_prompt: {
						type: "string",
						description:
							"What the AI should do when the condition is met. This becomes a prompt action.",
					},
				},
				required: ["name", "expression", "condition", "action_prompt"],
			},
			plugin: "kernel",
			handler: async (input) => {
				const name = input.name as string;
				const expression = input.expression as string;
				const timezone = (input.timezone as string) || "UTC";
				const condition = input.condition as string;
				const dataSource = input.data_source as string | undefined;
				const actionPrompt = input.action_prompt as string;

				const id = scheduler.addJob({
					name,
					expression,
					timezone,
					action: { type: "prompt", prompt: actionPrompt },
					isProactive: true,
					actionCondition: condition,
					dataSource,
				});

				return {
					content: `Proactive trigger created (id: ${id}): "${name}" — checks ${expression} (${timezone}), evaluates: "${condition}"`,
				};
			},
		},
	];
}
