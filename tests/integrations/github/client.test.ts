import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * GitHub write-path regression tests (PR: fix/github-write-path).
 *
 * The Octokit SDK does not route through globalThis.fetch, so we module-mock
 * "octokit": the mocked App returns an installation Octokit whose `rest` tree is
 * a mutable object (`octokitRest`) the tests reshape per case. This lets us force
 * a 403 from a specific API call and assert the surfaced error now names the
 * missing GitHub App permission (it used to be opaque).
 */

// Mutable rest tree the mocked App hands back; reset to a happy default per test.
let octokitRest: Record<string, unknown>;
// The `ghs_…` installation access token the mocked `app.octokit.request(POST
// …/access_tokens)` returns — the canonical mint getInstallationToken now uses.
let installRequestToken: string | undefined;
let requestedRoute: string | undefined;
let requestParams: Record<string, unknown> | undefined;
let requestThrows: boolean;
// A DISTINCT JWT sentinel returned by the installation-Octokit's bare `.auth()`.
// The fix must NEVER return this — a bare `.auth()` yields the App JWT (ey…), which
// git/gh send as a repo bearer → 401. Used to prove the JWT path is gone.
let installAuthToken: string | undefined;

mock.module("octokit", () => ({
	App: class {
		octokit = {
			rest: {
				apps: {
					getAuthenticated: async () => ({ data: { slug: "test-app" } }),
				},
			},
			// The app-JWT-authed octokit. `request` is the canonical way to mint a
			// fresh installation ACCESS token (ghs_…).
			request: async (route: string, params: Record<string, unknown>) => {
				requestedRoute = route;
				requestParams = params;
				if (requestThrows) throw new Error("app installation mint failed");
				return { data: { token: installRequestToken } };
			},
		};
		// biome-ignore lint/complexity/noUselessConstructor: mirror real signature
		constructor(_opts: unknown) {}
		async getInstallationOctokit() {
			// The API tools call this Octokit's `rest` methods (auth per-request).
			// `.auth()` here returns the App JWT sentinel — getInstallationToken must
			// NOT use it (that was the 401 bug).
			return {
				rest: octokitRest,
				auth: async () => ({ token: installAuthToken }),
			};
		}
	},
	Octokit: Object.assign(class {}, { defaults: () => class {} }),
}));

const { GitHubClient } = await import(
	"../../../src/integrations/github/client.js"
);
const { createGitHubTools } = await import(
	"../../../src/integrations/github/tools.js"
);

type AnyFn = (...args: unknown[]) => Promise<unknown>;

function happyRest() {
	return {
		repos: {
			get: async () => ({ data: { default_branch: "main" } }),
			getBranch: async () => ({ data: { protected: false } }),
		},
		git: {
			getRef: async () => ({ data: { object: { sha: "a".repeat(40) } } }),
			getCommit: async () => ({ data: { tree: { sha: "basetree" } } }),
			createBlob: async () => ({ data: { sha: "blob" } }),
			createTree: async () => ({ data: { sha: "tree" } }),
			createCommit: async () => ({
				data: { sha: "commit", html_url: "https://gh/commit" },
			}),
			updateRef: async () => ({ data: {} }),
		},
		pulls: {
			list: async () => ({ data: [] }),
			create: async () => ({
				data: {
					number: 1,
					title: "t",
					state: "open",
					draft: false,
					head: { ref: "feature" },
					base: { ref: "main" },
					html_url: "https://gh/pr/1",
					user: { login: "me" },
				},
			}),
		},
		issues: {
			create: async () => ({
				data: {
					number: 7,
					html_url: "https://gh/issues/7",
					title: "Bug",
					state: "open",
				},
			}),
			update: async () => ({ data: {} }),
			get: async () => ({
				data: {
					number: 7,
					html_url: "https://gh/issues/7",
					title: "Updated title",
					state: "open",
				},
			}),
		},
	} as Record<string, Record<string, AnyFn>>;
}

const fail403: AnyFn = async () => {
	const e = new Error("Resource not accessible by integration") as Error & {
		status: number;
	};
	e.status = 403;
	throw e;
};

function makeClient(repoAllowlist: string[] = ["owner/repo"], token?: string) {
	return new GitHubClient({
		enabled: true,
		appId: "1",
		installationId: "2",
		privateKey: "dummy",
		webhookSecret: "",
		baseUrl: "https://api.github.com",
		repoAllowlist,
		token,
	});
}

