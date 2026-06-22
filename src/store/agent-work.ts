import type { Database } from "bun:sqlite";

/**
 * The objective ledger — Paw's persistent task board (`agent_work` table).
 *
 * This module is the single home of the **verification gate**: any write that
 * moves a task to `status='done'` with empty/whitespace `evidence` throws a
 * `TaskError`. Both the agent tools (`task_update`) and any future UI inherit
 * the gate by going through `updateTask` / `move`.
 */

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

export interface UpdateTaskInput {
	title?: string;
	body?: string | null;
	priority?: TaskPriority;
	due_at?: string | null;
	status?: TaskStatus;
	evidence?: string | null;
	error?: string | null;
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
