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

/** Full payload handed to the onAdd callback on every new notification. */
export interface NotificationEvent {
	id: string;
	kind: string;
	title: string;
	body?: string;
	url?: string;
	level: NotificationLevel;
}

/**
 * NotificationStore — the agent's durable "I have something for you" inbox.
 * Backs the nav badge + the canvas portrait "attentive" state so proactive
 * messages (GitHub events, CI investigations) aren't lost when the user is away.
 *
 * `onAdd` (wired to the EventBus by the kernel) fires for EVERY notification, so
 * out-of-band senders (Slack, the avatar) get a single, central hook regardless
 * of who calls `add()`.
 */
export class NotificationStore {
	constructor(
		private readonly db: Database,
		private readonly onAdd?: (n: NotificationEvent) => void,
	) {}

	add(input: NotificationInput): string {
		const id = crypto.randomUUID();
		const kind = input.kind ?? "system";
		const level = input.level ?? "info";
		this.db.run(
			"INSERT INTO notifications (id, kind, title, body, url, level) VALUES (?, ?, ?, ?, ?, ?)",
			[id, kind, input.title, input.body ?? null, input.url ?? null, level],
		);
		this.onAdd?.({
			id,
			kind,
			title: input.title,
			body: input.body,
			url: input.url,
			level,
		});
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

	/** Unread counts grouped by `kind` — the companion badges the skill pill whose
	 *  key matches a kind (e.g. "github", "slack"). */
	unreadCountByKind(): Record<string, number> {
		const rows = this.db
			.query<{ kind: string; n: number }, []>(
				"SELECT kind, COUNT(*) AS n FROM notifications WHERE read = 0 GROUP BY kind",
			)
			.all();
		const out: Record<string, number> = {};
		for (const r of rows) out[r.kind] = r.n;
		return out;
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
