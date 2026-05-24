import type { Database } from "bun:sqlite";

export interface ToolLogEntry {
	id: number;
	session_id: string | null;
	tool_name: string;
	plugin: string | null;
	input_preview: string | null;
	output_preview: string | null;
	is_error: number;
	duration_ms: number | null;
	created_at: string;
}

/** Limit on preview lengths so long tool outputs don't bloat the DB. */
const MAX_PREVIEW_LEN = 2000;

function preview(value: unknown): string {
	if (value == null) return "";
	let s: string;
	try {
		s = typeof value === "string" ? value : JSON.stringify(value);
	} catch {
		s = String(value);
	}
	return s.length > MAX_PREVIEW_LEN
		? `${s.slice(0, MAX_PREVIEW_LEN)}…`
		: s;
}

export class ToolLog {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	record(opts: {
		toolName: string;
		plugin?: string | null;
		sessionId?: string | null;
		input?: unknown;
		output?: unknown;
		isError?: boolean;
		durationMs?: number;
	}): void {
		try {
			this.db.run(
				`INSERT INTO tool_log
           (session_id, tool_name, plugin, input_preview, output_preview, is_error, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[
					opts.sessionId ?? null,
					opts.toolName,
					opts.plugin ?? null,
					preview(opts.input),
					preview(opts.output),
					opts.isError ? 1 : 0,
					opts.durationMs ?? null,
				],
			);
		} catch {
			// Logging must never break tool execution.
		}
	}

	query(opts?: {
		limit?: number;
		tool?: string;
		sessionId?: string;
		errorsOnly?: boolean;
	}): ToolLogEntry[] {
		const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
		const conds: string[] = [];
		const params: (string | number)[] = [];
		if (opts?.tool) {
			conds.push("tool_name = ?");
			params.push(opts.tool);
		}
		if (opts?.sessionId) {
			conds.push("session_id = ?");
			params.push(opts.sessionId);
		}
		if (opts?.errorsOnly) {
			conds.push("is_error = 1");
		}
		const whereClause = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
		params.push(limit);
		return this.db
			.prepare<ToolLogEntry, (string | number)[]>(
				`SELECT id, session_id, tool_name, plugin,
                input_preview, output_preview, is_error,
                duration_ms, created_at
           FROM tool_log ${whereClause}
          ORDER BY id DESC
          LIMIT ?`,
			)
			.all(...params);
	}

	distinctTools(limit = 50): string[] {
		return this.db
			.query<{ tool_name: string }, [number]>(
				"SELECT DISTINCT tool_name FROM tool_log ORDER BY tool_name LIMIT ?",
			)
			.all(limit)
			.map((r) => r.tool_name);
	}

	summary(): {
		total: number;
		errors: number;
		avgDurationMs: number | null;
	} {
		const row = this.db
			.query<
				{ total: number; errors: number; avg_duration: number | null },
				[]
			>(
				`SELECT COUNT(*) AS total,
                SUM(is_error) AS errors,
                AVG(duration_ms) AS avg_duration
           FROM tool_log`,
			)
			.get();
		return {
			total: row?.total ?? 0,
			errors: row?.errors ?? 0,
			avgDurationMs: row?.avg_duration ?? null,
		};
	}
}
