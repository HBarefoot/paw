import type { Database } from "bun:sqlite";
import type { EventBus } from "../../kernel/bus.js";
import type { GitHubClient } from "./client.js";

export type GitHubGatedAction =
	| "merge_pr"
	| "delete_branch"
	| "close_issue"
	| "dispatch_workflow"
	// Generic non-GitHub approval (e.g. a lifecycle-hook `require-approval`
	// verdict). Reuses the queue's delivery + resolution surfaces; not
	// auto-executed on approve (see execute()).
	| "external";

/** Where an approval originated, so it can be delivered back to that surface. */
export interface ApprovalOrigin {
	channel: string;
	ref: string | null;
}

export interface PendingActionRow {
	id: string;
	action: GitHubGatedAction;
	repo: string;
	summary: string;
	params: Record<string, unknown>;
	status: "pending" | "executed" | "rejected" | "failed" | "expired";
	requested_by: string | null;
	created_at: string;
	decided_at: string | null;
	decided_by: string | null;
	result: Record<string, unknown> | null;
	origin_channel: string | null;
	origin_ref: string | null;
}

interface RawRow {
	id: string;
	action: GitHubGatedAction;
	repo: string;
	summary: string;
	params_json: string;
	status: PendingActionRow["status"];
	requested_by: string | null;
	created_at: string;
	decided_at: string | null;
	decided_by: string | null;
	result_json: string | null;
	origin_channel: string | null;
	origin_ref: string | null;
}

function hydrate(r: RawRow): PendingActionRow {
	return {
		id: r.id,
		action: r.action,
		repo: r.repo,
		summary: r.summary,
		params: safeParse(r.params_json) ?? {},
		status: r.status,
		requested_by: r.requested_by,
		created_at: r.created_at,
		decided_at: r.decided_at,
		decided_by: r.decided_by,
		result: r.result_json ? (safeParse(r.result_json) ?? null) : null,
		origin_channel: r.origin_channel ?? null,
		origin_ref: r.origin_ref ?? null,
	};
}

/**
 * Derive the origin channel + routing ref from a sessionId. Slack sessions are
 * `slack-<channel>-<threadTs>` (see plugins/slack), so we can route an approval
 * back to its thread without a separate context object. Unknown ⇒ `web`.
 */
export function originFromSessionId(
	sid: string | null | undefined,
): ApprovalOrigin {
	if (typeof sid !== "string" || !sid) return { channel: "web", ref: null };
	if (sid.startsWith("slack-")) {
		const rest = sid.slice("slack-".length);
		const i = rest.lastIndexOf("-");
		if (i > 0) {
			const channel = rest.slice(0, i);
			const threadTs = rest.slice(i + 1);
			return { channel: "slack", ref: JSON.stringify({ channel, threadTs }) };
		}
		return { channel: "slack", ref: null };
	}
	if (sid.startsWith("cron")) return { channel: "cron", ref: sid };
	if (sid.startsWith("system")) return { channel: "system", ref: sid };
	return { channel: "web", ref: sid };
}

/** Human-readable caption for the companion's waiting face. */
export function approvalLabel(rows: PendingActionRow[]): string {
	if (rows.length === 0) return "";
	if (rows.length === 1)
		return `Waiting for your approval — ${rows[0].summary}`;
	return `${rows.length} actions awaiting approval`;
}

