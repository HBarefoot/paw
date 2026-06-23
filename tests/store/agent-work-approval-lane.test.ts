import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	advanceCardOnApproval,
	advanceCardOnCompletion,
	createTask,
	getTask,
	linkCardOnDelegation,
	parkCardForApproval,
	updateTask,
} from "../../src/store/agent-work.js";

// Phase 2b — the board approval lane. A board run whose tool gets gated mid-run
// parks its card in `needs_approval`; when the approval resolves (PR1 execute-on-
// approve), the card advances. These reactors are fail-open and unit-tested
// without booting the kernel/bus (mirrors agent-work-autoadvance.test.ts).

function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE agent_work (
			id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT,
			status TEXT NOT NULL DEFAULT 'backlog'
				CHECK(status IN ('backlog','queued','working','needs_approval','blocked','done','failed')),
			priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
			due_at TEXT, evidence TEXT, approval_id TEXT, session_id TEXT,
			agent_name TEXT, error TEXT, block_kind TEXT, operator_note TEXT, position INTEGER NOT NULL DEFAULT 0,
			last_escalated_at TEXT, created_by TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);
	return db;
}

// A started+linked card: working, session_id = the real child session.
function runningCard(db: Database, childSession: string) {
	const t = createTask(db, { title: "send the email" });
	updateTask(db, t.id, { status: "queued" });
	updateTask(db, t.id, { status: "working", session_id: `task-${t.id}` });
	linkCardOnDelegation(db, `task-${t.id}`, childSession);
	return t.id;
}

describe("parkCardForApproval", () => {
	test("parks the run's card in needs_approval with approval_id set", () => {
		const db = freshDb();
		const id = runningCard(db, "agent-x-1");
		parkCardForApproval(db, "agent-x-1", "appr-1");
		const card = getTask(db, id);
		expect(card?.status).toBe("needs_approval");
		expect(card?.approval_id).toBe("appr-1");
	});

	test("non-board session (no card) → no-op, no throw", () => {
		const db = freshDb();
		expect(() => parkCardForApproval(db, "web-1", "appr-9")).not.toThrow();
	});

	test("null requestedBy → no-op", () => {
		const db = freshDb();
		const id = runningCard(db, "agent-x-1");
		parkCardForApproval(db, null, "appr-1");
		expect(getTask(db, id)?.status).toBe("working"); // untouched
	});

	test("fail-open: broken db calls onError, no throw", () => {
		const db = freshDb();
		db.close();
		let saw = false;
		expect(() =>
			parkCardForApproval(db, "agent-x-1", "appr-1", () => {
				saw = true;
			}),
		).not.toThrow();
		expect(saw).toBe(true);
	});
});

describe("advanceCardOnApproval", () => {
	function parkedCard(db: Database, approvalId: string) {
		const id = runningCard(db, "agent-x-1");
		parkCardForApproval(db, "agent-x-1", approvalId);
		return id;
	}

	test("executed → done, evidence = a summary of the action result (gate satisfied)", () => {
		const db = freshDb();
		const id = parkedCard(db, "appr-1");
		const status = advanceCardOnApproval(db, "appr-1", "executed", {
			tool: "slack_send",
			result: { ts: "123.45" },
		});
		expect(status).toBe("done");
		const card = getTask(db, id);
		expect(card?.status).toBe("done");
		expect(card?.evidence).toContain("appr-1");
		expect(card?.evidence).toContain("slack_send"); // the action's result is the proof
	});

	test("rejected → blocked (approval denied)", () => {
		const db = freshDb();
		const id = parkedCard(db, "appr-2");
		expect(advanceCardOnApproval(db, "appr-2", "rejected")).toBe("blocked");
		const card = getTask(db, id);
		expect(card?.status).toBe("blocked");
		expect(card?.error).toContain("denied");
	});

	test("failed → failed with the reason from the result", () => {
		const db = freshDb();
		const id = parkedCard(db, "appr-3");
		expect(
			advanceCardOnApproval(db, "appr-3", "failed", {
				error: "channel not found",
			}),
		).toBe("failed");
		const card = getTask(db, id);
		expect(card?.status).toBe("failed");
		expect(card?.error).toContain("channel not found");
	});

	test("unauthorized → no-op: card stays needs_approval (still actionable)", () => {
		const db = freshDb();
		const id = parkedCard(db, "appr-4");
		expect(advanceCardOnApproval(db, "appr-4", "unauthorized")).toBeNull();
		expect(getTask(db, id)?.status).toBe("needs_approval");
	});

	test("unknown approval id → no-op (null)", () => {
		const db = freshDb();
		expect(advanceCardOnApproval(db, "ghost", "executed", {})).toBeNull();
	});

	test("fail-open: broken db calls onError, no throw", () => {
		const db = freshDb();
		db.close();
		let saw = false;
		expect(() =>
			advanceCardOnApproval(db, "appr-1", "executed", {}, () => {
				saw = true;
			}),
		).not.toThrow();
		expect(saw).toBe(true);
	});
});

describe("advanceCardOnCompletion — approval-parked guard (the race)", () => {
	test("a needs_approval card is NOT bumped to blocked by run completion", () => {
		const db = freshDb();
		const id = runningCard(db, "agent-x-1");
		// The gated run ended and still emits agent:completed{ok:true} AFTER parking.
		parkCardForApproval(db, "agent-x-1", "appr-1");
		const status = advanceCardOnCompletion(db, "agent-x-1", true);
		expect(status).toBeNull(); // left to the approval lane
		expect(getTask(db, id)?.status).toBe("needs_approval");
	});
});
