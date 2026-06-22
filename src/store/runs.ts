import type { Database } from "bun:sqlite";
import type { RunRecord, Verdict } from "../observability/run-verdict.js";

/**
 * The `runs` ledger — one denormalized row per completed run, holding the
 * deterministic verdict (#observability Phase 1) so phantom-success runs are
 * queryable without recomputing. Written fail-open at run completion; read by
 * the /runs board. Mirrors src/store/sessions.ts (typed, parameterized).
 */

export interface Run {
	id: string;
	session_id: string;
	channel: string | null;
	user_id: string | null;
	claim_preview: string | null;
	tool_calls: number;
	tool_errors: number;
	verdict: Verdict;
	flags: string; // JSON array string
	started_at: string | null;
	ended_at: string | null;
	created_at: string;
}

export function recordRun(db: Database, row: RunRecord): void {
	db.run(
		`INSERT INTO runs
       (id, session_id, channel, user_id, claim_preview, tool_calls, tool_errors, verdict, flags, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			row.id,
			row.session_id,
			row.channel,
			row.user_id,
			row.claim_preview,
			row.tool_calls,
			row.tool_errors,
			row.verdict,
			row.flags,
			row.started_at,
			row.ended_at,
		],
	);
}

export function getRun(db: Database, id: string): Run | null {
	return db.query<Run, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
}

export function listRecentRuns(db: Database, limit = 100): Run[] {
	return db
		.query<Run, [number]>("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
		.all(limit);
}

export function listRunsByVerdict(
	db: Database,
	verdict: Verdict,
	limit = 100,
): Run[] {
	return db
		.query<Run, [string, number]>(
			"SELECT * FROM runs WHERE verdict = ? ORDER BY created_at DESC LIMIT ?",
		)
		.all(verdict, limit);
}
