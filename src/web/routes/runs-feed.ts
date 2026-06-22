// Run-verdict board feed — the read-only /runs surface (observability Phase 1).
// Pure + kernel-decoupled (mirrors tasks-feed.ts): app.ts reads run rows from
// the store and hands them here; this shapes the JSON the client runs.js polls.
// Suspect/error runs sort to the top so phantom-success surfaces first.

import type { Verdict } from "../../observability/run-verdict.js";
import type { Run } from "../../store/runs.js";

export interface RunCard {
	id: string;
	session_id: string;
	channel: string | null;
	verdict: Verdict;
	claim_preview: string | null;
	flags: string[];
	tool_calls: number;
	tool_errors: number;
	created_at: string;
}

export interface RunsFeedResponse {
	runs: RunCard[];
	counts: { ok: number; suspect: number; error: number };
	version: number;
}

// error first, then suspect, then ok — the review-worthy runs float up.
const VERDICT_RANK: Record<Verdict, number> = { error: 0, suspect: 1, ok: 2 };

function parseFlags(raw: string): string[] {
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.map(String) : [];
	} catch {
		return [];
	}
}

function toCard(row: Run): RunCard {
	return {
		id: row.id,
		session_id: row.session_id,
		channel: row.channel,
		verdict: row.verdict,
		claim_preview: row.claim_preview,
		flags: parseFlags(row.flags),
		tool_calls: row.tool_calls,
		tool_errors: row.tool_errors,
		created_at: row.created_at,
	};
}

/**
 * Build the runs feed from raw rows. `now` is accepted for signature parity with
 * the other feed builders (and future relative-time use); ordering is by verdict
 * severity then recency. Pure — deterministic for a given input.
 */
export function buildRunsFeed(
	rows: Run[],
	_now: number = Date.now(),
): RunsFeedResponse {
	const counts = { ok: 0, suspect: 0, error: 0 };
	let version = 0;
	for (const r of rows) {
		if (r.verdict in counts) counts[r.verdict]++;
		const t = Date.parse(r.created_at);
		if (!Number.isNaN(t) && t > version) version = t;
	}

	const runs = rows.map(toCard).sort((a, b) => {
		const byVerdict = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict];
		if (byVerdict !== 0) return byVerdict;
		// recency within a verdict band (newest first)
		return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
	});

	return { runs, counts, version };
}
