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
				agent_name TEXT, error TEXT, position INTEGER NOT NULL DEFAULT 0,
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
});
