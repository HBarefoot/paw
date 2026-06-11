import type { ToolDefinition, ToolResult } from "../../types/message.js";
import type { GitHubApprovals } from "./approvals.js";
import type { GitHubClient } from "./client.js";
import type { CommitFileInput } from "./types.js";

export interface GitHubToolDeps {
	/** Records a security-audit entry for write actions (action, details). */
	audit?: (action: string, details: Record<string, unknown>) => void;
	/** Approval queue for gated (irreversible) actions. */
	approvals?: GitHubApprovals;
}

/** Best-effort requester id from the injected session, for the audit trail. */
function requesterOf(input: Record<string, unknown>): string {
	const sid = input.__sessionId;
	return typeof sid === "string" && sid ? sid : "agent";
}

/**
 * GitHub tools.
 *
 * Phase 1 (read): list_repos, read_file.
 * Phase 2 (build, ungated): list_branches, get_pr, list_prs, create_branch,
 *   commit_files (atomic), open_pr, update_pr, comment. The client refuses to
 *   write to a default/protected branch and never force-pushes, so the agent is
 *   structurally confined to the branch+PR workflow. Irreversible actions
 *   (merge, delete) are gated in Phase 3.
 *
 * Grouped under the on-demand `github` skill via `plugin: "github"`.
 */
