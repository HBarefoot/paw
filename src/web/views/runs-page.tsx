import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

interface RunsPageProps {
	/** Asset version for cache-busting the static runs module. */
	assetVersion?: string;
	/** Route this page is mounted at, for the sidebar nav active-state. */
	currentPath?: string;
}

/** Run types (channel) the agent records — drives the type filter. */
const RUN_TYPES = ["web", "canvas", "slack", "cron", "system"];

/**
 * Run verdicts board — read-only (observability Phase 1). A dense table of
 * completed runs with a KPI summary strip and a filter toolbar (verdict / type /
 * search / time window). Verdict/type/search filter client-side over the loaded
 * window; the window is a server query param. Driven by the vanilla `runs.js`
 * module (real file under /runs/static, never an inline template string).
 */
export const RunsPage: FC<RunsPageProps> = ({
	assetVersion = "",
	currentPath = "/runs",
}) => {
	const v = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : "";
	return (
		<Layout title="Runs" currentPath={currentPath}>
			{raw(`<link rel="stylesheet" href="/runs/static/runs.css${v}">`)}

			{/* Summary strip — JS fills the numbers from the loaded window. */}
			<div class="kpi-strip cols-4 runs-kpis">
				<div class="kpi">
					<div class="k">Total runs</div>
					<div class="v" id="kpi-total">
						—
					</div>
				</div>
				<div class="kpi">
					<div class="k">Errors</div>
					<div class="v err" id="kpi-error">
						—
					</div>
				</div>
				<div class="kpi">
					<div class="k">Suspect</div>
					<div class="v warn" id="kpi-suspect">
						—
					</div>
				</div>
				<div class="kpi">
					<div class="k">OK</div>
					<div class="v ok" id="kpi-ok">
						—
					</div>
				</div>
			</div>

			<div class="panel">
				<div class="panel-hd">
					<span class="ttl">Run verdicts</span>
					<span class="meta" id="runs-status">
						Loading…
					</span>
				</div>

				{/* Filter toolbar — pinned above the scrolling table. */}
				<div class="runs-toolbar">
					<div class="seg" data-filter="verdict">
						<button type="button" class="on" data-val="all">
							All
						</button>
						<button type="button" data-val="error">
							Error
						</button>
						<button type="button" data-val="suspect">
							Suspect
						</button>
						<button type="button" data-val="ok">
							OK
						</button>
					</div>
					<div class="seg" data-filter="type">
						<button type="button" class="on" data-val="all">
							All types
						</button>
						{RUN_TYPES.map((t) => (
							<button type="button" data-val={t} key={t}>
								{t}
							</button>
						))}
					</div>
					<label class="search-box runs-search">
						{raw(
							`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
						)}
						<input
							type="text"
							id="runs-search"
							placeholder="Search claim text…"
							autocomplete="off"
						/>
					</label>
					<div class="seg runs-window" data-filter="window">
						<button type="button" data-val="24h">
							24h
						</button>
						<button type="button" class="on" data-val="7d">
							7d
						</button>
						<button type="button" data-val="all">
							All
						</button>
					</div>
				</div>

				<div class="panel-bd tight runs-scroll">
					<table class="tbl runs-tbl">
						<thead>
							<tr>
								<th>Verdict</th>
								<th>Type</th>
								<th>Claim</th>
								<th class="num">Tools</th>
								<th class="num">When</th>
							</tr>
						</thead>
						<tbody id="runs-tbody" />
					</table>
				</div>
			</div>

			{raw(`<script src="/runs/static/runs.js${v}"></script>`)}
			{raw(`<script>(function(){
  if (window.RunsBoard) { window.RunsBoard.start(); }
})();</script>`)}
		</Layout>
	);
};
