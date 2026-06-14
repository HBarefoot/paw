import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	GitHubApprovals,
	type PendingActionRow,
	approvalLabel,
	originFromSessionId,
} from "../../../src/integrations/github/approvals.js";
import type { GitHubClient } from "../../../src/integrations/github/client.js";
import { EventBus } from "../../../src/kernel/bus.js";
import type { EventMap } from "../../../src/types/events.js";

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

// A GitHub client whose gated actions just succeed, so approve() reaches "executed".
const okClient = {
	mergePr: async () => ({ merged: true }),
	deleteBranch: async () => ({}),
	closeIssue: async () => ({}),
	dispatchWorkflow: async () => ({}),
} as unknown as GitHubClient;

describe("originFromSessionId", () => {
	test("slack session → slack channel + JSON ref", () => {
		const o = originFromSessionId("slack-C0123ABC-1718000000.1234");
		expect(o.channel).toBe("slack");
		expect(JSON.parse(o.ref as string)).toEqual({
			channel: "C0123ABC",
			threadTs: "1718000000.1234",
		});
	});
	test("web / unknown / null → web", () => {
		expect(originFromSessionId("web-1").channel).toBe("web");
		expect(originFromSessionId(null).channel).toBe("web");
		expect(originFromSessionId(undefined).channel).toBe("web");
	});
	test("cron session → cron", () => {
		expect(originFromSessionId("cron-job-7").channel).toBe("cron");
	});
});

describe("approvalLabel", () => {
	test("0 / 1 / N", () => {
		expect(approvalLabel([])).toBe("");
		expect(
			approvalLabel([{ summary: "Merge PR #42 in a/b" }] as PendingActionRow[]),
		).toBe("Waiting for your approval — Merge PR #42 in a/b");
		expect(approvalLabel([{}, {}] as PendingActionRow[])).toBe(
			"2 actions awaiting approval",
		);
	});
});

describe("GitHubApprovals — origin + lifecycle + events", () => {
	test("enqueue records origin and emits approval:pending", () => {
		const db = freshDb();
		const bus = new EventBus();
		const seen: EventMap["approval:pending"][] = [];
		bus.on("approval:pending", (p) => {
			seen.push(p);
		});
		const q = new GitHubApprovals(db, okClient, undefined, bus);
		const id = q.enqueue(
			"merge_pr",
			"a/b",
			"Merge PR #1 in a/b",
			{ number: 1 },
			"web-1",
			{
				channel: "web",
				ref: "web-1",
			},
		);
		const rows = q.actionable(24);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(id);
		expect(rows[0].origin_channel).toBe("web");
		expect(seen).toHaveLength(1);
		expect(seen[0].originChannel).toBe("web");
		expect(seen[0].id).toBe(id);
	});

	test("slack origin is persisted with its routing ref", () => {
		const db = freshDb();
		const q = new GitHubApprovals(db, okClient, undefined);
		const id = q.enqueue(
			"close_issue",
			"a/b",
			"Close issue #9",
			{ number: 9 },
			"slack-C1-1.2",
			originFromSessionId("slack-C1-1.2"),
		);
		const row = q.get(id);
		expect(row?.origin_channel).toBe("slack");
		expect(JSON.parse(row?.origin_ref as string).channel).toBe("C1");
	});

	test("approve → executed, count drops to 0, emits resolved", async () => {
		const db = freshDb();
		const bus = new EventBus();
		const resolved: EventMap["approval:resolved"][] = [];
		bus.on("approval:resolved", (r) => {
			resolved.push(r);
		});
		const q = new GitHubApprovals(db, okClient, undefined, bus);
		const id = q.enqueue("merge_pr", "a/b", "Merge", { number: 1 }, "web-1");
		const row = await q.approve(id, "web:1");
		expect(row.status).toBe("executed");
		expect(q.actionable(24)).toHaveLength(0);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].status).toBe("executed");
		expect(resolved[0].decidedBy).toBe("web:1");
	});

	test("reject → rejected + resolved event", () => {
		const db = freshDb();
		const bus = new EventBus();
		const resolved: EventMap["approval:resolved"][] = [];
		bus.on("approval:resolved", (r) => resolved.push(r));
		const q = new GitHubApprovals(db, okClient, undefined, bus);
		const id = q.enqueue(
			"delete_branch",
			"a/b",
			"Delete",
			{ branch: "x" },
			"web-1",
		);
		const row = q.reject(id, "web:1");
		expect(row.status).toBe("rejected");
		expect(resolved[0]?.status).toBe("rejected");
	});

	test("expireStale flips old pending rows to expired + audits once; actionable excludes them", () => {
		const db = freshDb();
		const audits: string[] = [];
		const q = new GitHubApprovals(db, okClient, (a) => audits.push(a));
		const id = q.enqueue(
			"merge_pr",
			"a/b",
			"Old merge",
			{ number: 1 },
			"web-1",
		);
		// Age the row past the TTL.
		db.run(
			"UPDATE github_pending_actions SET created_at = datetime('now','-48 hours') WHERE id = ?",
			[id],
		);
		expect(q.actionable(24)).toHaveLength(0); // expires + excludes
		expect(q.get(id)?.status).toBe("expired");
		expect(audits.filter((a) => a.endsWith(".expired"))).toHaveLength(1);
		// Idempotent: a second sweep doesn't re-audit.
		q.expireStale(24);
		expect(audits.filter((a) => a.endsWith(".expired"))).toHaveLength(1);
	});
});
