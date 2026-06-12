import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ToolRegistry } from "../../src/ai/tools.js";
import { Sandbox } from "../../src/kernel/sandbox.js";
import { N8nClient, resolveN8nConfig } from "./client.js";
import { createTools } from "./tools.js";

const BASE = "https://n8n.example.com";
const TOKEN = "n8n-key";

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
	originalFetch = globalThis.fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

// Route mock by URL substring. Each route: { match, status?, body }.
function mockRoutes(
	routes: Array<{ match: string; status?: number; body: unknown }>,
) {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const r = routes.find((x) => url.includes(x.match));
		if (!r) return new Response("not mocked", { status: 500 });
		return new Response(
			typeof r.body === "string" ? r.body : JSON.stringify(r.body),
			{
				status: r.status ?? 200,
				headers: { "Content-Type": "application/json" },
			},
		);
	}) as typeof globalThis.fetch;
}

const client = () => new N8nClient({ baseUrl: BASE, token: TOKEN });
const tool = (name: string, c: N8nClient | null = client()) => {
	const t = createTools(c).find((x) => x.name === name);
	if (!t) throw new Error(`tool ${name} not found`);
	return t;
};
const recent = (hoursAgo: number) =>
	new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

describe("resolveN8nConfig", () => {
	test("uses the plugin's own config block", () => {
		const conn = resolveN8nConfig({ baseUrl: BASE, token: TOKEN }, {});
		expect(conn).toEqual({ baseUrl: BASE, token: TOKEN, timeout: undefined });
	});
	test("falls back to PAW_N8N env", () => {
		const conn = resolveN8nConfig(
			{},
			{ PAW_N8N_TOKEN: TOKEN, PAW_N8N_BASE_URL: BASE },
		);
		expect(conn?.baseUrl).toBe(BASE);
		expect(conn?.token).toBe(TOKEN);
	});
	test("derives base URL from the first PAW_N8N_ENDPOINTS origin", () => {
		const conn = resolveN8nConfig(
			{},
			{
				PAW_N8N_TOKEN: TOKEN,
				PAW_N8N_ENDPOINTS:
					'[{"name":"a","url":"https://n8n.example.com/mcp/x"}]',
			},
		);
		expect(conn?.baseUrl).toBe(BASE);
	});
	test("unresolved vault:// token + no env → null", () => {
		expect(
			resolveN8nConfig({ baseUrl: BASE, token: "vault://n8n.token" }, {}),
		).toBeNull();
	});
	test("nothing configured → null", () => {
		expect(resolveN8nConfig(undefined, {})).toBeNull();
	});
});

describe("tools when n8n is not configured", () => {
	test("every tool returns a clean 'not configured' error (no throw)", async () => {
		for (const name of [
			"probe_workflow",
			"list_inactive_workflows",
			"recent_failures",
		]) {
			const res = await tool(name, null).handler({ workflow_id: "1" });
			expect(res.is_error).toBe(true);
			expect(res.content).toMatch(/not configured/i);
		}
	});
});

describe("probe_workflow", () => {
	test("healthy: active + all recent runs succeeded", async () => {
		mockRoutes([
			{
				match: "/workflows/7",
				body: { id: "7", name: "Nightly", active: true },
			},
			{
				match: "/executions",
				body: {
					data: [
						{
							id: "e2",
							workflowId: "7",
							status: "success",
							startedAt: recent(1),
						},
						{
							id: "e1",
							workflowId: "7",
							status: "success",
							startedAt: recent(2),
						},
					],
				},
			},
		]);
		const res = await tool("probe_workflow").handler({ workflow_id: "7" });
		const out = JSON.parse(res.content);
		expect(out.active).toBe(true);
		expect(out.total).toBe(2);
		expect(out.failures).toBe(0);
		expect(out.verdict).toMatch(/healthy/);
	});

	test("unhealthy: majority of recent runs failed", async () => {
		mockRoutes([
			{ match: "/workflows/9", body: { id: "9", name: "Sync", active: true } },
			{
				match: "/executions",
				body: {
					data: [
						{
							id: "e3",
							workflowId: "9",
							status: "error",
							startedAt: recent(1),
						},
						{
							id: "e2",
							workflowId: "9",
							status: "error",
							startedAt: recent(2),
						},
						{
							id: "e1",
							workflowId: "9",
							status: "success",
							startedAt: recent(3),
						},
					],
				},
			},
		]);
		const out = JSON.parse(
			(await tool("probe_workflow").handler({ workflow_id: "9" })).content,
		);
		expect(out.failures).toBe(2);
		expect(out.verdict).toMatch(/unhealthy/);
	});

	test("API error → clean is_error result", async () => {
		mockRoutes([{ match: "/workflows/1", status: 401, body: "unauthorized" }]);
		const res = await tool("probe_workflow").handler({ workflow_id: "1" });
		expect(res.is_error).toBe(true);
		expect(res.content).toMatch(/n8n error/);
	});
});

