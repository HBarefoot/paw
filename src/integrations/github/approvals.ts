import type { Database } from "bun:sqlite";
import type { GitHubClient } from "./client.js";

export type GitHubGatedAction =
	| "merge_pr"
	| "delete_branch"
	| "close_issue"
	| "dispatch_workflow";

export interface PendingActionRow {
	id: string;
	action: GitHubGatedAction;
	repo: string;
	summary: string;
	params: Record<string, unknown>;
	status: "pending" | "executed" | "rejected" | "failed";
	requested_by: string | null;
	created_at: string;
	decided_at: string | null;
	decided_by: string | null;
	result: Record<string, unknown> | null;
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
	};
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
	) {}

	/** Queue an action for approval. Returns the new pending-action id. */
	enqueue(
		action: GitHubGatedAction,
		repo: string,
		summary: string,
		params: Record<string, unknown>,
		requestedBy?: string,
	): string {
		const id = crypto.randomUUID();
		this.db.run(
			`INSERT INTO github_pending_actions (id, action, repo, summary, params_json, requested_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
			[id, action, repo, summary, JSON.stringify(params), requestedBy ?? null],
		);
		this.audit?.(`github.${action}.queued`, { id, repo, summary });
		return id;
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
		return this.get(id)!;
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
		return this.get(id)!;
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
			default:
				throw new Error(`Unknown gated action: ${row.action}`);
		}
	}
}