beforeEach(() => {
	octokitRest = happyRest();
	installRequestToken = "ghs_minted_xyz";
	requestedRoute = undefined;
	requestParams = undefined;
	requestThrows = false;
	// If the old bare-.auth() path were still used, THIS JWT would be returned.
	installAuthToken = "ey_jwt_should_NOT_be_used";
});

describe("getInstallationToken mints a real installation ACCESS token (ghs_…), not a JWT", () => {
	// Regression (fix/installation-token-401): the #162 version returned a bare
	// installation-Octokit `.auth()` token, which is the App JWT (ey…) — git/gh sent
	// it as a repo bearer → `HTTP 401: Bad credentials`. The mint now goes through
	// the canonical POST /app/installations/{id}/access_tokens endpoint (ghs_…).
	test("returns data.token from POST …/access_tokens, NOT the bare .auth() JWT", async () => {
		const token = await makeClient().getInstallationToken();
		expect(token).toBe("ghs_minted_xyz");
		expect(requestedRoute).toBe(
			"POST /app/installations/{installation_id}/access_tokens",
		);
		expect(requestParams).toMatchObject({ installation_id: 2 });
		// the JWT path is gone — its sentinel must never be returned
		expect(token).not.toBe("ey_jwt_should_NOT_be_used");
	});

	test("falls back to the github.token PAT when the App mint fails", async () => {
		requestThrows = true; // App installation mint unavailable
		const token = await makeClient(
			["owner/repo"],
			"ghp_pat_fallback",
		).getInstallationToken();
		expect(token).toBe("ghp_pat_fallback");
	});
});

describe("GitHub 403 scope errors are self-explanatory", () => {
	test("commit 403 names `contents: write`", async () => {
		(octokitRest.git as Record<string, AnyFn>).createBlob = fail403;
		const client = makeClient();
		await expect(
			client.commitFiles(
				"owner/repo",
				"feature",
				[{ path: "a.txt", content: "hi" }],
				"msg",
			),
		).rejects.toThrow(/contents: write/);
	});

	test("open PR 403 names `pull_requests: write`", async () => {
		(octokitRest.pulls as Record<string, AnyFn>).create = fail403;
		const client = makeClient();
		await expect(
			client.openPr("owner/repo", { head: "feature", title: "t" }),
		).rejects.toThrow(/pull_requests: write/);
	});

	test("create-issue 403 names `issues: write`", async () => {
		(octokitRest.issues as Record<string, AnyFn>).create = fail403;
		const client = makeClient();
		await expect(
			client.createIssue("owner/repo", { title: "x" }),
		).rejects.toThrow(/issues: write/);
	});
});

describe("issue create/update CRUD", () => {
	test("createIssue returns the new issue", async () => {
		const client = makeClient();
		const res = await client.createIssue("owner/repo", {
			title: "Bug",
			labels: ["bug"],
		});
		expect(res.number).toBe(7);
		expect(res.url).toBe("https://gh/issues/7");
	});

	test("updateIssue returns the refreshed issue", async () => {
		const client = makeClient();
		const res = await client.updateIssue("owner/repo", 7, {
			title: "Updated title",
		});
		expect(res.title).toBe("Updated title");
	});

	test("update-issue tool exposes no `state` field (close stays gated)", () => {
		const tools = createGitHubTools(makeClient());
		const names = tools.map((t) => t.name);
		expect(names).toContain("github_create_issue");
		expect(names).toContain("github_update_issue");
		const upd = tools.find((t) => t.name === "github_update_issue");
		const props = (upd?.input_schema as { properties: Record<string, unknown> })
			.properties;
		expect(props.state).toBeUndefined();
	});

	test("github_create_issue tool returns the issue JSON", async () => {
		const tools = createGitHubTools(makeClient());
		const tool = tools.find((t) => t.name === "github_create_issue");
		const res = await tool?.handler({ repo: "owner/repo", title: "Bug" });
		expect(res?.is_error).toBeFalsy();
		expect(JSON.parse(res?.content ?? "{}").number).toBe(7);
	});
});

describe("allowlist still enforced before any API call", () => {
	test("write to a non-allowlisted repo fails fast with the clear allowlist error", async () => {
		const client = makeClient(["owner/repo"]);
		let blobCalled = false;
		(octokitRest.git as Record<string, AnyFn>).createBlob = async () => {
			blobCalled = true;
			return { data: { sha: "x" } };
		};
		await expect(
			client.commitFiles(
				"evil/repo",
				"feature",
				[{ path: "a", content: "b" }],
				"m",
			),
		).rejects.toThrow(/not in the GitHub allowlist/);
		// And it never reached the GitHub API, nor got a scope hint appended.
		expect(blobCalled).toBe(false);
	});
});
