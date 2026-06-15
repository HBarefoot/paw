import { Database } from "bun:sqlite";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { GitHubApprovals } from "../../../src/integrations/github/approvals.js";
import { VercelClient } from "../../../src/integrations/vercel/client.js";
import { createVercelTools } from "../../../src/integrations/vercel/tools.js";
import type {
	DeployTarget,
	ProjectResult,
} from "../../../src/integrations/vercel/types.js";
import type { ToolDefinition, ToolResult } from "../../../src/types/message.js";
import { scrubPawEnv } from "../../helpers/env.js";

function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
    CREATE TABLE github_pending_actions (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      repo TEXT NOT NULL,
      summary TEXT NOT NULL,
      params_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT,
      decided_by TEXT,
      result_json TEXT,
      origin_channel TEXT,
      origin_ref TEXT
    );
  `);
	return db;
}

/** A DeployTarget whose mutating methods explode if called, so we can prove the
 *  gated tools enqueue rather than execute. */
function fakeTarget(overrides: Partial<DeployTarget> = {}): DeployTarget {
	return {
		listProjects: async () => [{ id: "prj_1", name: "site", framework: null }],
		listDeployments: async () => [
			{
				id: "dpl_1",
				url: "site-abc.vercel.app",
				readyState: "READY",
				target: "production",
				createdAt: 1,
			},
		],
		getDeploymentStatus: async (id) => ({
			id,
			readyState: "READY",
			url: "site-abc.vercel.app",
		}),
		getOrCreateProject: async () => {
			throw new Error("getOrCreateProject must not run from the tool handler");
		},
		addDomain: async () => {
			throw new Error("addDomain must not run from the tool handler");
		},
		...overrides,
	};
}

function byName(tools: ToolDefinition[], name: string): ToolDefinition {
	const t = tools.find((x) => x.name === name);
	if (!t) throw new Error(`tool ${name} not found`);
	return t;
}

let restorePawEnv: () => void;
beforeAll(() => {
	restorePawEnv = scrubPawEnv();
});
afterAll(() => restorePawEnv());

describe("createVercelTools", () => {
	test("exposes the expected tools under plugin 'vercel'", () => {
		const tools = createVercelTools(fakeTarget());
		expect(tools.map((t) => t.name).sort()).toEqual([
			"vercel_add_domain",
			"vercel_create_project",
			"vercel_deploy_status",
			"vercel_latest_deployment",
			"vercel_list_deployments",
			"vercel_list_projects",
		]);
		expect(tools.every((t) => t.plugin === "vercel")).toBe(true);
	});

	test("vercel_latest_deployment returns {id,url,state,target} and feeds deploy_status", async () => {
		const tools = createVercelTools(fakeTarget());
		const res = (await byName(tools, "vercel_latest_deployment").handler({
			project: "prj_1",
		})) as ToolResult;
		expect(res.is_error).toBeFalsy();
		const d = JSON.parse(res.content);
		expect(d).toEqual({
			found: true,
			id: "dpl_1",
			url: "site-abc.vercel.app",
			state: "READY",
			target: "production",
		});
		// the returned id is accepted by vercel_deploy_status (chain is closed)
		const status = (await byName(tools, "vercel_deploy_status").handler({
			deployment: d.id,
		})) as ToolResult;
		expect(JSON.parse(status.content).readyState).toBe("READY");
	});

	test("vercel_latest_deployment defaults to the production target", async () => {
		let seenTarget: string | undefined = "UNSET";
		const tools = createVercelTools(
			fakeTarget({
				listDeployments: async (opts) => {
					seenTarget = opts.target;
					return [];
				},
			}),
		);
		await byName(tools, "vercel_latest_deployment").handler({ project: "p" });
		expect(seenTarget).toBe("production");
	});

	test("vercel_latest_deployment with no deployment yet → found:false + production note", async () => {
		const tools = createVercelTools(
			fakeTarget({ listDeployments: async () => [] }),
		);
		const res = (await byName(tools, "vercel_latest_deployment").handler({
			project: "p",
		})) as ToolResult;
		const d = JSON.parse(res.content);
		expect(d.found).toBe(false);
		expect(d.message).toMatch(/preview|default branch/i);
	});

	test("vercel_list_deployments returns the mapped array", async () => {
		const tools = createVercelTools(fakeTarget());
		const res = (await byName(tools, "vercel_list_deployments").handler({
			project: "prj_1",
		})) as ToolResult;
		expect(JSON.parse(res.content).deployments[0]).toEqual({
			id: "dpl_1",
			url: "site-abc.vercel.app",
			readyState: "READY",
			target: "production",
			createdAt: 1,
		});
	});

	test("read tools execute immediately and return non-error JSON", async () => {
		const tools = createVercelTools(fakeTarget());
		const list = (await byName(tools, "vercel_list_projects").handler(
			{},
		)) as ToolResult;
		expect(list.is_error).toBeFalsy();
		expect(JSON.parse(list.content).projects[0].id).toBe("prj_1");

		const status = (await byName(tools, "vercel_deploy_status").handler({
			deployment: "dpl_9",
		})) as ToolResult;
		expect(status.is_error).toBeFalsy();
		expect(JSON.parse(status.content)).toEqual({
			id: "dpl_9",
			readyState: "READY",
			url: "site-abc.vercel.app",
		});
	});

	test("vercel_create_project enqueues an approval row and does NOT call the client", async () => {
		const db = freshDb();
		const approvals = new GitHubApprovals(db, undefined, undefined, undefined);
		const tools = createVercelTools(fakeTarget(), { approvals });

		const res = (await byName(tools, "vercel_create_project").handler({
			name: "My Site",
			repo: "acme/site",
			__sessionId: "web-1",
		})) as ToolResult;

		const parsed = JSON.parse(res.content);
		expect(parsed.queued).toBe(true);
		expect(parsed.id).toBeTruthy();

		// Exactly one pending row, the right action, with the create params preserved.
		const rows = db
			.query("SELECT action, repo, params_json FROM github_pending_actions")
			.all() as Array<{ action: string; repo: string; params_json: string }>;
		expect(rows).toHaveLength(1);
		expect(rows[0].action).toBe("vercel_create_project");
		expect(rows[0].repo).toBe("acme/site");
		expect(JSON.parse(rows[0].params_json)).toEqual({
			name: "My Site",
			repo: "acme/site",
			framework: undefined,
		});
	});

	test("vercel_add_domain enqueues a 'vercel_add_domain' approval row", async () => {
		const db = freshDb();
		const approvals = new GitHubApprovals(db, undefined, undefined, undefined);
		const tools = createVercelTools(fakeTarget(), { approvals });

		const res = (await byName(tools, "vercel_add_domain").handler({
			project: "prj_1",
			name: "example.com",
			__sessionId: "web-1",
		})) as ToolResult;
		expect(JSON.parse(res.content).queued).toBe(true);

		const row = db
			.query("SELECT action, params_json FROM github_pending_actions")
			.get() as { action: string; params_json: string };
		expect(row.action).toBe("vercel_add_domain");
		expect(JSON.parse(row.params_json)).toEqual({
			project: "prj_1",
			name: "example.com",
		});
	});

	test("gated tools refuse when no approval queue is wired", async () => {
		const tools = createVercelTools(fakeTarget()); // no deps.approvals
		for (const name of ["vercel_create_project", "vercel_add_domain"]) {
			const res = (await byName(tools, name).handler({
				name: "x",
				project: "p",
			})) as ToolResult;
			expect(res.is_error).toBe(true);
			expect(res.content).toContain("approval queue is unavailable");
		}
	});

	test("the API token never appears in any tool output", async () => {
		const TOKEN = "super-secret-vercel-token";
		// Real client + mocked fetch, so a leak would actually surface.
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					projects: [{ id: "prj_1", name: "site", framework: null }],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			)) as unknown as typeof globalThis.fetch;
		try {
			const client = new VercelClient({
				enabled: true,
				token: TOKEN,
				baseUrl: "https://api.vercel.com",
				timeout: 15_000,
			});
			const db = freshDb();
			const approvals = new GitHubApprovals(db);
			const tools = createVercelTools(client, { approvals });
			for (const t of tools) {
				const res = (await t.handler({
					name: "site",
					project: "prj_1",
					deployment: "dpl_1",
				})) as ToolResult;
				expect(res.content).not.toContain(TOKEN);
			}
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("a typed reference keeps ProjectResult shape stable", () => {
		// Compile-time guard that the tools depend on the DeployTarget DTOs.
		const r: ProjectResult = {
			id: "prj_1",
			name: "site",
			framework: null,
			createdNew: true,
		};
		expect(r.createdNew).toBe(true);
	});
});
