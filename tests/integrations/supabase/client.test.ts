import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SkillManager } from "../../../src/ai/skills.js";
import { ToolRegistry } from "../../../src/ai/tools.js";
import { SupabaseClient } from "../../../src/integrations/supabase/client.js";
import { createSupabaseTools } from "../../../src/integrations/supabase/tools.js";
import { SupabaseError } from "../../../src/integrations/supabase/types.js";

const BASE_URL = "https://proj.supabase.co";
const KEY = "service-role-key";

interface Captured {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}

let calls: Captured[];
let originalFetch: typeof globalThis.fetch;

function mockFetch(status: number, payload: unknown) {
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		calls.push({
			url,
			method: init?.method,
			headers: init?.headers as Record<string, string> | undefined,
			body: init?.body as string | undefined,
		});
		return new Response(
			typeof payload === "string" ? payload : JSON.stringify(payload),
			{
				status,
				headers: { "Content-Type": "application/json" },
			},
		);
	}) as typeof globalThis.fetch;
}

beforeEach(() => {
	calls = [];
	originalFetch = globalThis.fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function makeClient() {
	return new SupabaseClient({ url: BASE_URL, serviceKey: KEY });
}

// Profile-aware mock: PostgREST returns a different OpenAPI doc per schema,
// selected by the `Accept-Profile` header (default `public`). Lets us exercise
// the multi-schema listTables merge.
function mockFetchByProfile(
	byProfile: Record<string, unknown>,
	statusByProfile: Record<string, number> = {},
) {
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const headers = init?.headers as Record<string, string> | undefined;
		const profile = headers?.["Accept-Profile"] ?? "public";
		calls.push({
			url,
			method: init?.method,
			headers,
			body: init?.body as string,
		});
		const status = statusByProfile[profile] ?? 200;
		const payload =
			profile in byProfile ? byProfile[profile] : { definitions: {} };
		return new Response(JSON.stringify(payload), {
			status,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof globalThis.fetch;
}

describe("SupabaseClient", () => {
	test("select encodes columns, filters, and auth headers", async () => {
		mockFetch(200, [{ id: 1, name: "Ada" }]);
		const rows = await makeClient().select("users", {
			columns: ["id", "name"],
			filters: [
				{ column: "status", op: "eq", value: "active" },
				{ column: "id", op: "in", value: [1, 2, 3] },
			],
			limit: 10,
		});
		expect(rows).toEqual([{ id: 1, name: "Ada" }]);
		const c = calls[0];
		expect(c.url).toBe(
			`${BASE_URL}/rest/v1/users?select=id,name&status=eq.active&id=in.(1,2,3)&limit=10`,
		);
		expect(c.method).toBe("GET");
		expect(c.headers?.apikey).toBe(KEY);
		expect(c.headers?.Authorization).toBe(`Bearer ${KEY}`);
	});

	test("select defaults to all columns", async () => {
		mockFetch(200, []);
		await makeClient().select("users");
		expect(calls[0].url).toBe(`${BASE_URL}/rest/v1/users?select=*`);
	});

	test("insert posts rows with return=representation", async () => {
		mockFetch(201, [{ id: 9 }]);
		const rows = await makeClient().insert("users", [{ name: "Grace" }]);
		expect(rows).toEqual([{ id: 9 }]);
		expect(calls[0].method).toBe("POST");
		expect((calls[0].headers as Record<string, string>).Prefer).toBe(
			"return=representation",
		);
		expect(JSON.parse(calls[0].body ?? "")).toEqual([{ name: "Grace" }]);
	});

	test("update sends PATCH with the filter in the query", async () => {
		mockFetch(200, [{ id: 1, name: "X" }]);
		await makeClient().update("users", [{ column: "id", op: "eq", value: 1 }], {
			name: "X",
		});
		expect(calls[0].method).toBe("PATCH");
		expect(calls[0].url).toBe(`${BASE_URL}/rest/v1/users?id=eq.1`);
	});

	test("delete sends DELETE with the filter in the query", async () => {
		mockFetch(200, []);
		await makeClient().delete("users", [
			{ column: "email", op: "eq", value: "a@b.c" },
		]);
		expect(calls[0].method).toBe("DELETE");
		expect(calls[0].url).toBe(`${BASE_URL}/rest/v1/users?email=eq.a%40b.c`);
	});

	test("rpc posts to /rpc/<fn>", async () => {
		mockFetch(200, { ok: true });
		const res = await makeClient().rpc("do_thing", { x: 1 });
		expect(res).toEqual({ ok: true });
		expect(calls[0].url).toBe(`${BASE_URL}/rest/v1/rpc/do_thing`);
		expect(calls[0].method).toBe("POST");
	});

	test("non-2xx throws a typed SupabaseError", async () => {
		mockFetch(401, { message: "Invalid API key" });
		await expect(makeClient().select("users")).rejects.toBeInstanceOf(
			SupabaseError,
		);
	});

	test("update refuses empty filters without hitting the network", async () => {
		mockFetch(200, []);
		await expect(
			makeClient().update("users", [], { name: "x" }),
		).rejects.toThrow(/requires at least one filter/);
		expect(calls.length).toBe(0);
	});

	test("delete refuses empty filters without hitting the network", async () => {
		mockFetch(200, []);
		await expect(makeClient().delete("users", [])).rejects.toThrow(
			/requires at least one filter/,
		);
		expect(calls.length).toBe(0);
	});

	test("constructor refuses missing service key", () => {
		expect(
			() => new SupabaseClient({ url: BASE_URL, serviceKey: "" }),
		).toThrow();
	});

	test("information_schema access stays blocked (dotted identifier)", async () => {
		mockFetch(200, []);
		await expect(
			makeClient().select("information_schema.tables"),
		).rejects.toThrow(/Invalid Supabase table/);
		expect(calls.length).toBe(0); // rejected before any request
	});
});

describe("supabase introspection (list_tables)", () => {
	test("parses tables + columns from the swagger `definitions`", async () => {
		mockFetch(200, {
			definitions: {
				users: {
					properties: {
						id: { type: "integer", format: "bigint" },
						email: { type: "string", format: "text" },
					},
				},
				orders: { properties: { id: { type: "integer", format: "bigint" } } },
			},
		});
		const res = await makeClient().listTables(["public"]);
		expect(calls[0].url).toBe(`${BASE_URL}/rest/v1/`);
		expect(res.tables.map((t) => t.name).sort()).toEqual(["orders", "users"]);
		const users = res.tables.find((t) => t.name === "users");
		expect(users?.schema).toBe("public");
		expect(users?.columns).toEqual([
			{ name: "id", type: "bigint" },
			{ name: "email", type: "text" },
		]);
	});

	test("also reads OpenAPI 3 `components.schemas`", async () => {
		mockFetch(200, {
			components: {
				schemas: { widgets: { properties: { sku: { type: "string" } } } },
			},
		});
		const res = await makeClient().listTables(["public"]);
		expect(res.tables[0].name).toBe("widgets");
		expect(res.tables[0].columns[0]).toEqual({ name: "sku", type: "string" });
	});

	test("merges public + canvas, tagging each table with its schema", async () => {
		mockFetchByProfile({
			public: { definitions: { users: { properties: { id: {} } } } },
			canvas: {
				definitions: { waitlist_signups: { properties: { email: {} } } },
			},
		});
		const res = await makeClient().listTables();
		// Two fetches: default (public) + Accept-Profile: canvas.
		expect(calls).toHaveLength(2);
		expect(calls[1].headers?.["Accept-Profile"]).toBe("canvas");
		const bySchema = Object.fromEntries(
			res.tables.map((t) => [t.name, t.schema]),
		);
		expect(bySchema).toEqual({ users: "public", waitlist_signups: "canvas" });
	});

	test("a schema that isn't exposed (406) is skipped, not fatal", async () => {
		mockFetchByProfile(
			{ public: { definitions: { users: { properties: { id: {} } } } } },
			{ canvas: 406 },
		);
		const res = await makeClient().listTables();
		expect(res.tables.map((t) => t.name)).toEqual(["users"]);
	});

	test("empty schema → no tables (the fresh-project case)", async () => {
		mockFetch(200, { swagger: "2.0", definitions: {} });
		const res = await makeClient().listTables();
		expect(res.tables).toEqual([]);

		// ...and the tool surfaces it cleanly
		const tool = createSupabaseTools(makeClient()).find(
			(t) => t.name === "supabase_list_tables",
		);
		mockFetch(200, { definitions: {} });
		const out = await tool?.handler({});
		expect(out?.is_error).toBeFalsy();
		expect(JSON.parse(out?.content ?? "{}").note).toMatch(/No tables/i);
	});

	test("supabase_select on an unknown table hints at list_tables (PGRST205)", async () => {
		const tool = createSupabaseTools(makeClient()).find(
			(t) => t.name === "supabase_select",
		);
		mockFetch(404, {
			code: "PGRST205",
			message: "Could not find the table 'public.nope' in the schema cache",
		});
		const out = await tool?.handler({ table: "nope" });
		expect(out?.is_error).toBe(true);
		expect(out?.content).toMatch(/supabase_list_tables/);
	});
});

describe("supabase skill registration", () => {
	test("supabase tools form a single on-demand skill", () => {
		const registry = new ToolRegistry();
		registry.register(createSupabaseTools(makeClient()));
		const skills = new SkillManager();
		skills.buildFromRegistry(registry);
		const skill = skills.getSkill("supabase");
		expect(skill).toBeDefined();
		expect(skill?.alwaysActive).toBe(false);
		expect(skill?.toolNames.sort()).toEqual([
			"supabase_delete",
			"supabase_insert",
			"supabase_list_tables",
			"supabase_rpc",
			"supabase_select",
			"supabase_update",
		]);
	});

	test("config absent → no supabase skill, zero behavior change", () => {
		const registry = new ToolRegistry();
		const skills = new SkillManager();
		skills.buildFromRegistry(registry);
		expect(skills.getSkill("supabase")).toBeUndefined();
	});
});
