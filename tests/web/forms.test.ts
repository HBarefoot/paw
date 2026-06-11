import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Context } from "hono";
import { createFormReceiver } from "../../src/web/routes/forms.js";
import type { ToolResult } from "../../src/types/message.js";

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

function insertAction(db: Database, row: Record<string, unknown>): string {
	const id = row.id ? String(row.id) : "act1";
	db.run(
		`INSERT INTO canvas_actions
       (id, name, type, config_json, field_map_json, redirect_url, honeypot_field, secret, require_auth, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			"Test",
			String(row.type ?? "tool"),
			JSON.stringify(row.config ?? {}),
			JSON.stringify(row.fieldMap ?? {}),
			(row.redirectUrl as string) ?? null,
			(row.honeypot as string) ?? null,
			(row.secret as string) ?? null,
			row.requireAuth ? 1 : 0,
			row.active === false ? 0 : 1,
		],
	);
	return id;
}

interface Harness {
	db: Database;
	app: ReturnType<typeof createFormReceiver>;
	toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
}

function makeApp(opts?: {
	authed?: boolean;
	toolResult?: ToolResult;
	strapi?: boolean;
	hubspot?: boolean;
}): Harness {
	const db = freshDb();
	const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
	const app = createFormReceiver({
		db,
		toolRegistry: {
			async execute(name, input) {
				toolCalls.push({ name, input });
				return opts?.toolResult ?? { content: '{"ok":true}' };
			},
		},
		strapi: opts?.strapi
			? { async create() { return { data: { id: 7 } }; } }
			: null,
		hubspotClient: opts?.hubspot
			? { async createContact() { return { id: "hs9" }; } }
			: null,
		isAuthenticated: () => opts?.authed === true,
		getClientIp: (_c: Context) => "1.2.3.4",
	});
	return { db, app, toolCalls };
}

async function post(
	app: Harness["app"],
	id: string,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	const isForm = headers["Content-Type"]?.includes("urlencoded");
	return app.request(`/api/forms/${id}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: isForm
			? new URLSearchParams(body as Record<string, string>).toString()
			: JSON.stringify(body),
	});
}

