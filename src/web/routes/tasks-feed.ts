// Tasks board live feed — the read-only objective-ledger board behind /tasks.
// Pure + kernel-decoupled (mirrors ops-feed.ts): app.ts reads the rows from the
// store and hands them here; this shapes the JSON the client board.js polls.
//
// Phase 1 is read-only: no drag-and-drop, no reorder writes. The builder groups
// rows into status columns and stamps each card with an `overdue` flag so the
// view can badge past-deadline work without re-deriving "now" client-side.

import type {
	AgentWork,
	BlockKind,
	TaskStatus,
} from "../../store/agent-work.js";

/** Column order on the board (matches the design doc's kanban lanes). */
export const TASK_COLUMNS: TaskStatus[] = [
	"backlog",
	"queued",
	"working",
	"needs_approval",
	"blocked",
	"done",
	"failed",
];

export interface TaskCard {
	id: string;
	title: string;
	status: TaskStatus;
	priority: AgentWork["priority"];
	due_at: string | null;
	overdue: boolean;
	evidence: string | null;
	/** Set once a run is linked — the board uses it to show the running agent. */
	session_id: string | null;
	agent_name: string | null;
	error: string | null;
	/** Why a blocked card is blocked — drives the help-leash UI. */
	block_kind: BlockKind | null;
	/** The operator feedback last attached to this card (the help-leash). */
	operator_note: string | null;
	updated_at: string;
}

export interface TasksFeedResponse {
	columns: Record<string, TaskCard[]>;
	/** Monotonic-ish cursor so the client can cheaply detect "no change". */
	version: number;
}

function toCard(row: AgentWork, nowMs: number): TaskCard {
	const dueMs = row.due_at ? Date.parse(row.due_at) : Number.NaN;
	const overdue =
		!Number.isNaN(dueMs) &&
		dueMs < nowMs &&
		row.status !== "done" &&
		row.status !== "failed";
	return {
		id: row.id,
		title: row.title,
		status: row.status,
		priority: row.priority,
		due_at: row.due_at,
		overdue,
		evidence: row.evidence,
		session_id: row.session_id,
		agent_name: row.agent_name,
		error: row.error,
		block_kind: row.block_kind,
		operator_note: row.operator_note,
		updated_at: row.updated_at,
	};
}

/**
 * Build the board feed from raw ledger rows. `now` defaults to wall-clock but
 * is injectable for deterministic tests.
 */
export function buildTasksFeed(
	rows: AgentWork[],
	now: number = Date.now(),
): TasksFeedResponse {
	const columns: Record<string, TaskCard[]> = {};
	for (const status of TASK_COLUMNS) columns[status] = [];

	let version = 0;
	for (const row of rows) {
		// Defensive: an unknown status (shouldn't happen — DB CHECK) gets its
		// own bucket rather than being dropped.
		if (!columns[row.status]) columns[row.status] = [];
		columns[row.status].push(toCard(row, now));
		const t = Date.parse(row.updated_at);
		if (!Number.isNaN(t) && t > version) version = t;
	}
	return { columns, version };
}
