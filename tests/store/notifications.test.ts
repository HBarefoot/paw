import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { NotificationStore } from "../../src/store/notifications.js";

function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE notifications (
			id TEXT PRIMARY KEY,
			kind TEXT NOT NULL DEFAULT 'system',
			title TEXT NOT NULL,
			body TEXT,
			url TEXT,
			level TEXT NOT NULL DEFAULT 'info',
			read INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);
	return db;
}

describe("NotificationStore.unreadCountByKind", () => {
	test("groups unread counts by kind and excludes read ones", () => {
		const store = new NotificationStore(freshDb());
		store.add({ kind: "github", title: "PR opened" });
		store.add({ kind: "github", title: "PR merged" });
		store.add({ kind: "slack", title: "DM" });
		const read = store.add({ kind: "slack", title: "old" });
		store.markRead(read);

		const byKind = store.unreadCountByKind();
		expect(byKind.github).toBe(2);
		expect(byKind.slack).toBe(1);
		// the read slack notification is not counted
		expect(Object.values(byKind).reduce((a, b) => a + b, 0)).toBe(3);
	});

	test("empty when nothing unread", () => {
		const store = new NotificationStore(freshDb());
		const id = store.add({ kind: "github", title: "x" });
		store.markRead(id);
		expect(store.unreadCountByKind()).toEqual({});
	});
});
