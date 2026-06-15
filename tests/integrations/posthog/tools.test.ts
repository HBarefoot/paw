import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { PostHogClient } from "../../../src/integrations/posthog/client.js";
import {
	createPostHogTools,
	guardReadOnlyHogQL,
} from "../../../src/integrations/posthog/tools.js";
import type { ToolDefinition, ToolResult } from "../../../src/types/message.js";
import { scrubPawEnv } from "../../helpers/env.js";

const KEY = "phx_super_secret_personal_key";

let originalFetch: typeof globalThis.fetch;
let lastQuery: string | undefined;

/** Mock the Query API; capture the HogQL sent, reply with a fixed table. */
function mockQuery(reply: { columns: string[]; results: unknown[][] }) {
	globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
		const body = init?.body ? JSON.parse(init.body as string) : undefined;
		lastQuery = body?.query?.query;
		return new Response(JSON.stringify(reply), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof globalThis.fetch;
}

function makeClient() {
	return new PostHogClient({
		enabled: true,
		projectApiKey: "phc_public",
		personalApiKey: KEY,
		projectId: "12345",
		host: "https://us.i.posthog.com",
		timeout: 15_000,
	});
}

function byName(tools: ToolDefinition[], name: string): ToolDefinition {
	const t = tools.find((x) => x.name === name);
	if (!t) throw new Error(`tool not found: ${name}`);
	return t;
}

let restorePawEnv: () => void;
beforeAll(() => {
	restorePawEnv = scrubPawEnv();
});
afterAll(() => restorePawEnv());
beforeEach(() => {
	originalFetch = globalThis.fetch;
	lastQuery = undefined;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("guardReadOnlyHogQL", () => {
	test("allows SELECT/WITH and appends a LIMIT when missing", () => {
		expect(guardReadOnlyHogQL("SELECT 1")).toBe("SELECT 1 LIMIT 1000");
		expect(guardReadOnlyHogQL("select event from events limit 5")).toBe(
			"select event from events limit 5",
		);
		expect(
			guardReadOnlyHogQL("WITH x AS (SELECT 1) SELECT * FROM x"),
		).toContain("LIMIT 1000");
	});
	test("rejects writes / DDL and non-SELECT starts", () => {
		expect(() => guardReadOnlyHogQL("DELETE FROM events")).toThrow();
		expect(() => guardReadOnlyHogQL("DROP TABLE events")).toThrow();
		expect(() => guardReadOnlyHogQL("SELECT 1; DELETE FROM events")).toThrow();
		expect(() => guardReadOnlyHogQL("INSERT INTO x VALUES (1)")).toThrow();
	});
});

describe("PostHog tools", () => {
	test("exposes exactly the curated read surface", () => {
		const names = createPostHogTools(makeClient())
			.map((t) => t.name)
			.sort();
		expect(names).toEqual([
			"posthog_event_counts",
			"posthog_funnel",
			"posthog_pageviews",
			"posthog_query",
			"posthog_top_pages",
			"posthog_top_referrers",
		]);
		// all read-only → grouped under the posthog skill, no gating
		for (const t of createPostHogTools(makeClient()))
			expect(t.plugin).toBe("posthog");
	});

	test("posthog_top_pages returns structured [{path, views}]", async () => {
		mockQuery({
			columns: ["path", "views"],
			results: [
				["/", 42],
				["/pricing", 9],
			],
		});
		const res = (await byName(
			createPostHogTools(makeClient()),
			"posthog_top_pages",
		).handler({ dateRange: "30d" })) as ToolResult;
		expect(res.is_error).toBeFalsy();
		expect(JSON.parse(res.content).pages).toEqual([
			{ path: "/", views: 42 },
			{ path: "/pricing", views: 9 },
		]);
		expect(lastQuery).toContain("INTERVAL 30 DAY");
		expect(lastQuery).toContain("event = '$pageview'");
	});

	test("posthog_pageviews path filter is validated and embedded safely", async () => {
		mockQuery({ columns: ["day", "views"], results: [["2026-06-14", 5]] });
		const tools = createPostHogTools(makeClient());
		const ok = (await byName(tools, "posthog_pageviews").handler({
			path: "/pricing",
		})) as ToolResult;
		expect(JSON.parse(ok.content).days[0]).toEqual({
			day: "2026-06-14",
			views: 5,
		});
		expect(lastQuery).toContain("properties.$pathname = '/pricing'");

		// an injection attempt (quote) is rejected, never reaching the query
		lastQuery = undefined;
		const bad = (await byName(tools, "posthog_pageviews").handler({
			path: "/x' OR 1=1 --",
		})) as ToolResult;
		expect(bad.is_error).toBe(true);
		expect(lastQuery).toBeUndefined();
	});

	test("posthog_funnel returns per-step visitors in order", async () => {
		mockQuery({ columns: ["visitors"], results: [[100]] });
		const res = (await byName(
			createPostHogTools(makeClient()),
			"posthog_funnel",
		).handler({ steps: ["/", "/pricing", "/signup"] })) as ToolResult;
		const body = JSON.parse(res.content).funnel;
		expect(body).toHaveLength(3);
		expect(body[0]).toEqual({ step: 1, path: "/", visitors: 100 });
	});

	test("invalid dateRange is a tool error (allowlist enforced)", async () => {
		mockQuery({ columns: [], results: [] });
		const res = (await byName(
			createPostHogTools(makeClient()),
			"posthog_top_pages",
		).handler({ dateRange: "all-time" })) as ToolResult;
		expect(res.is_error).toBe(true);
	});

	test("the personal API key never appears in any tool output", async () => {
		mockQuery({ columns: ["path", "views"], results: [["/", 1]] });
		const tools = createPostHogTools(makeClient());
		for (const t of tools) {
			const res = (await t.handler({
				dateRange: "7d",
				steps: ["/"],
				sql: "SELECT 1",
				name: "$pageview",
			})) as ToolResult;
			expect(res.content).not.toContain(KEY);
		}
	});
});
