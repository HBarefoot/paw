import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { VercelClient } from "../../../src/integrations/vercel/client.js";
import { VercelError } from "../../../src/integrations/vercel/types.js";
import { scrubPawEnv } from "../../helpers/env.js";

const BASE_URL = "https://api.vercel.com";
const TOKEN = "vercel-test-token-xyz";

interface Captured {
	method: string;
	url: string;
	path: string;
	body: unknown;
	auth?: string;
}

let originalFetch: typeof globalThis.fetch;
let calls: Captured[];

/** Route requests by `${METHOD} ${pathPrefix}` to a Response factory. The first
 *  matching prefix wins, so order more-specific routes first. */
function routeFetch(
	routes: Array<{
		method: string;
		match: string;
		respond: (c: Captured) => Response;
	}>,
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
		const method = (init?.method ?? "GET").toUpperCase();
		const path = new URL(url).pathname;
		const headers = init?.headers as Record<string, string> | undefined;
		const captured: Captured = {
			method,
			url,
			path,
			body: init?.body ? JSON.parse(init.body as string) : undefined,
			auth: headers?.Authorization,
		};
		calls.push(captured);
		const route = routes.find(
			(r) => r.method === method && path.startsWith(r.match),
		);
		if (!route) {
			return new Response("no route", { status: 599 });
		}
		return route.respond(captured);
	}) as typeof globalThis.fetch;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function makeClient(overrides?: { teamId?: string; timeout?: number }) {
	return new VercelClient({
		enabled: true,
		token: TOKEN,
		teamId: overrides?.teamId,
		baseUrl: BASE_URL,
		timeout: overrides?.timeout ?? 15_000,
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

describe("VercelClient", () => {
	test("constructor throws when token is missing", () => {
		expect(
			() =>
				new VercelClient({
					enabled: true,
					token: "",
					baseUrl: BASE_URL,
					timeout: 15_000,
				}),
		).toThrow("Vercel token is required");
	});

	test("getOrCreateProject create path links the repo and sets framework null", async () => {
		routeFetch([
			{ method: "GET", match: "/v9/projects/", respond: () => json({}, 404) },
			{
				method: "POST",
				match: "/v11/projects",
				respond: () =>
					json({
						id: "prj_1",
						name: "site",
						framework: null,
						link: { type: "github", org: "acme", repo: "site" },
					}),
			},
		]);
		const res = await makeClient().getOrCreateProject({
			name: "Site",
			repo: "acme/site",
		});

		expect(res).toEqual({
			id: "prj_1",
			name: "site",
			framework: null,
			linkedRepo: "acme/site",
			createdNew: true,
		});
		const post = calls.find((c) => c.method === "POST");
		expect(post?.path).toBe("/v11/projects");
		expect(post?.body).toEqual({
			name: "site",
			framework: null,
			gitRepository: { type: "github", repo: "acme/site" },
		});
	});

	test("getOrCreateProject is idempotent — existing project, no POST", async () => {
		routeFetch([
			{
				method: "GET",
				match: "/v9/projects/",
				respond: () => json({ id: "prj_1", name: "site", framework: null }),
			},
			{
				method: "POST",
				match: "/v11/projects",
				respond: () => json({}, 500),
			},
		]);
		const res = await makeClient().getOrCreateProject({
			name: "site",
			repo: "acme/site",
		});

		expect(res.createdNew).toBe(false);
		expect(res.id).toBe("prj_1");
		expect(calls.some((c) => c.method === "POST")).toBe(false);
	});

	test("getOrCreateProject recovers from a 409 create race", async () => {
		let getCount = 0;
		routeFetch([
			{
				method: "GET",
				match: "/v9/projects/",
				respond: () => {
					getCount += 1;
					// First GET: not found. Second GET (post-409): found.
					return getCount === 1
						? json({}, 404)
						: json({ id: "prj_race", name: "site", framework: null });
				},
			},
			{
				method: "POST",
				match: "/v11/projects",
				respond: () => json({ error: "name taken" }, 409),
			},
		]);
		const res = await makeClient().getOrCreateProject({
			name: "site",
			repo: "acme/site",
		});

		expect(res.createdNew).toBe(false);
		expect(res.id).toBe("prj_race");
		expect(getCount).toBe(2);
	});

	test("getDeploymentStatus maps READY + url", async () => {
		routeFetch([
			{
				method: "GET",
				match: "/v13/deployments/",
				respond: () =>
					json({
						id: "dpl_1",
						readyState: "READY",
						url: "site-abc.vercel.app",
					}),
			},
		]);
		const res = await makeClient().getDeploymentStatus("dpl_1");
		expect(res).toEqual({
			id: "dpl_1",
			readyState: "READY",
			url: "site-abc.vercel.app",
		});
		expect(calls[0].path).toBe("/v13/deployments/dpl_1");
	});

	test("getDeploymentStatus surfaces ERROR readyState (not an exception)", async () => {
		routeFetch([
			{
				method: "GET",
				match: "/v13/deployments/",
				respond: () => json({ uid: "dpl_2", readyState: "ERROR" }),
			},
		]);
		const res = await makeClient().getDeploymentStatus("dpl_2");
		expect(res.readyState).toBe("ERROR");
		expect(res.id).toBe("dpl_2");
	});

	test("addDomain posts {name} and returns the verification challenge", async () => {
		routeFetch([
			{
				method: "POST",
				match: "/v10/projects/",
				respond: () =>
					json({
						name: "example.com",
						verified: false,
						verification: [
							{
								type: "TXT",
								domain: "_vercel.example.com",
								value: "vc-domain-verify=...",
								reason: "pending_domain_verification",
							},
						],
					}),
			},
		]);
		const res = await makeClient().addDomain("prj_1", "example.com");
		expect(res.verified).toBe(false);
		expect(res.verification[0].type).toBe("TXT");
		expect(calls[0].path).toBe("/v10/projects/prj_1/domains");
		expect(calls[0].body).toEqual({ name: "example.com" });
	});

	test("listProjects maps /v9/projects", async () => {
		routeFetch([
			{
				method: "GET",
				match: "/v9/projects",
				respond: () =>
					json({
						projects: [
							{ id: "prj_1", name: "a", framework: "nextjs" },
							{ id: "prj_2", name: "b", framework: null },
						],
					}),
			},
		]);
		const res = await makeClient().listProjects();
		expect(res).toEqual([
			{ id: "prj_1", name: "a", framework: "nextjs" },
			{ id: "prj_2", name: "b", framework: null },
		]);
	});

	test("teamId is appended as a query param and Bearer auth is sent", async () => {
		routeFetch([
			{
				method: "GET",
				match: "/v9/projects",
				respond: () => json({ projects: [] }),
			},
		]);
		await makeClient({ teamId: "team_42" }).listProjects();
		expect(calls[0].url).toContain("teamId=team_42");
		expect(calls[0].auth).toBe(`Bearer ${TOKEN}`);
	});

	test.each([429, 401, 400, 500])(
		"surfaces HTTP %i as a VercelError carrying the status",
		async (status) => {
			routeFetch([
				{
					method: "GET",
					match: "/v9/projects",
					respond: () => json({ error: "nope" }, status),
				},
			]);
			let caught: unknown;
			try {
				await makeClient().listProjects();
			} catch (e) {
				caught = e;
			}
			expect(caught).toBeInstanceOf(VercelError);
			expect((caught as VercelError).status).toBe(status);
		},
	);

	test("a timed-out request throws a VercelError mentioning the timeout", async () => {
		// fetch never resolves but rejects on abort, like the real impl.
		globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new DOMException("Aborted", "AbortError")),
				);
			})) as typeof globalThis.fetch;

		await expect(makeClient({ timeout: 1 }).listProjects()).rejects.toThrow(
			/timed out/,
		);
	});
});
