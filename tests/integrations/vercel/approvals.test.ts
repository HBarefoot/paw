import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GitHubApprovals } from "../../../src/integrations/github/approvals.js";
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

let restorePawEnv: () => void;
beforeAll(() => {
	restorePawEnv = scrubPawEnv();
});
afterAll(() => restorePawEnv());

describe("GitHubApprovals — Vercel executors", () => {
	test("approve runs the registered vercel_create_project executor and audits executed", async () => {
		const db = freshDb();
		const audits: string[] = [];
		const q = new GitHubApprovals(
			db,
			undefined,
			(action) => audits.push(action),
			undefined,
		);

		let ran: unknown = null;
		q.registerExecutor("vercel_create_project", async (row) => {
			ran = row.params;
			return { id: "prj_1", createdNew: true };
		});

		const id = q.enqueue(
			"vercel_create_project",
			"acme/site",
			'Create Vercel project "site" linked to acme/site',
			{ name: "site", repo: "acme/site" },
			"web-1",
		);
		const row = await q.approve(id, "web:1");

		expect(row.status).toBe("executed");
		expect(ran).toEqual({ name: "site", repo: "acme/site" });
		expect(audits).toContain("github.vercel_create_project.queued");
		expect(audits).toContain("github.vercel_create_project.executed");
	});

	test("an executor that throws marks the row failed and audits failed", async () => {
		const db = freshDb();
		const audits: string[] = [];
		const q = new GitHubApprovals(
			db,
			undefined,
			(action) => audits.push(action),
			undefined,
		);
		q.registerExecutor("vercel_add_domain", async () => {
			throw new Error("domain rejected");
		});

		const id = q.enqueue(
			"vercel_add_domain",
			"prj_1",
			'Add domain "example.com"',
			{ project: "prj_1", name: "example.com" },
			"web-1",
		);
		const row = await q.approve(id, "web:1");

		expect(row.status).toBe("failed");
		expect(audits).toContain("github.vercel_add_domain.failed");
	});

	test("reject marks the row rejected and never calls the executor", async () => {
		const db = freshDb();
		const q = new GitHubApprovals(db);
		let called = false;
		q.registerExecutor("vercel_create_project", async () => {
			called = true;
			return {};
		});

		const id = q.enqueue(
			"vercel_create_project",
			"acme/site",
			"Create project",
			{ name: "site" },
			"web-1",
		);
		const row = q.reject(id, "web:1");

		expect(row.status).toBe("rejected");
		expect(called).toBe(false);
	});
});
