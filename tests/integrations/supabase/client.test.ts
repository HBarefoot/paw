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
