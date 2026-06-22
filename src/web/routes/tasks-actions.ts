import type { Database } from "bun:sqlite";
import { type Context, Hono } from "hono";
import {
	TASK_RUN_PREFIX,
	TaskError,
	type TaskPriority,
	type TaskStatus,
	TransitionError,
	createTask,
	getTask,
	move,
	updateTask,
} from "../../store/agent-work.js";

// Live task-board mutations (Phase 2a), extracted from createWebApp so they can
// be driven by app-level tests (Hono `app.request`) with an in-memory DB and a
// stubbed delegate. NOT in PUBLIC_PREFIXES → the global auth middleware already
// gates them; each handler ALSO refuses anon (defense-in-depth + unit-testable).
// "Start" reuses the existing delegation path (kernel.runAgentTurn) via the
// injected `delegate`; the card↔run link is parentSessionId = "task-<id>".

export interface TaskRoutesDeps {
	db: Database;
	/**
	 * Kick off a delegated run for a card (fire-and-forget). Returns the chosen
	 * agent name, or null if no agent is configured. Injected by app.ts to wrap
	 * kernel.runAgentTurn so this module stays kernel-free + testable.
	 */
	delegate: (parentSessionId: string, turnText: string) => string | null;
	audit?: (
		action: string,
		userId: number | null,
		details: Record<string, unknown>,
		ip?: string,
	) => void;
	getClientIp?: (c: Context) => string;
}

const VALID_PRIORITIES: TaskPriority[] = ["low", "normal", "high"];

export function createTaskRoutes(deps: TaskRoutesDeps): Hono {
	const { db, delegate, audit, getClientIp } = deps;
	const app = new Hono();

	// "admin" is set by the auth middleware; read via c.var to avoid the repo's
	// known untyped-Variables overload-error class.
	const adminId = (c: Context): number | null =>
		(c.var as unknown as { admin?: { id: number } }).admin?.id ?? null;
	const ip = (c: Context): string | undefined => getClientIp?.(c);

	// Compose the turn handed to the agent: the card's title/body plus an explicit
	// instruction to prove completion via the evidence gate. If the agent never
	// sets evidence, auto-advance routes the run to `blocked`, not `done`.
	const turnFor = (id: string, title: string, body: string | null): string => {
		const base = body ? `${title}\n\n${body}` : title;
		return `${base}\n\n[Ledger task ${id}: when you have VERIFIABLY completed this, call task_update with id="${id}" and evidence (a re-query result, a diff, or a URL). Do not claim done without it.]`;
	};

	// Shared start logic: validate, link the card to a run, delegate. Returns a
	// hono JSON response. Rolls back the card if no agent is available.
	const startCard = (c: Context, id: string) => {
		const card = getTask(db, id);
		if (!card) return c.json({ error: "task not found" }, 404);
		if (card.status !== "queued")
			return c.json({ error: "task must be in 'queued' to start" }, 409);
		if (card.session_id)
			return c.json({ error: "task already has a run" }, 409);

		const parentSessionId = `${TASK_RUN_PREFIX}${id}`;
		// Link + move to working BEFORE delegating, so the delegated event resolves.
		updateTask(db, id, {
			session_id: parentSessionId,
			status: "working",
		});
		const agentName = delegate(
			parentSessionId,
			turnFor(id, card.title, card.body),
		);
		if (!agentName) {
			// No agent configured — undo the link so the card stays actionable.
			updateTask(db, id, { session_id: null, status: "queued" });
			return c.json(
				{ error: "no agent configured — add one in /config to start tasks" },
				400,
			);
		}
		updateTask(db, id, { agent_name: agentName });
		audit?.("task.start", adminId(c), { id, agentName }, ip(c));
		return c.json({ ok: true, id, agentName });
	};

	// Create a card, optionally starting it immediately.
	app.post("/api/tasks", async (c) => {
		if (adminId(c) === null) return c.json({ error: "Unauthorized" }, 401);
		const body = await c.req
			.json<{
				title?: string;
				body?: string;
				priority?: string;
				due_at?: string;
				start?: boolean;
			}>()
			.catch(() => ({}) as Record<string, never>);
		const title = (body.title ?? "").trim();
		if (!title) return c.json({ error: "title is required" }, 400);
		const priority =
			body.priority && VALID_PRIORITIES.includes(body.priority as TaskPriority)
				? (body.priority as TaskPriority)
				: "normal";
		const card = createTask(db, {
			title,
			body: body.body ? String(body.body) : null,
			priority,
			due_at: body.due_at ? String(body.due_at) : null,
		});
		audit?.("task.create", adminId(c), { id: card.id }, ip(c));
		if (body.start) {
			// Created cards land in `backlog`; promote to `queued` then start.
			updateTask(db, card.id, { status: "queued" });
			return startCard(c, card.id);
		}
		return c.json({ ok: true, id: card.id });
	});

	app.post("/api/tasks/:id/start", (c) => {
		if (adminId(c) === null) return c.json({ error: "Unauthorized" }, 401);
		return startCard(c, c.req.param("id"));
	});

	// Drag-and-drop / reorder. Refuses dragging into `working` (Start only) and
	// validates the transition + evidence gate via move().
	app.post("/api/tasks/:id/move", async (c) => {
		if (adminId(c) === null) return c.json({ error: "Unauthorized" }, 401);
		const id = c.req.param("id");
		const body = await c.req
			.json<{ status?: string; position?: number }>()
			.catch(() => ({}) as { status?: string; position?: number });
		const status = body.status as TaskStatus | undefined;
		if (!status) return c.json({ error: "status is required" }, 400);
		if (status === "working")
			return c.json({ error: "use Start to move a task to 'working'" }, 400);
		const position = Number.isFinite(body.position) ? Number(body.position) : 0;
		try {
			const updated = move(db, id, status, position);
			if (!updated) return c.json({ error: "task not found" }, 404);
			audit?.("task.move", adminId(c), { id, status }, ip(c));
			return c.json({ ok: true, task: updated });
		} catch (err) {
			if (err instanceof TransitionError || err instanceof TaskError)
				return c.json({ error: err.message }, 400);
			throw err;
		}
	});

	// Retry a blocked/failed card: back to queued, cleared for a fresh start.
	app.post("/api/tasks/:id/retry", (c) => {
		if (adminId(c) === null) return c.json({ error: "Unauthorized" }, 401);
		const id = c.req.param("id");
		const card = getTask(db, id);
		if (!card) return c.json({ error: "task not found" }, 404);
		if (card.status !== "blocked" && card.status !== "failed")
			return c.json({ error: "only blocked/failed tasks can be retried" }, 409);
		const updated = updateTask(db, id, {
			status: "queued",
			session_id: null,
			agent_name: null,
			error: null,
		});
		audit?.("task.retry", adminId(c), { id }, ip(c));
		return c.json({ ok: true, task: updated });
	});

	return app;
}
