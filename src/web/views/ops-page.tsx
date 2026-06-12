import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

interface OpsPageProps {
	/** Active brand accent (hex/rgb) — themes the ops accent; design green is the
	 *  fallback. Status colors stay fixed (semantics, not brand). */
	accent: string;
	/** Current model id (top-bar chip until the live feed reports one). */
	model: string;
	/** Process uptime in ms at render (the top-bar "uptime" stat baseline). */
	uptimeMs: number;
}

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d.,\s%]+\)$/;

/**
 * Agent Ops dashboard — the redesigned `/` page. A full-height dark console
 * (its own top bar / stage / inspector / scrub — paw's topbar is hidden)
 * rendered inside paw's Layout so the sidebar nav survives. The `.ops-app` grid
 * is driven by vanilla canvas modules served from `/ops/static/*` ('self'),
 * reading paw's real operation stream via `/api/ops/feed`. The accent follows
 * the active brand (server-inlined `--ops-green`). All visual logic lives in the
 * static modules; the only inline script is the bootstrap (cook-parse guarded —
 * no regex / no backslash, per the #37 lesson).
 */
export const OpsPage: FC<OpsPageProps> = ({ accent, model, uptimeMs }) => {
	const safeAccent = COLOR_RE.test(accent.trim()) ? accent.trim() : "#3fe08f";
	const cfg = JSON.stringify({
		model: model || "",
		uptimeMs,
		accent: safeAccent,
	}).replace(/</g, "\\u003c");
	return (
		<Layout title="Agent Ops" currentPath="/">
			{raw(`<link rel="stylesheet" href="/ops/static/styles.css">`)}
			<div id="ops-root" class="ops-app" style={`--ops-green:${safeAccent}`} />
			{raw(`<script src="/ops/static/ui.js"></script>`)}
			{raw(`<script src="/ops/static/engine.js"></script>`)}
			{raw(`<script src="/ops/static/viz-stream.js"></script>`)}
			{raw(`<script src="/ops/static/viz-swarm.js"></script>`)}
			{raw(`<script src="/ops/static/shell.js"></script>`)}
			{raw(`<script>(function(){
  var c = document.querySelector(".content");
  if (c) { c.classList.add("ops-content"); c.classList.add("content-full"); }
  var tb = document.querySelector(".main-area > .topbar");
  if (tb) { tb.style.display = "none"; }
  window.__OPS_CONFIG = ${cfg};
  if (window.AgentOps && window.OpsShell) {
    window.AgentOps.start();
    window.OpsShell.mount(document.getElementById("ops-root"), window.__OPS_CONFIG);
  }
})();</script>`)}
		</Layout>
	);
};
