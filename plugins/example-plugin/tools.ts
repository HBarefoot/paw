import type {
	ToolDefinition,
	ToolResult,
} from "../../src/types/message.js";

/**
 * Tools for the "example-plugin" plugin. Stubs return "not implemented" — fill in the
 * handlers, add tests under tests/, then restart paw to load.
 */
export function createTools(): ToolDefinition[] {
	return [
		{
			name: "fetch_data",
			description: "Fetches data from an external API",
			plugin: "example-plugin",
			input_schema: {
				"type": "object",
				"properties": {
					"endpoint": {
						"type": "string",
						"description": "API endpoint path"
					},
					"params": {
						"type": "object",
						"description": "Query parameters"
					}
				},
				"required": [
					"endpoint"
				]
			},
			// TODO: implement. Stubs return "not implemented" so the plugin is inert.
			handler: async (): Promise<ToolResult> => ({
				content: "fetch_data not implemented",
			}),
		},
		{
			name: "cache_result",
			description: "Stores a result in memory for later retrieval",
			plugin: "example-plugin",
			input_schema: {
				"type": "object",
				"properties": {
					"key": {
						"type": "string",
						"description": "Cache key"
					},
					"value": {
						"type": "string",
						"description": "Value to cache"
					}
				},
				"required": [
					"key",
					"value"
				]
			},
			// TODO: implement. Stubs return "not implemented" so the plugin is inert.
			handler: async (): Promise<ToolResult> => ({
				content: "cache_result not implemented",
			}),
		},
	];
}
