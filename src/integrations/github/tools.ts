import type { ToolDefinition, ToolResult } from "../../types/message.js";
import type { GitHubClient } from "./client.js";

/**
 * Phase 1 GitHub tools (read-only). Grouped under the on-demand `github` skill
 * via `plugin: "github"`. Write/build tools (branch, commit, PR) arrive in
 * Phase 2; gated actions (merge, delete) in Phase 3.
 */
export function createGitHubTools(client: GitHubClient): ToolDefinition[] {
	const listRepos: ToolDefinition = {
		name: "github_list_repos",
		description:
			"List the GitHub repositories this agent is allowed to work on (the App installation, narrowed to the configured allowlist). Returns full name, default branch, visibility, and URL.",
		plugin: "github",
		input_schema: { type: "object", properties: {} },
		handler: async (): Promise<ToolResult> => {
			try {
				const repos = await client.listRepos();
				if (repos.length === 0) {
					return {
						content:
							"No repositories available. Add an allowlisted repo on the GitHub settings page and make sure the App is installed on it.",
					};
				}
				return { content: JSON.stringify({ repos }) };
			} catch (err) {
				return {
					content: `GitHub error: ${err instanceof Error ? err.message : String(err)}`,
					is_error: true,
				};
			}
		},
	};

	const readFile: ToolDefinition = {
		name: "github_read_file",
		description:
			"Read a file's contents from an allowlisted GitHub repository. Use this to inspect code before proposing changes.",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: {
					type: "string",
					description: 'Repository as "owner/repo".',
				},
				path: {
					type: "string",
					description: "File path within the repo (e.g. src/index.ts).",
				},
				ref: {
					type: "string",
					description:
						"Optional branch, tag, or commit SHA. Defaults to the default branch.",
				},
			},
			required: ["repo", "path"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const file = await client.readFile(
					input.repo as string,
					input.path as string,
					input.ref as string | undefined,
				);
				return {
					content: JSON.stringify({
						path: file.path,
						sha: file.sha,
						size: file.size,
						content: file.content,
					}),
				};
			} catch (err) {
				return {
					content: `GitHub error: ${err instanceof Error ? err.message : String(err)}`,
					is_error: true,
				};
			}
		},
	};

	return [listRepos, readFile];
}
