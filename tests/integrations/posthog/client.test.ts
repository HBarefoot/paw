import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	PostHogClient,
	toApiHost,
} from "../../../src/integrations/posthog/client.js";
import { PostHogError } from "../../../src/integrations/posthog/types.js";
import { scrubPawEnv } from "../../helpers/env.js";

const KEY = "phx_personal_test_key";
const PROJECT = "12345";

interface Captured {
	method: string;
	url: string;
	path: string;
	body: unknown;
	auth?: string;
}

let originalFetch: typeof globalThis.fetch;
let calls: Captured[];

function mockFetch(respond: (c: Captured) => Response) {
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
		const captured: Captured = {
			method: (init?.method ?? "GET").toUpperCase(),
			url,
			path: new URL(url).pathname,
			body: init?.body ? JSON.parse(init.body as string) : undefined,
			auth: headers?.Authorization,
		};
		calls.push(captured);
		return respond(captured);
	}) as typeof globalThis.fetch;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function makeClient(overrides?: { host?: string; projectId?: string }) {
	return new PostHogClient({
		enabled: true,
		projectApiKey: "phc_public",
		personalApiKey: KEY,
		projectId: overrides?.projectId ?? PROJECT,
		host: overrides?.host ?? "https://us.i.posthog.com",
		timeout: 15_000,
	});
}

let restorePawEnv: () => void;
beforeAll(() => {
	restorePawEnv = scrubPawEnv();
});
afterAll(() => restorePawEnv());
beforeEach(() => {
	originalFetch = globalThis.fetch;
	calls = [];
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("toApiHost", () => {
	test("maps the ingestion host to the app/query host", () => {
		expect(toApiHost("https://us.i.posthog.com")).toBe(
			"https://us.posthog.com",
		);
		expect(toApiHost("https://eu.i.posthog.com")).toBe(
			"https://eu.posthog.com",
		);
	});
	test("leaves a self-hosted host unchanged", () => {
		expect(toApiHost("https://ph.example.com")).toBe("https://ph.example.com");
	});
});

describe("PostHogClient", () => {
	test("constructor requires the personal key and projectId", () => {
		expect(() => makeClient({ projectId: "" })).toThrow(PostHogError);
	});

	test("query hits the Query API on the APP host with Bearer auth + HogQL body", async () => {
		mockFetch(() => json({ columns: ["x"], results: [[1]], types: ["Int64"] }));
		const qr = await makeClient().query("SELECT 1 AS x");
		expect(qr).toEqual({ columns: ["x"], results: [[1]], types: ["Int64"] });
		const c = calls[0];
		expect(c.method).toBe("POST");
		// app host, not the i. ingestion host
		expect(c.url.startsWith("https://us.posthog.com")).toBe(true);
		expect(c.path).toBe(`/api/projects/${PROJECT}/query/`);
		expect(c.auth).toBe(`Bearer ${KEY}`);
		expect(c.body).toEqual({
			query: { kind: "HogQLQuery", query: "SELECT 1 AS x" },
		});
	});

	test("non-2xx → PostHogError with status; 401 hints at the key permission", async () => {
		mockFetch(() => json({ detail: "nope" }, 401));
		await expect(makeClient().query("SELECT 1")).rejects.toThrow(/401/);
		await expect(makeClient().query("SELECT 1")).rejects.toThrow(
			/Query Read permission/,
		);
	});

	test("429 rate-limit surfaces a back-off hint", async () => {
		mockFetch(() => json({ detail: "slow down" }, 429));
		await expect(makeClient().query("SELECT 1")).rejects.toThrow(
			/rate limited/,
		);
	});

	test("getStatus never throws and never returns the key", async () => {
		mockFetch(() => json({ columns: ["1"], results: [[1]] }));
		const ok = await makeClient().getStatus();
		expect(ok).toEqual({ configured: true, ok: true });

		mockFetch(() => json({ detail: "bad" }, 403));
		const bad = await makeClient().getStatus();
		expect(bad.configured).toBe(true);
		expect(bad.ok).toBe(false);
		expect(JSON.stringify(bad)).not.toContain(KEY);
	});
});
