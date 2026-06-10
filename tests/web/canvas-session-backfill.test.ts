import { describe, test, expect, afterAll } from "bun:test";
import { unlinkSync, existsSync } from "node:fs";
import { getDb, closeDb } from "../../src/store/db.js";
import { listRecentSessionsForUser } from "../../src/store/sessions.js";

const TEST_DB = "/tmp/paw-canvas-backfill.db";

describe("Canvas session backfill (per-admin scoping fix)", () => {
	afterAll(() => {
		closeDb();
		for (const s of ["", "-journal", "-wal", "-shm"]) {
			try {
				unlinkSync(TEST_DB + s);
			} catch {}
		}
	});

	test("canvas-user sessions get reparented to web-{adminId} on migration", () => {
		try {
			unlinkSync(TEST_DB);
		} catch {}
		for (const s of ["-wal", "-shm"]) {
			try {
				unlinkSync(TEST_DB + s);
			} catch {}
		}

		// Pre-create the schema with the OLD shape (no admin yet)
		const seed = getDb(TEST_DB);
		// We need to first set up the web_admins table and a canvas session
		// with user_id="canvas-user", then run the migration.
		seed.run(
			"INSERT INTO web_admins (id, username, password_hash) VALUES (1, 'alice', 'x')",
		);
		seed.run(
			"INSERT INTO sessions (id, channel, user_id) VALUES ('s1', 'canvas', 'canvas-user')",
		);
		seed.run(
			"INSERT INTO sessions (id, channel, user_id) VALUES ('s2', 'canvas', 'canvas-user')",
		);
		seed.run(
			"INSERT INTO sessions (id, channel, user_id) VALUES ('s3', 'cron', 'system')",
		);
		closeDb();

		// Open again, which runs the migration in getDb() -> runMigrations().
		const db = getDb(TEST_DB);

		// After backfill, the canvas-user rows should now be web-1.
		const canvasRows = db
			.query<{ user_id: string }, []>(
				"SELECT user_id FROM sessions WHERE channel = 'canvas'",
			)
			.all();
		for (const r of canvasRows) {
			expect(r.user_id).toBe("web-1");
		}

		// cron/heartbeat sessions stay scoped to "system"
		const cronRows = db
			.query<{ user_id: string }, []>(
				"SELECT user_id FROM sessions WHERE channel = 'cron'",
			)
			.all();
		for (const r of cronRows) {
			expect(r.user_id).toBe("system");
		}

		// Per-admin list should now include the canvas sessions.
		const aliceSessions = listRecentSessionsForUser(db, "web-1");
		const canvasIds = aliceSessions
			.filter((s) => s.channel === "canvas")
			.map((s) => s.id);
		expect(canvasIds).toContain("s1");
		expect(canvasIds).toContain("s2");
	});
});
