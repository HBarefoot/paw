// Companion-driven canvas edit tools (PR C). The admin asks the in-page
// Assistant to change the page; the agent uses these to discover and edit text:
//
//   canvas_list_edits(path)  → read-only: stamp anchors + return the editable map
//                              [{editId, tag, text}] so the agent can target an
//                              element. No approval (benign, idempotent stamp).
//   canvas_apply_edit(...)   → side-effectful: ENQUEUES a human approval and
//                              returns "queued" — it does NOT apply on call.
//                              The edit (anchor-splice, same path as PR B's inline
//                              editor) is applied + audited ON APPROVE via the
//                              executor registered on the approval queue.
//
// This mirrors the GitHub tools' control model (enqueue → human approves →
// execute-on-approve), so a powerful agent capability never mutates the page
// without an explicit human decision.
//
// NOTE: the live-DOM verbs from the spec (readDom / queryAll / highlight /
// execJs) are intentionally NOT here — they require a browser postMessage bridge
// that can't be verified headlessly, and execJs (arbitrary JS in the admin's
// authenticated page) can't be safely gated via streamHandler (which bypasses the
// tool approval gate). They're a documented follow-up.

import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import {
	listEditAnchors,
	spliceEditById,
	stampEditAnchors,
} from "../web/canvas-edit.js";
import type { ToolDefinition, ToolResult } from "../types/message.js";
import { safePath, writeCanvasFile } from "./canvas-write.js";

/** Minimal slice of the approval queue the apply tool needs (so this module
 *  doesn't import the GitHub approvals class directly). */
export interface ApprovalEnqueuer {
	enqueue(
		action: "canvas_apply_edit",
		repo: string,
		summary: string,
		params: Record<string, unknown>,
		requestedBy?: string,
	): string;
}

export interface CanvasBridgeDeps {
	canvasRoot: string;
	db?: Database;
	/** The approval queue; when absent, canvas_apply_edit reports unavailable. */
	approvals?: ApprovalEnqueuer;
	/** Audit sink for the applied edit (wired to an AuditLogger in the kernel). */
	audit?: (action: string, details: Record<string, unknown>) => void;
}

function isEditableHtml(full: string): boolean {
	const e = extname(full).toLowerCase();
	return e === ".html" || e === ".htm";
}

export type ApplyEditParams = {
	path: string;
	editId: string;
	newText: string;
	originalText: string;
};

/**
 * Apply a queued canvas edit — the execute-on-approve body. Reuses PR B's
 * anchor-splice + the shared canvas-write path (version snapshot + atomic write +
 * live-reload). Registered on the approval queue as the "canvas_apply_edit"
 * executor; runs only after a human approves.
 */
export async function applyCanvasEdit(
	params: ApplyEditParams,
	deps: {
		canvasRoot: string;
		db?: Database;
		audit?: CanvasBridgeDeps["audit"];
	},
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
	const { canvasRoot, db, audit } = deps;
	const full = safePath(params.path, canvasRoot);
	if (!full || !existsSync(full)) return { ok: false, error: "not_found" };
	if (!isEditableHtml(full)) return { ok: false, error: "not_editable" };

	const result = spliceEditById(
		readFileSync(full, "utf-8"),
		params.editId,
		params.newText,
		params.originalText,
	);
	if (!result.ok) return { ok: false, error: result.error };

	const wr = await writeCanvasFile({
		root: canvasRoot,
		relPath: params.path,
		content: result.html,
		db,
	});
	if (!wr.ok) return { ok: false, error: wr.error };

	audit?.("canvas_bridge.apply_edit", {
		path: params.path,
		editId: params.editId,
	});
	return { ok: true, path: params.path };
}

export function createCanvasBridgeTools(
	deps: CanvasBridgeDeps,
): ToolDefinition[] {
	const root = deps.canvasRoot;

	const listEdits: ToolDefinition = {
		name: "canvas_list_edits",
		description:
			"List the editable text elements on a canvas HTML page so you can change one. Stamps stable data-edit-id anchors into the page and returns [{editId, tag, text}]. Read-only/no approval. Use canvas_apply_edit with an editId + the element's current text to request a change.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"Canvas file path (e.g. 'index.html', 'apps/shop/index.html')",
				},
			},
			required: ["path"],
		},
		handler: async (input): Promise<ToolResult> => {
			const rel = String(input.path ?? "");
			const full = rel ? safePath(rel, root) : null;
			if (!full || !existsSync(full))
				return { content: "Error: page not found", is_error: true };
			if (!isEditableHtml(full))
				return {
					content: "Error: only HTML pages are editable",
					is_error: true,
				};
			const { html, changed } = stampEditAnchors(readFileSync(full, "utf-8"));
			if (changed) {
				const wr = await writeCanvasFile({
					root,
					relPath: rel,
					content: html,
					db: deps.db,
				});
				if (!wr.ok)
					return {
						content: `Error stamping anchors: ${wr.error}`,
						is_error: true,
					};
			}
			return {
				content: JSON.stringify({ path: rel, edits: listEditAnchors(html) }),
			};
		},
	};

	const applyEdit: ToolDefinition = {
		name: "canvas_apply_edit",
		description:
			"Request a text change to a canvas page element (found via canvas_list_edits). This does NOT apply immediately — it queues the edit for one-click human approval and returns the pending-action id. The change is applied (and audited) only after the human approves.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Canvas file path" },
				editId: {
					type: "string",
					description:
						"The data-edit-id of the element (from canvas_list_edits)",
				},
				newText: { type: "string", description: "The new text content" },
				originalText: {
					type: "string",
					description:
						"The element's CURRENT text (from canvas_list_edits) — used to detect a stale page and refuse to clobber.",
				},
			},
			required: ["path", "editId", "newText", "originalText"],
		},
		handler: async (input): Promise<ToolResult> => {
			if (!deps.approvals) {
				return {
					content: "Error: approval queue unavailable; cannot queue edit.",
					is_error: true,
				};
			}
			const path = String(input.path ?? "");
			const editId = String(input.editId ?? "");
			const newText = typeof input.newText === "string" ? input.newText : "";
			const originalText =
				typeof input.originalText === "string" ? input.originalText : "";
			if (!path || !editId) {
				return {
					content: "Error: path and editId are required",
					is_error: true,
				};
			}
			// Validate the target now so we don't queue an un-appliable edit.
			const full = safePath(path, root);
			if (!full || !existsSync(full) || !isEditableHtml(full)) {
				return { content: "Error: page is not editable", is_error: true };
			}
			const id = deps.approvals.enqueue(
				"canvas_apply_edit",
				"canvas",
				`Edit "${path}" (${editId})`,
				{ path, editId, newText, originalText },
				typeof input.__requestedBy === "string"
					? input.__requestedBy
					: undefined,
			);
			return {
				content: JSON.stringify({
					queued: true,
					id,
					message:
						"Edit queued for human approval. It will be applied to the page only after approval.",
				}),
			};
		},
	};

	return [listEdits, applyEdit];
}
