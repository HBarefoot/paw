import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createActionTools } from "../../src/tools/action-tools.js";

function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
    CREATE TABLE canvas_actions (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      type TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
      field_map_json TEXT NOT NULL DEFAULT '{}', redirect_url TEXT,
      honeypot_field TEXT, secret TEXT, active INTEGER NOT NULL DEFAULT 1,
      submit_count INTEGER NOT NULL DEFAULT 0, created_by TEXT,
      require_auth INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
	return db;
}

describe("canvas action tools", () => {
	let db: Database;
	let tools: ReturnType<typeof createActionTools>;
	const get = (n: string) => tools.find((t) => t.name === n)!;

	beforeEach(() => {
		db = freshDb();
		tools = createActionTools({ database: db });
	});

	test("create returns a submitUrl and persists the binding", async () => {
		const res = await get("canvas_action_create").handler({
			name: "Leads",
			type: "strapi",
			config: { contentType: "leads" },
			fieldMap: { email: "email", name: "name" },
		});
		expect(res.is_error).toBeUndefined();
		const out = JSON.parse(res.content);
		expect(out.submitUrl).toBe(`/api/forms/${out.actionId}`);
		expect(out.embedHint).toContain('name="email"');
		const row = db
			.query("SELECT type, field_map_json FROM canvas_actions WHERE id = ?")
			.get(out.actionId) as { type: string; field_map_json: string };
		expect(row.type).toBe("strapi");
		expect(JSON.parse(row.field_map_json).email).toBe("email");
	});

	test("strapi binding requires a contentType", async () => {
		const res = await get("canvas_action_create").handler({
			name: "x",
			type: "strapi",
			fieldMap: { a: "a" },
		});
		expect(res.is_error).toBe(true);
	});

	test("rejects unknown type and empty fieldMap", async () => {
		const bad = await get("canvas_action_create").handler({
			name: "x",
			type: "salesforce",
			fieldMap: { a: "a" },
		});
		expect(bad.is_error).toBe(true);
		const empty = await get("canvas_action_create").handler({
			name: "x",
			type: "hubspot",
			fieldMap: {},
		});
		expect(empty.is_error).toBe(true);
	});

	test("tool action requires config.tool and defaults to require_auth", async () => {
		const missing = await get("canvas_action_create").handler({
			name: "x",
			type: "tool",
			fieldMap: { a: "a" },
		});
		expect(missing.is_error).toBe(true);

		const res = await get("canvas_action_create").handler({
			name: "Create job",
			type: "tool",
			config: { tool: "job_create" },
			fieldMap: { title: "title" },
		});
		expect(res.is_error).toBeUndefined();
		const out = JSON.parse(res.content);
		const row = db
			.query("SELECT type, config_json, require_auth FROM canvas_actions WHERE id = ?")
			.get(out.actionId) as {
			type: string;
			config_json: string;
			require_auth: number;
		};
		expect(row.type).toBe("tool");
		expect(JSON.parse(row.config_json).tool).toBe("job_create");
		// tool actions are authed by default
		expect(row.require_auth).toBe(1);
	});

	test("strapi/hubspot default to public; requireAuth override honored", async () => {
		const hs = JSON.parse(
			(
				await get("canvas_action_create").handler({
					name: "HS",
					type: "hubspot",
					fieldMap: { email: "email" },
				})
			).content,
		);
		const hsRow = db
			.query("SELECT require_auth FROM canvas_actions WHERE id = ?")
			.get(hs.actionId) as { require_auth: number };
		expect(hsRow.require_auth).toBe(0);

		// explicitly make a tool action public
		const pub = JSON.parse(
			(
				await get("canvas_action_create").handler({
					name: "newsletter",
					type: "tool",
					config: { tool: "subscribe" },
					fieldMap: { email: "email" },
					requireAuth: false,
				})
			).content,
		);
		const pubRow = db
			.query("SELECT require_auth FROM canvas_actions WHERE id = ?")
			.get(pub.actionId) as { require_auth: number };
		expect(pubRow.require_auth).toBe(0);
	});

	test("list then delete", async () => {
		const created = JSON.parse(
			(
				await get("canvas_action_create").handler({
					name: "HS",
					type: "hubspot",
					fieldMap: { email: "email" },
				})
			).content,
		);
		const listed = JSON.parse((await get("canvas_action_list").handler({})).content);
		expect(listed.length).toBe(1);
		expect(listed[0].actionId).toBe(created.actionId);

		const del = JSON.parse(
			(
				await get("canvas_action_delete").handler({
					actionId: created.actionId,
				})
			).content,
		);
		expect(del.deleted).toBe(true);
		const after = JSON.parse((await get("canvas_action_list").handler({})).content);
		expect(after.length).toBe(0);
	});
});
