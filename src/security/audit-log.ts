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
}
