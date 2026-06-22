import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

interface RunsPageProps {
	/** Asset version for cache-busting the static runs module. */
	assetVersion?: string;
	/** Route this page is mounted at, for the sidebar nav active-state. */
	currentPath?: string;
}

/**
 * Run verdicts board — read-only (observability Phase 1). Renders one card per
 * completed run, colored by deterministic verdict (ok / suspect / error), with
 * the claim preview, fired flags, and tool-call/error counts. Suspect & error
 * sort to the top. Driven by the vanilla `runs.js` module (real file under
 * /runs/static, never an inline template string), polling /api/runs/feed.
 */
export const RunsPage: FC<RunsPageProps> = ({
	assetVersion = "",
	currentPath = "/runs",
}) => {
	const v = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : "";
	return (
		<Layout title="Runs" currentPath={currentPath}>
			{raw(`<link rel="stylesheet" href="/runs/static/runs.css${v}">`)}
			<div class="panel">
				<div class="panel-hd">
					<span class="ttl">Run verdicts</span>
					<span class="meta" id="runs-status">
						Loading…
					</span>
				</div>
				<div class="panel-bd tight">
					<div id="runs-list" class="runs-list" />
				</div>
			</div>
			{raw(`<script src="/runs/static/runs.js${v}"></script>`)}
			{raw(`<script>(function(){
  if (window.RunsBoard) {
    window.RunsBoard.start(document.getElementById("runs-list"), document.getElementById("runs-status"));
  }
})();</script>`)}
		</Layout>
	);
};
