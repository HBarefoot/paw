import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

interface OpsPageProps {
	/** Active brand name (top-bar wordmark); falls back to "Agent Ops". */
	brand?: string | null;
	/** Current model id (top-bar chip until the live feed reports one). */
	model: string;
	/** Process uptime in ms at render (the top-bar "uptime" stat baseline). */
	uptimeMs: number;
}

/**
 * Agent Ops dashboard — the redesigned `/` page. A full-height dark/green
 * console rendered inside paw's Layout (like ChatPage): a `.ops-app` grid driven
 * by vanilla canvas modules served from `/ops/static/*` ('self'), reading paw's
 * real operation stream via `/api/ops/feed`. All visual logic lives in the
 * static modules; this view is just the mount node + asset tags + a tiny inline
 * bootstrap (cook-parse guarded — no regex / no backslash, per the #37 lesson).
 */
export const OpsPage: FC<OpsPageProps> = ({ brand, model, uptimeMs }) => {
	const cfg = JSON.stringify({
		brand: brand || null,
		model: model || "",
		uptimeMs,
	}).replace(/</g, "\\u003c");
	return (
		<Layout title="Agent Ops" currentPath="/">
			{raw(`<link rel="stylesheet" href="/ops/static/styles.css">`)}
			<div id="ops-root" class="ops-app" />
			{raw(`<script src="/ops/static/ui.js"></script>`)}
			{raw(`<script src="/ops/static/engine.js"></script>`)}
			{raw(`<script src="/ops/static/viz-stream.js"></script>`)}
			{raw(`<script src="/ops/static/shell.js"></script>`)}
			{raw(`<script>(function(){
  var c = document.querySelector(".content");
  if (c) { c.classList.add("ops-content"); c.classList.add("content-full"); }
  window.__OPS_CONFIG = ${cfg};
  if (window.AgentOps && window.OpsShell) {
    window.AgentOps.start();
    window.OpsShell.mount(document.getElementById("ops-root"), window.__OPS_CONFIG);
  }
})();</script>`)}
		</Layout>
	);
};
