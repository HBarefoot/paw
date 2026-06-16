// Playbook tools — load / create / update self-authored markdown procedures.
//
//   load_playbook(name)   → read-only: returns the full markdown BODY into
//                           context so the model can follow the steps.
//   create_playbook(...)  → side-effectful: validates a light quality bar, then
//                           ENQUEUES a human approval and returns "queued". It
//                           does NOT write on call. The file is written AND the
//                           live catalog refreshed (hot) ON APPROVE via the
//                           executor registered on the approval queue.
//   update_playbook(...)  → same approval + hot-refresh path, for an existing one.
//
// This mirrors the canvas_apply_edit / GitHub control model (enqueue → human
// approves → execute-on-approve), so authoring a new agent capability never
// persists without an explicit human decision. Playbooks are GUIDANCE the model
// follows — there is no executor/run-state (see PROMPT-paw-workflow-engine-phase1).

import type { DraftPlaybook, PlaybookManager } from "../playbooks/manager.js";
import type { ToolDefinition, ToolResult } from "../types/message.js";

/** The gated action name the create/update tools enqueue onto the approval queue. */
export const PLAYBOOK_SAVE_ACTION = "playbook_save";

/** Minimal slice of the approval queue these tools need. */
export interface PlaybookApprovalEnqueuer {
	enqueue(
		action: "playbook_save",
		repo: string,
		summary: string,
		params: Record<string, unknown>,
		requestedBy?: string,
	): string;
}

export interface PlaybookToolsDeps {
	manager: PlaybookManager;
	/** The approval queue; when absent, create/update report unavailable. */
	approvals?: PlaybookApprovalEnqueuer;
}

/** Coerce the create/update input into a normalized draft. Accepts `steps[]` or `body`. */
function toDraft(input: Record<string, unknown>): DraftPlaybook {
	const name = String(input.name ?? "").trim();
	const description = String(input.description ?? "").trim();
	let body = "";
	if (Array.isArray(input.steps)) {
		body = input.steps
			.map((s, i) => `${i + 1}. ${String(s).trim()}`)
			.join("\n");
	} else if (typeof input.body === "string") {
		body = input.body;
	} else if (typeof input.steps === "string") {
		body = input.steps;
	}
	return { name, description, body };
}

function enqueueSave(
	deps: PlaybookToolsDeps,
	mode: "create" | "update",
	input: Record<string, unknown>,
): ToolResult {
	if (!deps.approvals) {
		return {
			content: "Error: approval queue unavailable; cannot queue playbook save.",
			is_error: true,
		};
	}
	const draft = toDraft(input);
	const verdict = deps.manager.validateDraft(draft, mode);
	if (!verdict.ok) {
		return { content: `Error: ${verdict.error}`, is_error: true };
	}
	const id = deps.approvals.enqueue(
		PLAYBOOK_SAVE_ACTION,
		"playbook",
		`${mode === "create" ? "Create" : "Update"} playbook "${draft.name}" — ${draft.description}`,
		{
			mode,
			name: draft.name,
			description: draft.description,
			body: draft.body,
		},
		typeof input.__requestedBy === "string" ? input.__requestedBy : undefined,
	);
	return {
		content: JSON.stringify({
			queued: true,
			id,
			message: `Playbook "${draft.name}" proposed. It will be saved and become available only after the operator approves.`,
		}),
	};
}

export function createPlaybookTools(deps: PlaybookToolsDeps): ToolDefinition[] {
	const loadPlaybook: ToolDefinition = {
		name: "load_playbook",
		description:
			"Load a reusable playbook by name to read its full step-by-step instructions into context, then follow them. Use when the current task matches a playbook listed in 'Available Playbooks'.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description:
						"The playbook name (from the Available Playbooks catalog).",
				},
			},
			required: ["name"],
		},
		handler: async (input): Promise<ToolResult> => {
			const name = String(input.name ?? "").trim();
			const entry = deps.manager.get(name);
			if (!entry) {
				const available = deps.manager.names;
				const list = available.length
					? available.join(", ")
					: "(none yet — author one with create_playbook)";
				return {
					content: `Error: no playbook named "${name}". Available: ${list}`,
					is_error: true,
				};
			}
			return {
				content: JSON.stringify({
					name: entry.name,
					description: entry.description,
					body: entry.body,
				}),
			};
		},
	};

	const createPlaybook: ToolDefinition = {
		name: "create_playbook",
		description:
			"Author a NEW reusable playbook (a self-written, multi-step markdown procedure) when a genuinely reusable procedure emerges. Provide a slug `name`, a `description` that states WHEN to use it (the trigger), and the `steps`. This does NOT save immediately — it queues the playbook for one-click operator approval and returns the pending id. On approval the playbook is written and becomes loadable in this same session. Refuses a name that collides with an existing playbook (use update_playbook to edit).",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description:
						"Slug name (lowercase, dash-separated, e.g. lead-intake).",
				},
				description: {
					type: "string",
					description:
						"When to use this playbook — the trigger condition, not just what it is.",
				},
				steps: {
					type: "array",
					items: { type: "string" },
					description:
						"The ordered steps (≥2). Alternatively pass `body` as markdown.",
				},
				body: {
					type: "string",
					description:
						"Full markdown body (alternative to `steps`). Use for richer formatting.",
				},
			},
			required: ["name", "description"],
		},
		handler: async (input): Promise<ToolResult> =>
			enqueueSave(deps, "create", input),
	};

	const updatePlaybook: ToolDefinition = {
		name: "update_playbook",
		description:
			"Edit an EXISTING playbook's description and/or steps. Like create_playbook, the change is queued for operator approval and applied (with a hot catalog refresh) only after approval. Refuses a name that does not yet exist (use create_playbook to add it).",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "The existing playbook's slug name.",
				},
				description: {
					type: "string",
					description: "Updated description (when to use it).",
				},
				steps: {
					type: "array",
					items: { type: "string" },
					description: "Updated ordered steps (≥2). Alternatively pass `body`.",
				},
				body: {
					type: "string",
					description: "Updated full markdown body (alternative to `steps`).",
				},
			},
			required: ["name", "description"],
		},
		handler: async (input): Promise<ToolResult> =>
			enqueueSave(deps, "update", input),
	};

	return [loadPlaybook, createPlaybook, updatePlaybook];
}
