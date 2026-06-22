import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

interface TasksPageProps {
	/** Asset version for cache-busting the static board module. */
	assetVersion?: string;
	/** Route this page is mounted at, for the sidebar nav active-state. */
	currentPath?: string;
}

/**
 * Objective ledger board — read-only (Phase 1). Renders the task columns from
 * the live `/api/tasks/feed` via the vanilla `board.js` module (real file under
 * /tasks/static, never an inline template string). No drag-and-drop this phase.
 * The board surfaces deadlines (overdue badge) and the evidence backing Done
 * cards so "done" is visibly proof-backed.
 */
export const TasksPage: FC<TasksPageProps> = ({
	assetVersion = "",
	currentPath = "/tasks",
}) => {
	const v = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : "";
	return (
		<Layout title="Tasks" currentPath={currentPath}>
			{raw(`<link rel="stylesheet" href="/tasks/static/board.css${v}">`)}
			<div class="panel">
				<div class="panel-hd">
					<span class="ttl">Objective ledger</span>
					<span class="meta" id="tasks-status">
						Loading…
					</span>
				</div>
				<div class="panel-bd tight">
					<div id="tasks-board" class="tasks-board" />
				</div>
			</div>
			{raw(`<script src="/tasks/static/board.js${v}"></script>`)}
			{raw(`<script>(function(){
  if (window.TasksBoard) {
    window.TasksBoard.start(document.getElementById("tasks-board"), document.getElementById("tasks-status"));
  }
})();</script>`)}
		</Layout>
	);
};
