import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createTask, getTask, updateTask } from "../../src/store/agent-work.js";
import { createTaskRoutes } from "../../src/web/routes/tasks-actions.js";

type TestApp = Hono<{ Variables: { admin: { id: number } } }>;

async function post(
	app: TestApp,
	path: string,
	body?: unknown,
): Promise<Response> {
	return app.request(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
}

describe("task board mutation routes", () => {
	let db: Database;
	let delegateCalls: Array<{ parentSessionId: string; turn: string }>;
	let delegateReturns: string | null;

	beforeEach(() => {
		db = new Database(":memory:");
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
		delegateCalls = [];
		delegateReturns = "default"; // pretend one agent is configured
	});

	afterEach(() => db.close());

	function routes() {
		return createTaskRoutes({
			db,
			delegate: (parentSessionId, turn) => {
				delegateCalls.push({ parentSessionId, turn });
				return delegateReturns;
			},
		});
	}

	function appWith(admin: { id: number } | null): TestApp {
		const app = new Hono<{ Variables: { admin: { id: number } } }>();
		if (admin) {
			app.use("*", async (c, next) => {
				c.set("admin", admin);
				await next();
			});
		}
		app.route("/", routes());
		return app;
	}

	describe("auth", () => {
		it("refuses anonymous POSTs with 401", async () => {
			const anon = appWith(null);
			const t = createTask(db, { title: "x" });
			for (const p of [
				["/api/tasks", {}],
				[`/api/tasks/${t.id}/start`, {}],
				[`/api/tasks/${t.id}/move`, { status: "queued" }],
				[`/api/tasks/${t.id}/retry`, {}],
			] as const) {
				const res = await post(anon, p[0], p[1]);
				expect(res.status).toBe(401);
			}
		});
	});

	describe("start = delegate (one agent per card)", () => {
		it("delegates once, stores session_id, moves to working", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "ship it" });
			updateTask(db, t.id, { status: "queued" });

			const res = await post(app, `/api/tasks/${t.id}/start`);
			expect(res.status).toBe(200);
			expect(delegateCalls.length).toBe(1);
			expect(delegateCalls[0]?.parentSessionId).toBe(`task-${t.id}`);
			expect(delegateCalls[0]?.turn).toContain("ship it");
			const card = getTask(db, t.id);
			expect(card?.status).toBe("working");
			expect(card?.session_id).toBe(`task-${t.id}`);
			expect(card?.agent_name).toBe("default");
		});

		it("turn carries the card-context preamble: card id + done & blocked paths", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "ship it" });
			updateTask(db, t.id, { status: "queued" });

			await post(app, `/api/tasks/${t.id}/start`);
			const turn = delegateCalls[0]?.turn ?? "";
			// The exact card id is interpolated so task_update targets THIS card.
			expect(turn).toContain(t.id);
			// Happy path: close with done + evidence.
			expect(turn).toContain('status: "done"');
			expect(turn).toContain("evidence");
			// Blocked fallback path — NEW in 2a.1; the #183 turn had no blocked
			// guidance, so this anchor fails on pre-change code.
			expect(turn).toContain('status: "blocked"');
			// The card body still rides the turn.
			expect(turn).toContain("ship it");
		});

		it("refuses a second start on the same card (409)", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" });
			updateTask(db, t.id, { status: "queued" });
			expect((await post(app, `/api/tasks/${t.id}/start`)).status).toBe(200);
			const second = await post(app, `/api/tasks/${t.id}/start`);
			expect(second.status).toBe(409);
			expect(delegateCalls.length).toBe(1); // not delegated twice
		});

		it("refuses starting a non-queued card (409)", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" }); // backlog
			expect((await post(app, `/api/tasks/${t.id}/start`)).status).toBe(409);
		});

		it("rolls back + 400s when no agent is configured", async () => {
			delegateReturns = null;
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" });
			updateTask(db, t.id, { status: "queued" });
			const res = await post(app, `/api/tasks/${t.id}/start`);
			expect(res.status).toBe(400);
			const card = getTask(db, t.id);
			expect(card?.status).toBe("queued"); // rolled back
			expect(card?.session_id).toBeNull();
		});
	});

	describe("move (drag)", () => {
		it("refuses dragging into working (400) — Start only", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" });
			updateTask(db, t.id, { status: "queued" });
			const res = await post(app, `/api/tasks/${t.id}/move`, {
				status: "working",
			});
			expect(res.status).toBe(400);
			expect(getTask(db, t.id)?.status).toBe("queued");
		});

		it("allows a legal drag backlog→queued", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" }); // backlog
			const res = await post(app, `/api/tasks/${t.id}/move`, {
				status: "queued",
				position: 0,
			});
			expect(res.status).toBe(200);
			expect(getTask(db, t.id)?.status).toBe("queued");
		});

		it("rejects an illegal jump with 400", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" }); // backlog
			const res = await post(app, `/api/tasks/${t.id}/move`, {
				status: "done",
			});
			expect(res.status).toBe(400);
		});
	});

	describe("retry", () => {
		it("failed→queued clears session_id + agent_name", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" });
			updateTask(db, t.id, {
				status: "failed",
				session_id: "agent-x-1",
				agent_name: "default",
				error: "boom",
			});
			const res = await post(app, `/api/tasks/${t.id}/retry`);
			expect(res.status).toBe(200);
			const card = getTask(db, t.id);
			expect(card?.status).toBe("queued");
			expect(card?.session_id).toBeNull();
			expect(card?.agent_name).toBeNull();
			expect(card?.error).toBeNull();
		});

		it("refuses retry on a non-blocked/failed card (409)", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" }); // backlog
			expect((await post(app, `/api/tasks/${t.id}/retry`)).status).toBe(409);
		});
	});

	describe("resume (help-leash)", () => {
		it("refuses anonymous resume with 401", async () => {
			const anon = appWith(null);
			const t = createTask(db, { title: "x" });
			updateTask(db, t.id, { status: "blocked", block_kind: "needs_feedback" });
			const res = await post(anon, `/api/tasks/${t.id}/resume`, { note: "hi" });
			expect(res.status).toBe(401);
		});

		it("404s an unknown card", async () => {
			const app = appWith({ id: 1 });
			expect(
				(await post(app, "/api/tasks/nope/resume", { note: "x" })).status,
			).toBe(404);
		});

		it("refuses resuming a non-blocked card (409)", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" }); // backlog
			expect(
				(await post(app, `/api/tasks/${t.id}/resume`, { note: "x" })).status,
			).toBe(409);
		});

		it("refuses a needs_capability block — a note can't add a capability (409)", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" });
			updateTask(db, t.id, {
				status: "blocked",
				block_kind: "needs_capability",
			});
			const res = await post(app, `/api/tasks/${t.id}/resume`, { note: "x" });
			expect(res.status).toBe(409);
			// Untouched: still blocked, no note stored.
			const card = getTask(db, t.id);
			expect(card?.status).toBe("blocked");
			expect(card?.operator_note).toBeNull();
		});

		it("board card: persists the note, re-delegates, and folds it into the turn", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "ship it" });
			updateTask(db, t.id, {
				status: "blocked",
				block_kind: "needs_feedback",
				session_id: "task-old",
				agent_name: "default",
				error: "which region?",
			});
			const res = await post(app, `/api/tasks/${t.id}/resume`, {
				note: "use the us-east region",
			});
			expect(res.status).toBe(200);
			// Re-delegated like Start, with the operator feedback in the turn.
			expect(delegateCalls.length).toBe(1);
			expect(delegateCalls[0]?.turn).toContain(
				"Operator feedback: use the us-east region",
			);
			expect(delegateCalls[0]?.turn).toContain("ship it");
			const card = getTask(db, t.id);
			expect(card?.status).toBe("working");
			expect(card?.operator_note).toBe("use the us-east region");
			expect(card?.block_kind).toBeNull();
			expect(card?.error).toBeNull();
		});

		it("cron card: persists the note and queues WITHOUT delegating", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, {
				title: "Daily sweep",
				created_by: "cron:job-1",
			});
			updateTask(db, t.id, { status: "blocked", block_kind: "needs_feedback" });
			const res = await post(app, `/api/tasks/${t.id}/resume`, {
				note: "use v2",
			});
			expect(res.status).toBe(200);
			// Cron cards re-run on schedule — no delegation here.
			expect(delegateCalls.length).toBe(0);
			const card = getTask(db, t.id);
			expect(card?.status).toBe("queued");
			expect(card?.operator_note).toBe("use v2");
			expect(card?.block_kind).toBeNull();
		});

		it("an empty note resumes too (note stored as null)", async () => {
			const app = appWith({ id: 1 });
			const t = createTask(db, { title: "x" });
			updateTask(db, t.id, { status: "blocked", block_kind: "needs_feedback" });
			const res = await post(app, `/api/tasks/${t.id}/resume`, { note: "  " });
			expect(res.status).toBe(200);
			expect(getTask(db, t.id)?.operator_note).toBeNull();
		});
	});
});
