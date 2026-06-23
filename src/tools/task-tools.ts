import type { Database } from "bun:sqlite";
import {
	type BlockKind,
	type CreateTaskInput,
	TaskError,
	type TaskPriority,
	type TaskStatus,
	type UpdateTaskInput,
	createTask,
	getTask,
	listAll,
	listByStatus,
	updateTask,
} from "../store/agent-work.js";
import type { ToolDefinition, ToolResult } from "../types/message.js";

interface TaskToolsConfig {
	database: Database;
}

const STATUS_VALUES: TaskStatus[] = [
	"backlog",
	"queued",
	"working",
	"needs_approval",
	"blocked",
	"done",
	"failed",
];
const PRIORITY_VALUES: TaskPriority[] = ["low", "normal", "high"];
const BLOCK_KIND_VALUES: BlockKind[] = [
	"needs_feedback",
	"needs_access",
	"needs_capability",
];

function ok(data: unknown): ToolResult {
	return { content: JSON.stringify(data) };
}

/**
 * The agent's window into its own objective ledger (`agent_work`). These tools
 * are kernel-owned (`plugin: "kernel"`) and grouped under the on-demand `tasks`
 * skill — the agent activates it when managing its work. The Done gate lives in
 * `src/store/agent-work.ts`; `task_update` surfaces a refusal as `is_error`
 * (never a silent success) so the model is told to supply proof.
 */
export function createTaskTools(config: TaskToolsConfig): ToolDefinition[] {
	const db = config.database;

	const taskCreate: ToolDefinition = {
		name: "task_create",
		description:
			"Create a task in your persistent objective ledger (the task board). Use this to record an objective so it survives across runs. Returns the new task id.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				title: { type: "string", description: "Short task title" },
				body: { type: "string", description: "Markdown detail (optional)" },
				priority: {
					type: "string",
					enum: PRIORITY_VALUES,
					description: "Priority (default 'normal')",
				},
				due_at: {
					type: "string",
					description: "ISO deadline (optional). Omit for no deadline.",
				},
				session_id: {
					type: "string",
					description: "The run that owns this task (optional)",
				},
			},
			required: ["title"],
		},
		handler: async (input): Promise<ToolResult> => {
			const title = String(input.title ?? "").trim();
			if (!title)
				return { content: "Error: title is required", is_error: true };
			const created: CreateTaskInput = {
				title,
				body: input.body !== undefined ? String(input.body) : null,
				priority: input.priority as TaskPriority | undefined,
				due_at: input.due_at !== undefined ? String(input.due_at) : null,
				session_id:
					input.session_id !== undefined ? String(input.session_id) : null,
			};
			const task = createTask(db, created);
			return ok({ id: task.id, status: task.status });
		},
	};

	const taskList: ToolDefinition = {
		name: "task_list",
		description:
			"List tasks from your objective ledger. Filter by status, or pass overdue:true for past-deadline tasks that aren't done/failed.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				status: {
					type: "string",
					enum: STATUS_VALUES,
					description: "Filter to one status column (optional)",
				},
				overdue: {
					type: "boolean",
					description: "Only tasks past their due_at and not done/failed",
				},
			},
		},
		handler: async (input): Promise<ToolResult> => {
			let tasks = input.status
				? listByStatus(db, input.status as TaskStatus)
				: listAll(db);
			if (input.overdue) {
				const now = new Date().toISOString();
				tasks = tasks.filter(
					(t) =>
						t.due_at !== null &&
						t.due_at < now &&
						t.status !== "done" &&
						t.status !== "failed",
				);
			}
			return ok({ tasks });
		},
	};

	const taskGet: ToolDefinition = {
		name: "task_get",
		description: "Get a single task by id from your objective ledger.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Task id" },
			},
			required: ["id"],
		},
		handler: async (input): Promise<ToolResult> => {
			const task = getTask(db, String(input.id));
			if (!task)
				return {
					content: `Error: task not found: ${input.id}`,
					is_error: true,
				};
			return ok({ task });
		},
	};

	const taskUpdate: ToolDefinition = {
		name: "task_update",
		description:
			"Update a task: change status, set evidence, due_at, priority, error, title, or body. IMPORTANT: marking a task 'done' REQUIRES evidence — pass the proof the work landed (a re-query result, a diff, or a URL). A done with no evidence is refused. When you set status to 'blocked', ALSO pass block_kind so the operator knows how to help: 'needs_feedback' (a decision or non-secret detail would unblock you), 'needs_access' (you're missing a credential or permission), or 'needs_capability' (a required tool/feature doesn't exist).",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Task id" },
				status: { type: "string", enum: STATUS_VALUES },
				evidence: {
					type: "string",
					description:
						"Verification artifact proving the work landed — required to mark done.",
				},
				due_at: { type: "string", description: "ISO deadline" },
				priority: { type: "string", enum: PRIORITY_VALUES },
				error: { type: "string", description: "Failure detail (for 'failed')" },
				block_kind: {
					type: "string",
					enum: BLOCK_KIND_VALUES,
					description:
						"Why the task is blocked (set with status:'blocked'): needs_feedback | needs_access | needs_capability.",
				},
				title: { type: "string" },
				body: { type: "string" },
			},
			required: ["id"],
		},
		handler: async (input): Promise<ToolResult> => {
			const patch: UpdateTaskInput = {};
			if (input.status !== undefined) patch.status = input.status as TaskStatus;
			if (input.evidence !== undefined) patch.evidence = String(input.evidence);
			if (input.due_at !== undefined) patch.due_at = String(input.due_at);
			if (input.priority !== undefined)
				patch.priority = input.priority as TaskPriority;
			if (input.error !== undefined) patch.error = String(input.error);
			if (input.block_kind !== undefined)
				patch.block_kind = input.block_kind as BlockKind;
			if (input.title !== undefined) patch.title = String(input.title);
			if (input.body !== undefined) patch.body = String(input.body);

			try {
				const task = updateTask(db, String(input.id), patch);
				if (!task)
					return {
						content: `Error: task not found: ${input.id}`,
						is_error: true,
					};
				return ok({ task });
			} catch (err) {
				if (err instanceof TaskError) {
					return {
						content:
							"Refused: marking a task 'done' requires evidence. Re-call task_update with evidence proving the work landed — a re-query result, a diff, or a URL.",
						is_error: true,
					};
				}
				throw err;
			}
		},
	};

	return [taskCreate, taskList, taskGet, taskUpdate];
}
