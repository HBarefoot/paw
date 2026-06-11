import type { Database } from "bun:sqlite";

export type NotificationLevel = "info" | "success" | "warning" | "error";

export interface NotificationInput {
	kind?: string;
	title: string;
	body?: string;
	url?: string;
	level?: NotificationLevel;
}

export interface NotificationRow {
	id: string;
	kind: string;
	title: string;
	body: string | null;
	url: string | null;
	level: NotificationLevel;
	read: number;
	created_at: string;
}

/**
 * NotificationStore — the agent's durable "I have something for you" inbox.
 * Backs the nav badge + the canvas portrait "attentive" state so proactive
 * messages (GitHub events, CI investigations) aren't lost when the user is away.
 */
export class NotificationStore {
	constructor(private readonly db: Database) {}

	add(input: NotificationInput): string {
		const id = crypto.randomUUID();
		this.db.run(
			`INSERT INTO notifications (id, kind, title, body, url, level) VALUES (?, ?, ?, ?, ?, ?)`,
			[
				id,
				input.kind ?? "system",
				input.title,
				input.body ?? null,
				input.url ?? null,
				input.level ?? "info",
			],
		);
		return id;
	}

	unreadCount(): number {
		const row = this.db
			.query<{ n: number }, []>(
				"SELECT COUNT(*) AS n FROM notifications WHERE read = 0",
			)
			.get();
		return row?.n ?? 0;
	}

	listRecent(limit = 50): NotificationRow[] {
		return this.db
			.query<NotificationRow, [number]>(
				"SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?",
			)
			.all(limit);
	}

	markRead(id: string): void {
		this.db.run("UPDATE notifications SET read = 1 WHERE id = ?", [id]);
	}

	markAllRead(): void {
		this.db.run("UPDATE notifications SET read = 1 WHERE read = 0");
	}

	/** Prune read notifications older than `days` to keep the table small. */
	prune(days = 30): void {
		this.db.run(
			`DELETE FROM notifications WHERE read = 1 AND created_at < datetime('now', ?)`,
			[`-${days} days`],
		);
	}
}
