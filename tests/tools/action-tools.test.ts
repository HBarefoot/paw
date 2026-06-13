import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
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
    CREATE TABLE canvas_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action_id TEXT NOT NULL,
      data_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received',
      target_ref TEXT, ip TEXT, user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
	return db;
}

/** Fake Supabase introspector: reports the given tables as living in `canvas`. */
function fakeSupabase(canvasTables: string[]) {
	return {
		async listTables() {
			return {
				tables: canvasTables.map((name) => ({ schema: "canvas", name })),
			};
		},
	};
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
			.query(
				"SELECT type, config_json, require_auth FROM canvas_actions WHERE id = ?",
			)
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

	test("supabase binding requires config.table", async () => {
		const t = createActionTools({
			database: db,
			getSupabase: () => fakeSupabase(["leads"]),
		});
		const res = await t
			.find((x) => x.name === "canvas_action_create")!
			.handler({ name: "x", type: "supabase", fieldMap: { email: "email" } });
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("config.table");
	});

	test("supabase binding rejected when integration disabled", async () => {
		// No getSupabase → integration off → cannot wire a Supabase table.
		const res = await get("canvas_action_create").handler({
			name: "x",
			type: "supabase",
			config: { table: "leads" },
			fieldMap: { email: "email" },
		});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("not enabled");
	});

	test("supabase binding rejected when table not in canvas yard", async () => {
		const t = createActionTools({
			database: db,
			getSupabase: () => fakeSupabase(["other_table"]),
		});
		const res = await t
			.find((x) => x.name === "canvas_action_create")!
			.handler({
				name: "x",
				type: "supabase",
				config: { table: "leads" },
				fieldMap: { email: "email" },
			});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("not in the canvas schema");
	});

	test("supabase binding persists when the table exists in canvas", async () => {
		const t = createActionTools({
			database: db,
			getSupabase: () => fakeSupabase(["leads"]),
		});
		const res = await t
			.find((x) => x.name === "canvas_action_create")!
			.handler({
				name: "Leads",
				type: "supabase",
				config: { table: "leads" },
				fieldMap: { email: "email" },
			});
		expect(res.is_error).toBeUndefined();
		const out = JSON.parse(res.content);
		const row = db
			.query(
				"SELECT type, config_json, require_auth FROM canvas_actions WHERE id = ?",
			)
			.get(out.actionId) as {
			type: string;
			config_json: string;
			require_auth: number;
		};
		expect(row.type).toBe("supabase");
		expect(JSON.parse(row.config_json).table).toBe("leads");
		// supabase lead capture is public by default (like strapi/hubspot).
		expect(row.require_auth).toBe(0);
	});

	test("canvas_submissions_list returns rows, filters, sanitizes, caps limit", async () => {
		db.run(
			"INSERT INTO canvas_actions (id, name, type) VALUES ('a1','Leads','supabase')",
		);
		db.run(
			"INSERT INTO canvas_submissions (action_id, data_json, status, target_ref) VALUES (?,?,?,?)",
			[
				"a1",
				JSON.stringify({ email: "a@b.com" }),
				"routed",
				"supabase:leads:1",
			],
		);
		// A failed row carrying angle brackets in the error — must be sanitized.
		db.run(
			"INSERT INTO canvas_submissions (action_id, data_json, status, target_ref) VALUES (?,?,?,?)",
			[
				"a1",
				JSON.stringify({ note: "<script>x</script>" }),
				"failed",
				"<oops>",
			],
		);
		const list = get("canvas_submissions_list");

		const all = JSON.parse((await list.handler({})).content).submissions;
		expect(all.length).toBe(2);
		// joined action name present
		expect(all[0].action).toBe("Leads");

		const failed = JSON.parse(
			(await list.handler({ status: "failed" })).content,
		).submissions;
		expect(failed.length).toBe(1);
		expect(failed[0].status).toBe("failed");
		// sanitizePromptText escapes < > so no raw markup re-enters the model context
		expect(failed[0].targetRef).not.toContain("<");
		expect(JSON.stringify(failed[0].data)).not.toContain("<script>");

		const byAction = JSON.parse(
			(await list.handler({ actionId: "a1" })).content,
		).submissions;
		expect(byAction.length).toBe(2);

		const none = JSON.parse(
			(await list.handler({ actionId: "missing" })).content,
		).submissions;
		expect(none.length).toBe(0);

		const capped = JSON.parse(
			(await list.handler({ limit: 9999 })).content,
		).submissions;
		expect(capped.length).toBe(2); // cap doesn't error; just bounds the query
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
		const listed = JSON.parse(
			(await get("canvas_action_list").handler({})).content,
		);
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
		const after = JSON.parse(
			(await get("canvas_action_list").handler({})).content,
		);
		expect(after.length).toBe(0);
	});
});