function safeParse(s: string): Record<string, unknown> | null {
	try {
		return JSON.parse(s) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/**
 * GitHubApprovals — the "with control" queue. Irreversible/outward-facing GitHub
 * actions (merge, delete branch, close issue, dispatch workflow) are enqueued
 * here by the agent instead of executed. A human approves them one-by-one on the
 * /github page, at which point they run server-side. Modeled on the durable
 * canvas_submissions inbox.
 */
export class GitHubApprovals {
	constructor(
		private readonly db: Database,
		private readonly client: GitHubClient,
		private readonly audit?: (
			action: string,
			details: Record<string, unknown>,
		) => void,
		private readonly bus?: EventBus,
	) {}

	/** Queue an action for approval. Returns the new pending-action id. */
	enqueue(
		action: GitHubGatedAction,
		repo: string,
		summary: string,
		params: Record<string, unknown>,
		requestedBy?: string,
		origin?: ApprovalOrigin,
	): string {
		const id = crypto.randomUUID();
		const channel = origin?.channel ?? "web";
		const ref = origin?.ref ?? null;
		this.db.run(
			`INSERT INTO github_pending_actions (id, action, repo, summary, params_json, requested_by, origin_channel, origin_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				action,
				repo,
				summary,
				JSON.stringify(params),
				requestedBy ?? null,
				channel,
				ref,
			],
		);
		this.audit?.(`github.${action}.queued`, { id, repo, summary });
		// Notify channel plugins so they can deliver an approve/deny prompt to the
		// originating surface. Fire-and-forget — never block the tool handler.
		void this.bus?.emit("approval:pending", {
			id,
			action,
			summary,
			repo,
			originChannel: channel,
			originRef: ref,
			requestedBy: requestedBy ?? null,
		});
		return id;
	}

	/**
	 * Enqueue a generic, non-GitHub approval (e.g. a lifecycle-hook
	 * `require-approval` verdict). Reuses the queue's delivery (companion / web
	 * modal / Slack) and resolution endpoints; approving it records the decision
	 * but does not auto-execute anything (see execute() `"external"`).
	 */
	enqueueExternal(opts: {
		summary: string;
		params?: Record<string, unknown>;
		requestedBy?: string;
		origin?: ApprovalOrigin;
		repo?: string;
	}): string {
		return this.enqueue(
			"external",
			opts.repo ?? "—",
			opts.summary,
			opts.params ?? {},
			opts.requestedBy,
			opts.origin,
		);
	}

	/** Emit `approval:resolved` so every surface can sync (Slack message, companion). */
	private emitResolved(row: PendingActionRow, decidedBy: string): void {
		void this.bus?.emit("approval:resolved", {
			id: row.id,
			status: row.status as "executed" | "rejected" | "failed" | "unauthorized",
			decidedBy,
			originChannel: row.origin_channel,
			originRef: row.origin_ref,
		});
	}

	listPending(): PendingActionRow[] {
		return this.db
			.query<RawRow, []>(
				`SELECT * FROM github_pending_actions WHERE status = 'pending' ORDER BY created_at DESC`,
			)
			.all()
			.map(hydrate);
	}

	listRecent(limit = 20): PendingActionRow[] {
		return this.db
			.query<RawRow, [number]>(
				`SELECT * FROM github_pending_actions WHERE status != 'pending' ORDER BY COALESCE(decided_at, created_at) DESC LIMIT ?`,
			)
			.all(limit)
			.map(hydrate);
	}

	get(id: string): PendingActionRow | null {
		const row = this.db
			.query<RawRow, [string]>(
				"SELECT * FROM github_pending_actions WHERE id = ?",
			)
			.get(id);
		return row ? hydrate(row) : null;
	}

	/** Approve + execute a pending action. Returns the updated row. */
	async approve(id: string, decidedBy: string): Promise<PendingActionRow> {
		const row = this.get(id);
		if (!row) throw new Error(`Pending action ${id} not found.`);
		if (row.status !== "pending") {
			throw new Error(`Action ${id} is already ${row.status}.`);
		}
		try {
			const result = await this.execute(row);
			this.db.run(
				`UPDATE github_pending_actions SET status = 'executed', decided_at = datetime('now'), decided_by = ?, result_json = ? WHERE id = ?`,
				[decidedBy, JSON.stringify(result), id],
			);
			this.audit?.(`github.${row.action}.executed`, {
				id,
				repo: row.repo,
				decidedBy,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.db.run(
				`UPDATE github_pending_actions SET status = 'failed', decided_at = datetime('now'), decided_by = ?, result_json = ? WHERE id = ?`,
				[decidedBy, JSON.stringify({ error: msg }), id],
			);
			this.audit?.(`github.${row.action}.failed`, {
				id,
				repo: row.repo,
				error: msg,
			});
		}
		// biome-ignore lint/style/noNonNullAssertion: row exists (re-read after update)
		const updated = this.get(id)!;
		this.emitResolved(updated, decidedBy);
		return updated;
	}

	reject(id: string, decidedBy: string): PendingActionRow {
		const row = this.get(id);
		if (!row) throw new Error(`Pending action ${id} not found.`);
		if (row.status !== "pending") {
			throw new Error(`Action ${id} is already ${row.status}.`);
		}
		this.db.run(
			`UPDATE github_pending_actions SET status = 'rejected', decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
			[decidedBy, id],
		);
		this.audit?.(`github.${row.action}.rejected`, {
			id,
			repo: row.repo,
			decidedBy,
		});
		// biome-ignore lint/style/noNonNullAssertion: row exists (re-read after update)
		const updated = this.get(id)!;
		this.emitResolved(updated, decidedBy);
		return updated;
	}

	/**
	 * Flip `pending` rows older than `ttlHours` to `expired` (with one audit entry
	 * each) so an orphaned/abandoned approval can never hold the companion in its
	 * "waiting" state forever. Idempotent: a row only flips once. ttl ≤ 0 disables.
	 */
	expireStale(ttlHours: number): void {
		if (!(ttlHours > 0)) return;
		const cutoff = `-${Math.floor(ttlHours)} hours`;
		const stale = this.db
			.query<{ id: string; action: string; repo: string }, [string]>(
				`SELECT id, action, repo FROM github_pending_actions
         WHERE status = 'pending' AND created_at < datetime('now', ?)`,
			)
			.all(cutoff);
		if (stale.length === 0) return;
		this.db.run(
			`UPDATE github_pending_actions
       SET status = 'expired', decided_at = datetime('now'), decided_by = 'system:ttl'
       WHERE status = 'pending' AND created_at < datetime('now', ?)`,
			[cutoff],
		);
		for (const r of stale) {
			this.audit?.(`github.${r.action}.expired`, { id: r.id, repo: r.repo });
		}
	}

	/**
	 * Currently-actionable approvals: expires stale rows first, then returns the
	 * remaining fresh `pending` rows. This is what drives the companion's count +
	 * caption, so the face is always honest about what's truly awaiting a decision.
	 */
	actionable(ttlHours: number): PendingActionRow[] {
		this.expireStale(ttlHours);
		return this.listPending();
	}

	/** Dispatch the approved action to the live GitHub client. */
	private async execute(row: PendingActionRow): Promise<unknown> {
		const p = row.params;
		switch (row.action) {
			case "merge_pr":
				return this.client.mergePr(
					row.repo,
					Number(p.number),
					(p.method as "merge" | "squash" | "rebase") ?? "squash",
				);
			case "delete_branch":
				return this.client.deleteBranch(row.repo, String(p.branch));
			case "close_issue":
				return this.client.closeIssue(row.repo, Number(p.number));
			case "dispatch_workflow":
				return this.client.dispatchWorkflow(
					row.repo,
					String(p.workflowId),
					String(p.ref),
					p.inputs as Record<string, string> | undefined,
				);
			case "external":
				// Approving an external (hook-originated) request records the human
				// decision but does NOT re-run the blocked tool call — full
				// re-execution on approve is a deferred follow-up. Resolves cleanly.
				return {
					approved: true,
					note: "External approval recorded; tool re-execution on approve is not yet automated.",
				};
			default:
				throw new Error(`Unknown gated action: ${row.action}`);
		}
	}
}