export function createGitHubTools(
	client: GitHubClient,
	deps: GitHubToolDeps = {},
): ToolDefinition[] {
	const audit = deps.audit ?? (() => {});

	/** Run a write action, auditing the outcome (ok/fail) for the security trail. */
	async function audited<T>(
		action: string,
		details: Record<string, unknown>,
		fn: () => Promise<T>,
	): Promise<T> {
		try {
			const result = await fn();
			audit(`${action}.ok`, details);
			return result;
		} catch (err) {
			audit(`${action}.fail`, {
				...details,
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	}

	const errResult = (err: unknown): ToolResult => ({
		content: `GitHub error: ${err instanceof Error ? err.message : String(err)}`,
		is_error: true,
	});

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
				return errResult(err);
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
				repo: { type: "string", description: 'Repository as "owner/repo".' },
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
				return errResult(err);
			}
		},
	};

	const listBranches: ToolDefinition = {
		name: "github_list_branches",
		description:
			"List branches in an allowlisted repository, including whether each is protected.",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
			},
			required: ["repo"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const branches = await client.listBranches(input.repo as string);
				return { content: JSON.stringify({ branches }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const getPr: ToolDefinition = {
		name: "github_get_pr",
		description: "Get details of a single pull request by number.",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				number: { type: "number", description: "Pull request number." },
			},
			required: ["repo", "number"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const pr = await client.getPr(
					input.repo as string,
					input.number as number,
				);
				return { content: JSON.stringify(pr) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const listPrs: ToolDefinition = {
		name: "github_list_prs",
		description: "List pull requests in a repository (open by default).",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				state: {
					type: "string",
					enum: ["open", "closed", "all"],
					description: "Filter by state (default: open).",
				},
			},
			required: ["repo"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const prs = await client.listPrs(
					input.repo as string,
					(input.state as "open" | "closed" | "all") ?? "open",
				);
				return { content: JSON.stringify({ prs }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const createBranch: ToolDefinition = {
		name: "github_create_branch",
		description:
			"Create a new feature branch from the default branch (or a given ref). Use a descriptive name like `paw/<task>`. Refuses to create or overwrite the default branch.",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				branch: {
					type: "string",
					description: "New branch name, e.g. paw/fix-typo.",
				},
				from: {
					type: "string",
					description:
						"Optional base branch or commit SHA. Defaults to the default branch.",
				},
			},
			required: ["repo", "branch"],
		},
		handler: async (input): Promise<ToolResult> => {
			const repo = input.repo as string;
			const branch = input.branch as string;
			try {
				const res = await audited(
					"github.create_branch",
					{ repo, branch },
					() =>
						client.createBranch(repo, branch, input.from as string | undefined),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const commitFiles: ToolDefinition = {
		name: "github_commit_files",
		description:
			"Commit one or more files to a feature branch as a single atomic commit. Files are created or overwritten with the given content. Refuses to commit to the default or any protected branch, and never force-pushes — always work on a feature branch and open a PR.",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				branch: {
					type: "string",
					description:
						"Feature branch to commit to (must not be default/protected).",
				},
				message: { type: "string", description: "Commit message." },
				files: {
					type: "array",
					description: "Files to write in this commit.",
					items: {
						type: "object",
						properties: {
							path: { type: "string", description: "Path within the repo." },
							content: {
								type: "string",
								description: "Full UTF-8 file content.",
							},
						},
						required: ["path", "content"],
					},
				},
			},
			required: ["repo", "branch", "message", "files"],
		},
		handler: async (input): Promise<ToolResult> => {
			const repo = input.repo as string;
			const branch = input.branch as string;
			const files = (input.files as CommitFileInput[]) ?? [];
			try {
				const res = await audited(
					"github.commit",
					{ repo, branch, files: files.map((f) => f.path) },
					() =>
						client.commitFiles(repo, branch, files, input.message as string),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const openPr: ToolDefinition = {
		name: "github_open_pr",
		description:
			"Open a pull request from a feature branch into the base branch (default branch unless specified). Reuses an existing open PR for the same head→base. This is how the agent proposes changes for human review.",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				head: {
					type: "string",
					description: "Feature branch with the changes.",
				},
				base: {
					type: "string",
					description: "Target branch (defaults to the default branch).",
				},
				title: { type: "string", description: "PR title." },
				body: { type: "string", description: "PR description (markdown)." },
				draft: { type: "boolean", description: "Open as a draft PR." },
			},
			required: ["repo", "head", "title"],
		},
		handler: async (input): Promise<ToolResult> => {
			const repo = input.repo as string;
			try {
				const pr = await audited(
					"github.open_pr",
					{ repo, head: input.head, base: input.base },
					() =>
						client.openPr(repo, {
							head: input.head as string,
							base: input.base as string | undefined,
							title: input.title as string,
							body: input.body as string | undefined,
							draft: input.draft as boolean | undefined,
						}),
				);
				return { content: JSON.stringify(pr) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const updatePr: ToolDefinition = {
		name: "github_update_pr",
		description:
			"Update a pull request's title, body, or base branch. Closing or merging a PR is a separate, approval-gated action.",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				number: { type: "number", description: "Pull request number." },
				title: { type: "string", description: "New title." },
				body: { type: "string", description: "New body (markdown)." },
				base: { type: "string", description: "New base branch." },
			},
			required: ["repo", "number"],
		},
		handler: async (input): Promise<ToolResult> => {
			const repo = input.repo as string;
			const number = input.number as number;
			try {
				const pr = await audited("github.update_pr", { repo, number }, () =>
					client.updatePr(repo, number, {
						title: input.title as string | undefined,
						body: input.body as string | undefined,
						base: input.base as string | undefined,
					}),
				);
				return { content: JSON.stringify(pr) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const comment: ToolDefinition = {
		name: "github_comment",
		description:
			"Add a comment to a pull request or issue (e.g. to summarize changes or respond to review feedback).",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				number: {
					type: "number",
					description: "PR or issue number.",
				},
				body: { type: "string", description: "Comment body (markdown)." },
			},
			required: ["repo", "number", "body"],
		},
		handler: async (input): Promise<ToolResult> => {
			const repo = input.repo as string;
			const number = input.number as number;
			try {
				const res = await audited("github.comment", { repo, number }, () =>
					client.comment(repo, number, input.body as string),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	// --- Gated actions: enqueue for human approval, do NOT execute ---

	const queueUnavailable: ToolResult = {
		content:
			"The GitHub approval queue is unavailable, so this action cannot be requested.",
		is_error: true,
	};

	const mergePr: ToolDefinition = {
		name: "github_merge_pr",
		description:
			"Request to merge a pull request. This does NOT merge immediately — it queues the merge for one-click human approval on the GitHub page. Returns the pending-action id.",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				number: { type: "number", description: "Pull request number." },
				method: {
					type: "string",
					enum: ["merge", "squash", "rebase"],
					description: "Merge method (default: squash).",
				},
			},
			required: ["repo", "number"],
		},
		handler: async (input): Promise<ToolResult> => {
			if (!deps.approvals) return queueUnavailable;
			try {
				const repo = input.repo as string;
				const number = input.number as number;
				const method = (input.method as string) ?? "squash";
				const id = deps.approvals.enqueue(
					"merge_pr",
					repo,
					`Merge PR #${number} in ${repo} (${method})`,
					{ number, method },
					requesterOf(input),
				);
				return {
					content: JSON.stringify({
						queued: true,
						id,
						message:
							"Merge queued for human approval on the GitHub page. It will NOT merge until approved.",
					}),
				};
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const deleteBranch: ToolDefinition = {
		name: "github_delete_branch",
		description:
			"Request to delete a branch. Queues for human approval (does not delete immediately). Refuses the default/protected branch.",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				branch: { type: "string", description: "Branch name to delete." },
			},
			required: ["repo", "branch"],
		},
		handler: async (input): Promise<ToolResult> => {
			if (!deps.approvals) return queueUnavailable;
			try {
				const repo = input.repo as string;
				const branch = input.branch as string;
				const id = deps.approvals.enqueue(
					"delete_branch",
					repo,
					`Delete branch "${branch}" in ${repo}`,
					{ branch },
					requesterOf(input),
				);
				return {
					content: JSON.stringify({
						queued: true,
						id,
						message: "Branch deletion queued for human approval.",
					}),
				};
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const closeIssue: ToolDefinition = {
		name: "github_close_issue",
		description:
			"Request to close an issue. Queues for human approval (does not close immediately).",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				number: { type: "number", description: "Issue number." },
			},
			required: ["repo", "number"],
		},
		handler: async (input): Promise<ToolResult> => {
			if (!deps.approvals) return queueUnavailable;
			try {
				const repo = input.repo as string;
				const number = input.number as number;
				const id = deps.approvals.enqueue(
					"close_issue",
					repo,
					`Close issue #${number} in ${repo}`,
					{ number },
					requesterOf(input),
				);
				return {
					content: JSON.stringify({
						queued: true,
						id,
						message: "Issue close queued for human approval.",
					}),
				};
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const dispatchWorkflow: ToolDefinition = {
		name: "github_dispatch_workflow",
		description:
			"Request to trigger a GitHub Actions workflow (workflow_dispatch). Queues for human approval (does not run immediately).",
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: { type: "string", description: 'Repository as "owner/repo".' },
				workflowId: {
					type: "string",
					description: "Workflow file name (e.g. ci.yml) or numeric id.",
				},
				ref: { type: "string", description: "Git ref (branch/tag) to run on." },
				inputs: {
					type: "object",
					description: "Optional workflow inputs (string values).",
				},
			},
			required: ["repo", "workflowId", "ref"],
		},
		handler: async (input): Promise<ToolResult> => {
			if (!deps.approvals) return queueUnavailable;
			try {
				const repo = input.repo as string;
				const workflowId = input.workflowId as string;
				const ref = input.ref as string;
				const id = deps.approvals.enqueue(
					"dispatch_workflow",
					repo,
					`Run workflow "${workflowId}" on ${ref} in ${repo}`,
					{ workflowId, ref, inputs: input.inputs },
					requesterOf(input),
				);
				return {
					content: JSON.stringify({
						queued: true,
						id,
						message: "Workflow dispatch queued for human approval.",
					}),
				};
			} catch (err) {
				return errResult(err);
			}
		},
	};

	return [
		listRepos,
		readFile,
		listBranches,
		getPr,
		listPrs,
		createBranch,
		commitFiles,
		openPr,
		updatePr,
		comment,
		mergePr,
		deleteBranch,
		closeIssue,
		dispatchWorkflow,
	];
}