describe("list_inactive_workflows", () => {
	test("flags disabled + stale workflows; omits the active recent one", async () => {
		mockRoutes([
			{
				match: "/workflows",
				body: {
					data: [
						{ id: "a", name: "Active recent", active: true },
						{ id: "b", name: "Disabled", active: false },
						{ id: "c", name: "Stale", active: true },
					],
				},
			},
			{
				match: "/executions",
				body: {
					data: [
						{
							id: "x",
							workflowId: "a",
							status: "success",
							startedAt: recent(2),
						},
						{
							id: "y",
							workflowId: "c",
							status: "success",
							startedAt: recent(400),
						},
					],
				},
			},
		]);
		const out = JSON.parse(
			(await tool("list_inactive_workflows").handler({ window_hours: 168 }))
				.content,
		);
		const ids = out.inactive.map((w: { id: string }) => w.id).sort();
		expect(ids).toEqual(["b", "c"]);
		const b = out.inactive.find((w: { id: string }) => w.id === "b");
		expect(b.reason).toBe("disabled");
	});

	test("empty project → empty inactive list", async () => {
		mockRoutes([
			{ match: "/workflows", body: { data: [] } },
			{ match: "/executions", body: { data: [] } },
		]);
		const out = JSON.parse(
			(await tool("list_inactive_workflows").handler({})).content,
		);
		expect(out.inactive).toEqual([]);
	});
});

describe("recent_failures", () => {
	test("returns failing node + error excerpt, with workflow name", async () => {
		mockRoutes([
			{
				match: "/executions",
				body: {
					data: [
						{
							id: "ex1",
							workflowId: "7",
							status: "error",
							startedAt: recent(1),
							data: {
								resultData: {
									lastNodeExecuted: "HTTP Request",
									error: {
										message: "ETIMEDOUT",
										node: { name: "HTTP Request" },
									},
								},
							},
						},
					],
				},
			},
			{
				match: "/workflows",
				body: { data: [{ id: "7", name: "Nightly", active: true }] },
			},
		]);
		const out = JSON.parse(
			(await tool("recent_failures").handler({ limit: 5 })).content,
		);
		expect(out.failures).toHaveLength(1);
		expect(out.failures[0].failedNode).toBe("HTTP Request");
		expect(out.failures[0].error).toBe("ETIMEDOUT");
		expect(out.failures[0].workflowName).toBe("Nightly");
	});
});

describe("sandbox permission + registry", () => {
	test("manifest grants the permission the sandbox checks for these tools", async () => {
		const manifest = JSON.parse(
			readFileSync(join(import.meta.dir, "manifest.json"), "utf-8"),
		);
		expect(manifest.permissions).toEqual(["n8n-health-probe"]);

		// Exercise the real execute() → inferPermission() → checkPermission() path:
		// with the manifest's grant, the tool is NOT permission-denied (it reaches
		// the handler, which returns "not configured" for a null client).
		const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
		const sandbox = new Sandbox(noopLogger);
		sandbox.registerManifest({
			name: "n8n-health-probe",
			version: "0.1.0",
			description: "test",
			permissions: manifest.permissions,
		});
		const registry = new ToolRegistry();
		registry.setSandbox(sandbox, true);
		registry.register(createTools(null));
		const res = await registry.execute("list_inactive_workflows", {});
		expect(res.content).not.toMatch(/Permission denied/);
		expect(res.content).toMatch(/not configured/i);
	});

	test("list_inactive_workflows registers (resolves the orphan-sweep cron payload)", () => {
		const registry = new ToolRegistry();
		registry.register(createTools(null));
		expect(registry.get("list_inactive_workflows")).toBeDefined();
		expect(registry.get("probe_workflow")).toBeDefined();
		expect(registry.get("recent_failures")).toBeDefined();
	});
});
