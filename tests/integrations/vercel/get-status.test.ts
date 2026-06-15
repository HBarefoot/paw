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
import { scrubPawEnv } from "../../helpers/env.js";

const BASE_URL = "https://api.vercel.com";
const TOKEN = "vercel-test-token-xyz";

let originalFetch: typeof globalThis.fetch;
let lastUrl = "";

function respondProjects(status: number, body: unknown) {
	globalThis.fetch = (async (input: string | URL | Request) => {
		lastUrl =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		return new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof globalThis.fetch;
}

function makeClient(overrides?: { teamId?: string }) {
	return new VercelClient({
		enabled: true,
		token: TOKEN,
		teamId: overrides?.teamId,
		baseUrl: BASE_URL,
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
	lastUrl = "";
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("VercelClient.getStatus", () => {
	test("ok path reports the project count", async () => {
		respondProjects(200, {
			projects: [
				{ id: "prj_1", name: "a", framework: null },
				{ id: "prj_2", name: "b", framework: "nextjs" },
			],
		});
		const status = await makeClient().getStatus();
		expect(status).toEqual({
			configured: true,
			ok: true,
			projectCount: 2,
			team: undefined,
		});
	});

	test("team scope is reflected and sent as a query param", async () => {
		respondProjects(200, { projects: [] });
		const status = await makeClient({ teamId: "team_42" }).getStatus();
		expect(status.team).toBe("team_42");
		expect(lastUrl).toContain("teamId=team_42");
	});

	test("error path returns ok:false with a message and does not throw", async () => {
		respondProjects(401, { error: { message: "Unauthorized" } });
		const status = await makeClient().getStatus();
		expect(status.configured).toBe(true);
		expect(status.ok).toBe(false);
		expect(typeof status.error).toBe("string");
		expect(status.error?.length ?? 0).toBeGreaterThan(0);
	});
});
