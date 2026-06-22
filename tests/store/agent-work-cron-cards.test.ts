import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	advanceCardOnVerdict,
	cronCreatedBy,
	failCronCard,
	getCronCard,
	getTask,
	updateTask,
	upsertCronCard,
} from "../../src/store/agent-work.js";

// Phase 2c — cron-as-cards. A cron `prompt` run gets ONE durable board card per
// JOB (linked by created_by="cron:<jobId>"), cycling working → done/blocked/failed
// each fire, driven by the #182 run verdict. Reactors are fail-open and unit-
// tested without booting the kernel (mirrors agent-work-autoadvance.test.ts).

function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE agent_work (
			id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT,
			status TEXT NOT NULL DEFAULT 'backlog'
				CHECK(status IN ('backlog','queued','working','needs_approval','blocked','done','failed')),
			priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
			due_at TEXT, evidence TEXT, approval_id TEXT, session_id TEXT,
			agent_name TEXT, error TEXT, position INTEGER NOT NULL DEFAULT 0,
			last_escalated_at TEXT, created_by TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);
	return db;
}

describe("upsertCronCard", () => {
	test("creates a working card linked to the job + run session", () => {
		const db = freshDb();
		const id = upsertCronCard(db, {
			jobId: "job-1",
			jobName: "Daily lead sweep",
			sessionId: "cron-job-1-1000",
			prompt: "sweep the leads",
		});
		expect(id).toBeTruthy();
		const card = getTask(db, id as string);
		expect(card?.status).toBe("working");
		expect(card?.title).toBe("Daily lead sweep");
		expect(card?.body).toBe("sweep the leads");
		expect(card?.session_id).toBe("cron-job-1-1000");
		expect(card?.created_by).toBe(cronCreatedBy("job-1"));
		expect(card?.agent_name).toBe("cron");
	});

	test("re-fire reuses the SAME card and resets it for the new run", () => {
		const db = freshDb();
		const id1 = upsertCronCard(db, {
			jobId: "job-1",
			jobName: "Daily lead sweep",
			sessionId: "cron-job-1-1000",
		});
		// First run finished: card carries evidence + an approval link.
		updateTask(db, id1 as string, {
			status: "done",
			evidence: "did the thing",
			approval_id: "appr-9",
		});

		const id2 = upsertCronCard(db, {
			jobId: "job-1",
			jobName: "Daily lead sweep",
			sessionId: "cron-job-1-2000",
		});
		expect(id2).toBe(id1); // same durable card, no duplicate
		const card = getTask(db, id1 as string);
		expect(card?.status).toBe("working"); // flipped back for the new run
		expect(card?.session_id).toBe("cron-job-1-2000"); // re-pointed
		expect(card?.evidence).toBeNull(); // proof reset
		expect(card?.error).toBeNull();
		expect(card?.approval_id).toBeNull(); // stale approval link cleared
		// Exactly one card for the job.
		expect(getCronCard(db, "job-1")?.id).toBe(id1 as string);
	});

	test("fail-open: broken db calls onError, no throw", () => {
		const db = freshDb();
		db.close();
		let saw = false;
		expect(() =>
			upsertCronCard(
				db,
				{ jobId: "job-1", jobName: "x", sessionId: "s" },
				() => {
					saw = true;
				},
			),
		).not.toThrow();
		expect(saw).toBe(true);
	});
});