describe("form receiver", () => {
	test("unknown / inactive action → 404", async () => {
		const h = makeApp();
		expect((await post(h.app, "nope", {})).status).toBe(404);
		insertAction(h.db, { id: "inact", active: false });
		expect((await post(h.app, "inact", {})).status).toBe(404);
	});

	test("require_auth: anonymous → 401, authenticated → tool runs", async () => {
		const anon = makeApp({ authed: false });
		insertAction(anon.db, {
			type: "tool",
			config: { tool: "job_create" },
			fieldMap: { title: "title" },
			requireAuth: true,
		});
		const r401 = await post(anon.app, "act1", { title: "Roof job" });
		expect(r401.status).toBe(401);
		expect(anon.toolCalls.length).toBe(0);

		const ok = makeApp({ authed: true });
		insertAction(ok.db, {
			type: "tool",
			config: { tool: "job_create" },
			fieldMap: { title: "title" },
			requireAuth: true,
		});
		const r = await post(ok.app, "act1", { title: "Roof job" });
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ ok: true, status: "routed" });
		expect(ok.toolCalls).toEqual([
			{ name: "job_create", input: { title: "Roof job" } },
		]);
	});

	test("tool action invokes only its bound tool; denied tool → failed", async () => {
		// Sandbox-denied tool: execute returns is_error → submission marked failed,
		// and ONLY the action's config.tool is ever called (never a client value).
		const h = makeApp({
			toolResult: { content: "Permission denied: kernel cannot use evil", is_error: true },
		});
		insertAction(h.db, {
			type: "tool",
			config: { tool: "job_create" },
			fieldMap: { title: "title" },
		});
		const r = await post(h.app, "act1", { title: "x", tool: "evil_tool" });
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ ok: false, status: "failed" });
		expect(h.toolCalls.map((c) => c.name)).toEqual(["job_create"]); // not "evil_tool"
		const row = h.db
			.query("SELECT status, target_ref FROM canvas_submissions")
			.get() as { status: string; target_ref: string };
		expect(row.status).toBe("failed");
		expect(row.target_ref).toContain("Permission denied");
	});

	test("tool action missing config.tool → failed", async () => {
		const h = makeApp();
		insertAction(h.db, { type: "tool", config: {}, fieldMap: { a: "a" } });
		const r = await post(h.app, "act1", { a: "1" });
		expect(await r.json()).toMatchObject({ status: "failed" });
		expect(h.toolCalls.length).toBe(0);
	});

	test("field allowlist: drop unmapped, rename mapped, 5000-char truncate", async () => {
		const h = makeApp();
		insertAction(h.db, {
			type: "tool",
			config: { tool: "t" },
			fieldMap: { email: "contact_email", note: "body" },
		});
		const big = "y".repeat(6000);
		await post(h.app, "act1", {
			email: "a@b.com",
			note: big,
			secretField: "should-drop",
		});
		expect(h.toolCalls.length).toBe(1);
		const input = h.toolCalls[0].input;
		expect(input.contact_email).toBe("a@b.com"); // renamed
		expect((input.body as string).length).toBe(5000); // truncated
		expect("secretField" in input).toBe(false); // unmapped dropped
		expect("email" in input).toBe(false); // original key not forwarded
	});

	test("honeypot filled → 200 {ok:true}, nothing stored or routed", async () => {
		const h = makeApp();
		insertAction(h.db, {
			type: "tool",
			config: { tool: "t" },
			fieldMap: { name: "name" },
			honeypot: "website",
		});
		const r = await post(h.app, "act1", { name: "x", website: "bot" });
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ ok: true });
		expect(h.toolCalls.length).toBe(0);
		const count = h.db
			.query("SELECT COUNT(*) AS n FROM canvas_submissions")
			.get() as { n: number };
		expect(count.n).toBe(0);
	});

	test("wrong shared secret → 403", async () => {
		const h = makeApp();
		insertAction(h.db, {
			type: "tool",
			config: { tool: "t" },
			fieldMap: { a: "a" },
			secret: "s3cret",
		});
		expect((await post(h.app, "act1", { a: "1" })).status).toBe(403);
		const ok = await post(h.app, "act1", { a: "1" }, { "X-Paw-Form-Secret": "s3cret" });
		expect(ok.status).toBe(200);
	});

	test("per-IP rate limit → 429 after 20/min", async () => {
		const h = makeApp();
		insertAction(h.db, { type: "tool", config: { tool: "t" }, fieldMap: { a: "a" } });
		let got429 = false;
		let early200 = 0;
		for (let i = 0; i < 25; i++) {
			const r = await post(h.app, "act1", { a: String(i) });
			if (r.status === 429) got429 = true;
			else if (i < 20) early200++;
		}
		expect(early200).toBe(20); // first 20 allowed
		expect(got429).toBe(true); // then throttled
	});

	test("durable inbox: row before routing; success → routed", async () => {
		const h = makeApp({ strapi: true });
		insertAction(h.db, {
			type: "strapi",
			config: { contentType: "leads" },
			fieldMap: { email: "email" },
		});
		const r = await post(h.app, "act1", { email: "a@b.com" });
		expect(await r.json()).toMatchObject({ ok: true, status: "routed" });
		const row = h.db
			.query("SELECT status, target_ref, data_json FROM canvas_submissions")
			.get() as { status: string; target_ref: string; data_json: string };
		expect(row.status).toBe("routed");
		expect(row.target_ref).toContain("strapi:");
		expect(JSON.parse(row.data_json).email).toBe("a@b.com");
	});

	test("routing failure → status failed with error in target_ref", async () => {
		// strapi action but no strapi client configured → throws → failed
		const h = makeApp({ strapi: false });
		insertAction(h.db, {
			type: "strapi",
			config: { contentType: "leads" },
			fieldMap: { email: "email" },
		});
		const r = await post(h.app, "act1", { email: "a@b.com" });
		expect(await r.json()).toMatchObject({ ok: false, status: "failed" });
		const row = h.db
			.query("SELECT status, target_ref FROM canvas_submissions")
			.get() as { status: string; target_ref: string };
		expect(row.status).toBe("failed");
		expect(row.target_ref).toContain("Strapi not configured");
	});

	test("form-encoded body parses like JSON", async () => {
		const h = makeApp();
		insertAction(h.db, {
			type: "tool",
			config: { tool: "t" },
			fieldMap: { name: "name" },
		});
		await post(
			h.app,
			"act1",
			{ name: "Form Encoded" },
			{ "Content-Type": "application/x-www-form-urlencoded" },
		);
		expect(h.toolCalls[0].input).toEqual({ name: "Form Encoded" });
	});

	test("redirect_url on success → 303", async () => {
		const h = makeApp();
		insertAction(h.db, {
			type: "tool",
			config: { tool: "t" },
			fieldMap: { a: "a" },
			redirectUrl: "/thanks",
		});
		const r = await post(h.app, "act1", { a: "1" });
		expect(r.status).toBe(303);
		expect(r.headers.get("location")).toBe("/thanks");
	});
});
