import type { Database } from "bun:sqlite";

/**
 * The objective ledger — Paw's persistent task board (`agent_work` table).
 *
 * This module is the single home of the **verification gate**: any write that
 * moves a task to `status='done'` with empty/whitespace `evidence` throws a
 * `TaskError`. Both the agent tools (`task_update`) and any future UI inherit
 * the gate by going through `updateTask` / `move`.
 */

/**
 * The synthetic `parentSessionId` a card's Start uses when delegating, so the
 * `agent:delegated` event (which carries parentSessionId) can be resolved back
 * to the card. Shared by the Start route and the kernel auto-advance subscriber.
 */
export const TASK_RUN_PREFIX = "task-";

export type TaskStatus =
	| "backlog"
	| "queued"
	| "working"
	| "needs_approval"
	| "blocked"
	| "done"
	| "failed";

export type TaskPriority = "low" | "normal" | "high";

export interface AgentWork {
	id: string;
	title: string;
	body: string | null;
	status: TaskStatus;
	priority: TaskPriority;
	due_at: string | null;
	evidence: string | null;
	approval_id: string | null;
	session_id: string | null;
	agent_name: string | null;
	error: string | null;
	position: number;
	last_escalated_at: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

/** Thrown when a ledger invariant is violated (e.g. done without evidence). */
export class TaskError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TaskError";
	}
}

/**
 * THE GATE. A task may only be marked `done` with real evidence (a re-query
 * result, a diff, a URL — anything that proves the work landed). `failed` may
 * carry an `error` but never `evidence`. Centralized so the tool and any UI
 * both inherit it. Call with the *resulting* status + evidence after a merge.
 */
function assertDoneHasEvidence(
	status: TaskStatus | undefined,
	evidence: string | null | undefined,
): void {
	if (status === "done" && !(evidence && evidence.trim().length > 0)) {
		throw new TaskError("done requires evidence");
	}
}

/** Thrown when a status change isn't a legal column transition (Phase 2a). */
export class TransitionError extends Error {
	constructor(from: TaskStatus, to: TaskStatus) {
		super(`illegal transition: ${from} → ${to}`);
		this.name = "TransitionError";
	}
}

// The board state machine. Same-status (reorder) is always allowed and handled
// by the caller. `queued→working` is legal but Start-only (the drag route
// additionally refuses dragging into `working`). `done` is terminal.
const LEGAL_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
	backlog: ["queued"],
	queued: ["backlog", "working"],
	working: ["needs_approval", "done", "failed", "blocked"],
	needs_approval: ["working", "done", "failed", "blocked"],
	blocked: ["queued"],
	failed: ["queued"],
	done: [],
};