describe("advanceCardOnVerdict", () => {
	function workingCronCard(db: Database, sessionId: string) {
		const id = upsertCronCard(db, {
			jobId: "job-1",
			jobName: "Daily lead sweep",
			sessionId,
		});
		return id as string;
	}

	test("ok → done with the verdict summary as evidence", () => {
		const db = freshDb();
		const id = workingCronCard(db, "cron-job-1-1000");
		const status = advanceCardOnVerdict(
			db,
			"cron-job-1-1000",
			"ok",
			"Autonomous run ok — 3 tool call(s)",
		);
		expect(status).toBe("done");
		const card = getTask(db, id);
		expect(card?.status).toBe("done");
		expect(card?.evidence).toContain("ok");
	});

	test("suspect → blocked", () => {
		const db = freshDb();
		const id = workingCronCard(db, "cron-job-1-1000");
		expect(
			advanceCardOnVerdict(db, "cron-job-1-1000", "suspect", "phantom success"),
		).toBe("blocked");
		expect(getTask(db, id)?.error).toContain("phantom");
	});

	test("error → failed", () => {
		const db = freshDb();
		const id = workingCronCard(db, "cron-job-1-1000");
		expect(
			advanceCardOnVerdict(db, "cron-job-1-1000", "error", "2 tool errors"),
		).toBe("failed");
		expect(getTask(db, id)?.status).toBe("failed");
	});

	test("null verdict → blocked (can't confirm success)", () => {
		const db = freshDb();
		const id = workingCronCard(db, "cron-job-1-1000");
		expect(
			advanceCardOnVerdict(db, "cron-job-1-1000", null, "no verdict"),
		).toBe("blocked");
		expect(getTask(db, id)?.status).toBe("blocked");
	});

	test("a needs_approval card is left to the approval lane (no-op)", () => {
		const db = freshDb();
		const id = workingCronCard(db, "cron-job-1-1000");
		updateTask(db, id, { status: "needs_approval", approval_id: "appr-1" });
		expect(advanceCardOnVerdict(db, "cron-job-1-1000", "ok", "ok")).toBeNull();
		expect(getTask(db, id)?.status).toBe("needs_approval");
	});

	test("no card for the session → no-op (null)", () => {
		const db = freshDb();
		expect(advanceCardOnVerdict(db, "cron-ghost-1", "ok", "ok")).toBeNull();
	});

	test("fail-open: broken db calls onError, no throw", () => {
		const db = freshDb();
		db.close();
		let saw = false;
		expect(() =>
			advanceCardOnVerdict(db, "s", "ok", "ok", () => {
				saw = true;
			}),
		).not.toThrow();
		expect(saw).toBe(true);
	});
});

describe("failCronCard", () => {
	test("fails the job's card by job id", () => {
		const db = freshDb();
		const id = upsertCronCard(db, {
			jobId: "job-1",
			jobName: "x",
			sessionId: "cron-job-1-1000",
		}) as string;
		failCronCard(db, "job-1", "scheduler boom");
		const card = getTask(db, id);
		expect(card?.status).toBe("failed");
		expect(card?.error).toContain("boom");
	});

	test("does not fail a needs_approval card (approval lane owns it)", () => {
		const db = freshDb();
		const id = upsertCronCard(db, {
			jobId: "job-1",
			jobName: "x",
			sessionId: "cron-job-1-1000",
		}) as string;
		updateTask(db, id, { status: "needs_approval", approval_id: "appr-1" });
		failCronCard(db, "job-1", "boom");
		expect(getTask(db, id)?.status).toBe("needs_approval");
	});

	test("no card for the job → no-op", () => {
		const db = freshDb();
		expect(() => failCronCard(db, "ghost", "boom")).not.toThrow();
	});
});

describe("full cron-card cycle", () => {
	test("upsert(working) → ok→done → re-fire resets to working", () => {
		const db = freshDb();
		const id = upsertCronCard(db, {
			jobId: "job-1",
			jobName: "Daily lead sweep",
			sessionId: "cron-job-1-1000",
		}) as string;
		expect(getTask(db, id)?.status).toBe("working");

		advanceCardOnVerdict(db, "cron-job-1-1000", "ok", "ok summary");
		expect(getTask(db, id)?.status).toBe("done");
		expect(getTask(db, id)?.evidence).toBeTruthy();

		// Next fire — same card, fresh run.
		upsertCronCard(db, {
			jobId: "job-1",
			jobName: "Daily lead sweep",
			sessionId: "cron-job-1-2000",
		});
		const card = getTask(db, id);
		expect(card?.status).toBe("working");
		expect(card?.evidence).toBeNull();
	});
});
