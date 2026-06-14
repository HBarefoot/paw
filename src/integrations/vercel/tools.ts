import type { ToolDefinition, ToolResult } from "../../types/message.js";
import {
	type GitHubApprovals,
	originFromSessionId,
} from "../github/approvals.js";
import type { DeployTarget } from "./types.js";

export interface VercelToolDeps {
	/** Records a security-audit entry (unused by reads; gated actions are
	 *  audited by the approval queue). Kept for parity with other integrations. */
	audit?: (action: string, details: Record<string, unknown>) => void;
	/** Approval queue for gated (irreversible) actions. */
	approvals?: GitHubApprovals;
}

/** Best-effort requester id from the injected session, for the audit trail. */
function requesterOf(input: Record<string, unknown>): string {
	const sid = input.__sessionId;
	return typeof sid === "string" && sid ? sid : "agent";
}

/** Origin channel/ref derived from the injected session, so the approval prompt
 *  routes back to where it came from (Slack thread, web modal, …). */
function originOf(input: Record<string, unknown>) {
	return originFromSessionId(
		typeof input.__sessionId === "string" ? input.__sessionId : null,
	);
}

/**
 * Vercel tools.
 *
 * Reads (immediate): vercel_list_projects, vercel_deploy_status.
 * Irreversible (gated → enqueued for human approval, do NOT execute):
 *   vercel_create_project, vercel_add_domain. On approve, the kernel-registered
 *   executor runs the matching VercelClient method (see kernel wiring).
 *
 * Grouped under the on-demand `vercel` skill via `plugin: "vercel"`. The API
 * token never appears in any tool output — it lives only in the server-side
 * Bearer header inside the client.
 */
export function createVercelTools(
	client: DeployTarget,
	deps: VercelToolDeps = {},
): ToolDefinition[] {
	const errResult = (err: unknown): ToolResult => ({
		content: `Vercel error: ${err instanceof Error ? err.message : String(err)}`,
		is_error: true,
	});

	// --- Reads: execute immediately ---

	const listProjects: ToolDefinition = {
		name: "vercel_list_projects",
		description:
			"List the Vercel projects in the connected account (or team). Returns id, name, and detected framework.",
		plugin: "vercel",
		input_schema: { type: "object", properties: {} },
		handler: async (): Promise<ToolResult> => {
			try {
				const projects = await client.listProjects();
				return { content: JSON.stringify({ projects }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const deployStatus: ToolDefinition = {
		name: "vercel_deploy_status",
		description:
			"Get the build/deploy status of a Vercel deployment by its id or hostname. Returns readyState (QUEUED/BUILDING/READY/ERROR/CANCELED) and the deployment url. A readyState of ERROR means the build failed — inspect it on Vercel.",
		plugin: "vercel",
		input_schema: {
			type: "object",
			properties: {
				deployment: {
					type: "string",
					description:
						"Deployment id or hostname (e.g. my-site-abc123.vercel.app).",
				},
			},
			required: ["deployment"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const status = await client.getDeploymentStatus(
					input.deployment as string,
				);
				return { content: JSON.stringify(status) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	// --- Gated actions: enqueue for human approval, do NOT execute ---

	const queueUnavailable: ToolResult = {
		content:
			"The approval queue is unavailable, so this action cannot be requested.",
		is_error: true,
	};

	const createProject: ToolDefinition = {
		name: "vercel_create_project",
		description:
			"Request to create a Vercel project, optionally linked to a GitHub repo so pushes auto-deploy. This does NOT create immediately — it queues the action for one-click human approval. Idempotent: if a project of the same name already exists it is returned unchanged. Returns the pending-action id.",
		plugin: "vercel",
		input_schema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description:
						"Desired project name (will be slugified to Vercel's naming rules).",
				},
				repo: {
					type: "string",
					description:
						'GitHub repository as "owner/repo" to link for auto-deploy-on-push. Requires the Vercel↔GitHub app to be connected for the account. Omit for an unlinked project.',
				},
				framework: {
					type: "string",
					description:
						"Optional framework preset (e.g. nextjs). Omit for a plain static site.",
				},
			},
			required: ["name"],
		},
		handler: async (input): Promise<ToolResult> => {
			if (!deps.approvals) return queueUnavailable;
			try {
				const name = input.name as string;
				const repo = input.repo as string | undefined;
				const framework = input.framework as string | undefined;
				const id = deps.approvals.enqueue(
					"vercel_create_project",
					repo ?? name,
					`Create Vercel project "${name}"${repo ? ` linked to ${repo}` : ""}`,
					{ name, repo, framework },
					requesterOf(input),
					originOf(input),
				);
				return {
					content: JSON.stringify({
						queued: true,
						id,
						message:
							"Project creation queued for human approval. It will NOT be created until approved.",
					}),
				};
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const addDomain: ToolDefinition = {
		name: "vercel_add_domain",
		description:
			"Request to add a custom domain to a Vercel project. This does NOT add immediately — it queues for human approval. On approval, if the domain is not yet verified the result includes the TXT verification challenge to add to DNS.",
		plugin: "vercel",
		input_schema: {
			type: "object",
			properties: {
				project: {
					type: "string",
					description: "Project id or name to attach the domain to.",
				},
				name: {
					type: "string",
					description: "The domain name (e.g. example.com).",
				},
			},
			required: ["project", "name"],
		},
		handler: async (input): Promise<ToolResult> => {
			if (!deps.approvals) return queueUnavailable;
			try {
				const project = input.project as string;
				const name = input.name as string;
				const id = deps.approvals.enqueue(
					"vercel_add_domain",
					project,
					`Add domain "${name}" to Vercel project ${project}`,
					{ project, name },
					requesterOf(input),
					originOf(input),
				);
				return {
					content: JSON.stringify({
						queued: true,
						id,
						message: "Domain addition queued for human approval.",
					}),
				};
			} catch (err) {
				return errResult(err);
			}
		},
	};

	return [listProjects, deployStatus, createProject, addDomain];
}
