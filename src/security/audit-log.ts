import type { Database } from "bun:sqlite";

export class AuditLogger {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	log(
		action: string,
		userId: number | null,
		details?: Record<string, unknown>,
		ipAddress?: string,
	): void {
		this.db.run(
			"INSERT INTO audit_log (action, user_id, details, ip_address) VALUES (?, ?, ?, ?)",
			[
				action,
				userId,
				details ? JSON.stringify(details) : null,
				ipAddress ?? null,
			],
		);
	}

	getRecent(limit = 50): Array<{
		id: number;
		action: string;
		user_id: number | null;
		details: string | null;
		ip_address: string | null;
		created_at: string;
	}> {
		return this.db
			.query<
				{
					id: number;
					action: string;
					user_id: number | null;
					details: string | null;
					ip_address: string | null;
					created_at: string;
				},
				[number]
			>("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?")
			.all(limit);
	}

	query(opts?: {
		limit?: number;
		action?: string;
		userId?: number;
	}): Array<{
		id: number;
		action: string;
		user_id: number | null;
		details: string | null;
		ip_address: string | null;
		created_at: string;
	}> {
		const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
		const conds: string[] = [];
		const params: (string | number)[] = [];
		if (opts?.action) {
			conds.push("action LIKE ?");
			params.push(`${opts.action.replace(/[%_]/g, (c) => `\\${c}`)}%`);
		}
		if (typeof opts?.userId === "number") {
			conds.push("user_id = ?");
			params.push(opts.userId);
		}
		const whereClause = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
		params.push(limit);
		return this.db
			.prepare<
				{
					id: number;
					action: string;
					user_id: number | null;
					details: string | null;
					ip_address: string | null;
					created_at: string;
				},
				(string | number)[]
			>(
				`SELECT id, action, user_id, details, ip_address, created_at
           FROM audit_log ${whereClause}
          ORDER BY id DESC
          LIMIT ?`,
			)
			.all(...params);
	}

	distinctActions(limit = 50): string[] {
		return this.db
			.query<{ action: string }, [number]>(
				"SELECT DISTINCT action FROM audit_log ORDER BY action LIMIT ?",
			)
			.all(limit)
			.map((r) => r.action);
	}
}
