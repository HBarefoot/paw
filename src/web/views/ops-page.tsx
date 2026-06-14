import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

interface OpsPageProps {
	/** Active brand accent (hex/rgb) — themes the dashboard accent (`--accent`);
	 *  design green is the fallback. Status colors stay fixed (semantics). */
	accent: string;
	/** Current model id (top-bar chip until the live feed reports one). */
	model: string;
	/** Process uptime in ms at render (informational; the live engine tracks the
	 *  session clock from the server feed). */
	uptimeMs: number;
	/** Real brand logo URL (from `/api/brand/ui` → getBrandUi) — the topbar mark.
	 *  Falls back to an accent glyph when there's no brand logo. */
	brandLogo?: string;
	/** Asset version for cache-busting the static ops modules. */
	assetVersion?: string;
	/** Route this page is mounted at, for the sidebar nav active-state. */
	currentPath?: string;
}

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d.,\s%]+\)$/;

/**
 * Agent Operations dashboard — the redesigned `/` page. A full-height monitoring
 * console (its own top bar; paw's topbar is hidden) rendered inside paw's Layout
 * so the sidebar nav survives. Everything under `.ops-app` is driven by vanilla
 * modules served from `/ops/static/*` ('self'), reading paw's REAL operation
 * stream via `/api/ops/feed`. Accent + brand mark follow the active brand. The
 * only inline script is the cook-parse-guarded bootstrap (no regex / backslash).
 */
export const OpsPage: FC<OpsPageProps> = ({
	accent,
	model,
	uptimeMs,
	brandLogo,
	assetVersion = "",
	currentPath = "/",
}) => {
	const safeAccent = COLOR_RE.test(accent.trim()) ? accent.trim() : "#3fe08f";
	const cfg = JSON.stringify({
		model: model || "",
		uptimeMs,
		accent: safeAccent,
		brandLogo: brandLogo || "",
	}).replace(/</g, "\\u003c");
	const v = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : "";
	return (
		<Layout title="Agent Ops" currentPath={currentPath}>
			{raw(`<link rel="stylesheet" href="/ops/static/styles.css${v}">`)}
			<div id="ops-root" class="ops-app" style={`--accent:${safeAccent}`} />
			{raw(`<script src="/ops/static/ui.js${v}"></script>`)}
			{raw(`<script src="/ops/static/charts.js${v}"></script>`)}
			{raw(`<script src="/ops/static/engine.js${v}"></script>`)}
			{raw(`<script src="/ops/static/dash.js${v}"></script>`)}
			{raw(`<script>(function(){
  var c = document.querySelector(".content");
  if (c) { c.classList.add("ops-content"); c.classList.add("content-full"); }
  var tb = document.querySelector(".main-area > .topbar");
  if (tb) { tb.style.display = "none"; }
  window.__OPS_CONFIG = ${cfg};
  if (window.AgentOps && window.OpsDash) {
    window.AgentOps.start();
    window.OpsDash.mount(document.getElementById("ops-root"), window.__OPS_CONFIG);
  }
})();</script>`)}
		</Layout>
	);
};