export function isLegalTransition(from: TaskStatus, to: TaskStatus): boolean {
	if (from === to) return true; // same-column reorder
	return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertLegalTransition(from: TaskStatus, to: TaskStatus): void {
	if (!isLegalTransition(from, to)) throw new TransitionError(from, to);
}

export interface CreateTaskInput {
	title: string;
	body?: string | null;
	priority?: TaskPriority;
	due_at?: string | null;
	session_id?: string | null;
	agent_name?: string | null;
	created_by?: string | null;
}

export function createTask(db: Database, input: CreateTaskInput): AgentWork {
	const id = crypto.randomUUID();
	db.run(
		`INSERT INTO agent_work (id, title, body, priority, due_at, session_id, agent_name, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.title,
			input.body ?? null,
			input.priority ?? "normal",
			input.due_at ?? null,
			input.session_id ?? null,
			input.agent_name ?? null,
			input.created_by ?? null,
		],
	);
	const row = getTask(db, id);
	if (!row) throw new TaskError("failed to create task");
	return row;
}

export function getTask(db: Database, id: string): AgentWork | null {
	return db
		.query<AgentWork, [string]>("SELECT * FROM agent_work WHERE id = ?")
		.get(id);
}

export function listByStatus(db: Database, status: TaskStatus): AgentWork[] {
	return db
		.query<AgentWork, [string]>(
			"SELECT * FROM agent_work WHERE status = ? ORDER BY position ASC, created_at ASC",
		)
		.all(status);
}

export function listAll(db: Database): AgentWork[] {
	return db
		.query<AgentWork, []>(
			"SELECT * FROM agent_work ORDER BY status ASC, position ASC, created_at ASC",
		)
		.all();
}

/** Tasks owned by a session (the run-verdict scopes these to the run window). */
export function listBySession(db: Database, sessionId: string): AgentWork[] {
	return db
		.query<AgentWork, [string]>(
			"SELECT * FROM agent_work WHERE session_id = ? ORDER BY created_at ASC",
		)
		.all(sessionId);
}

/** First task linked to a run session — the card↔run link for auto-advance. */
export function getBySession(
	db: Database,
	sessionId: string,
): AgentWork | null {
	return db
		.query<AgentWork, [string]>(
			"SELECT * FROM agent_work WHERE session_id = ? ORDER BY created_at ASC LIMIT 1",
		)
		.get(sessionId);
}

// --- Lifecycle reactors (Phase 2a auto-advance) -----------------------------
// These react to agent:delegated / agent:completed bus events. They are
// intentionally FAIL-OPEN (try/catch, never throw, optional onError) — a card
// move must NEVER break or delay the agent run that already happened. The kernel
// subscriber calls these; they're exported so the matrix is unit-testable
// without booting the kernel/bus.

/**
 * Link a card to its real child session when its run is delegated. Start used a
 * synthetic `parentSessionId = "task-<cardId>"`; on `agent:delegated` we re-point
 * the card's `session_id` to the actual child session and ensure it's `working`.
 */
export function linkCardOnDelegation(
	db: Database,
	parentSessionId: string,
	agentSessionId: string,
	onError?: (err: unknown) => void,
): void {
	try {
		if (!parentSessionId.startsWith(TASK_RUN_PREFIX)) return;
		const cardId = parentSessionId.slice(TASK_RUN_PREFIX.length);
		if (!getTask(db, cardId)) return;
		updateTask(db, cardId, { session_id: agentSessionId, status: "working" });
	} catch (err) {
		onError?.(err);
	}
}

/**
 * Advance a card when its run completes. The evidence gate is sacred:
 * - error → `failed` (with the error).
 * - ok + evidence (the agent set it via task_update mid-run) → `done` (gated move).
 * - ok + NO evidence → `blocked` — a finished run that didn't prove its work does
 *   NOT get a green card for free.
 * Returns the resulting status, or null (no card / swallowed error).
 */
export function advanceCardOnCompletion(
	db: Database,
	agentSessionId: string,
	ok: boolean,
	error?: string,
	onError?: (err: unknown) => void,
): TaskStatus | null {
	try {
		const card = getBySession(db, agentSessionId);
		if (!card) return null;
		if (!ok) {
			updateTask(db, card.id, {
				status: "failed",
				error: error ?? "agent run failed",
			});
			return "failed";
		}
		if (card.evidence && card.evidence.trim().length > 0) {
			move(db, card.id, "done", card.position); // gated — evidence present
			return "done";
		}
		updateTask(db, card.id, {
			status: "blocked",
			error: "run completed without evidence",
		});
		return "blocked";
	} catch (err) {
		onError?.(err);
		return null;
	}
}

export interface UpdateTaskInput {
	title?: string;
	body?: string | null;
	priority?: TaskPriority;
	due_at?: string | null;
	status?: TaskStatus;
	evidence?: string | null;
	error?: string | null;
	session_id?: string | null;
	agent_name?: string | null;
}

/**
 * Patch any subset of mutable fields. Enforces the verification gate against
 * the *resulting* state: if the row ends up `done`, it must have evidence
 * (either supplied in this call or already present).
 */
export function updateTask(
	db: Database,
	id: string,
	patch: UpdateTaskInput,
): AgentWork | null {
	const current = getTask(db, id);
	if (!current) return null;

	const nextStatus = patch.status ?? current.status;
	const nextEvidence =
		patch.evidence !== undefined ? patch.evidence : current.evidence;
	assertDoneHasEvidence(nextStatus, nextEvidence);

	const sets: string[] = [];
	const values: (string | number | null)[] = [];
	const set = (col: string, val: string | number | null) => {
		sets.push(`${col} = ?`);
		values.push(val);
	};

	if (patch.title !== undefined) set("title", patch.title);
	if (patch.body !== undefined) set("body", patch.body);
	if (patch.priority !== undefined) set("priority", patch.priority);
	if (patch.due_at !== undefined) set("due_at", patch.due_at);
	if (patch.status !== undefined) set("status", patch.status);
	if (patch.evidence !== undefined) set("evidence", patch.evidence);
	if (patch.error !== undefined) set("error", patch.error);
	if (patch.session_id !== undefined) set("session_id", patch.session_id);
	if (patch.agent_name !== undefined) set("agent_name", patch.agent_name);

	if (sets.length === 0) return current;

	sets.push("updated_at = datetime('now')");
	values.push(id);
	db.run(`UPDATE agent_work SET ${sets.join(", ")} WHERE id = ?`, values);
	return getTask(db, id);
}

/** Move a task to a column/position (Phase-1: programmatic; Phase-2 wires DnD). */
export function move(
	db: Database,
	id: string,
	status: TaskStatus,
	position: number,
): AgentWork | null {
	const current = getTask(db, id);
	if (!current) return null;
	// Validate the column transition (reorder within a column is allowed), then
	// the evidence gate for done. Both throw; callers map to 400.
	assertLegalTransition(current.status, status);
	assertDoneHasEvidence(status, current.evidence);
	db.run(
		"UPDATE agent_work SET status = ?, position = ?, updated_at = datetime('now') WHERE id = ?",
		[status, position, id],
	);
	return getTask(db, id);
}

/**
 * Rows worth interrupting the owner about: blocked OR past-deadline (and not
 * already finished), excluding any escalated within the last `dedupeHours`
 * so the valve doesn't re-fire every tick. `now` is an ISO timestamp.
 */
export function listEscalatable(
	db: Database,
	now: string,
	dedupeHours = 6,
): AgentWork[] {
	const cutoff = new Date(
		Date.parse(now) - dedupeHours * 60 * 60 * 1000,
	).toISOString();
	return db
		.query<AgentWork, [string, string]>(
			`SELECT * FROM agent_work
       WHERE (
         status = 'blocked'
         OR (due_at IS NOT NULL AND due_at < ? AND status NOT IN ('done','failed'))
       )
       AND (last_escalated_at IS NULL OR last_escalated_at < ?)
       ORDER BY due_at ASC`,
		)
		.all(now, cutoff);
}

/** Stamp `last_escalated_at` so an escalated row is not re-notified next tick. */
export function markEscalated(db: Database, id: string, now: string): void {
	db.run("UPDATE agent_work SET last_escalated_at = ? WHERE id = ?", [now, id]);
}
