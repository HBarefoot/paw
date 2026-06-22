// Rate-limit policy for the global /api/* limiter. Extracted so the
// classification is unit-testable without booting the full web app.
//
// High-frequency, legitimate browser traffic must not starve the strict
// per-IP budget that real API actions need, and asset-shaped responses must
// not get a JSON 429 (which breaks <link>/<script> with a MIME error). So
// /api/* requests are sorted into classes, each with its own per-IP budget:
//
//   action     — default (incl. ALL non-GET): real API calls/mutations.   60/min
//   app-asset  — GET /api/app/:space/* (#51): app-space static assets.    600/min
//   chrome     — GET brand theme/tokens/ui/asset: per-render, PRE-AUTH.   600/min
//   live       — GET pollers + canvas live/asset reads (interval-fetched). 600/min
//
// Budgets are generous-but-bounded constants (the limiter is per-IP and many
// users can share one proxy IP). The downstream fork can tune them.

export type RateClass = "action" | "app-asset" | "chrome" | "live";

export const ACTION_LIMIT_PER_MIN = 60;
// Kept (name + value) for back-compat with #51's test; app-asset is one of the
// generous read budgets.
export const APP_ASSET_LIMIT_PER_MIN = 600;
export const CHROME_LIMIT_PER_MIN = 600;
export const LIVE_LIMIT_PER_MIN = 600;

/** Per-class per-IP budget (req/min). */
export function limitForClass(cls: RateClass): number {
	switch (cls) {
		case "app-asset":
			return APP_ASSET_LIMIT_PER_MIN;
		case "chrome":
			return CHROME_LIMIT_PER_MIN;
		case "live":
			return LIVE_LIMIT_PER_MIN;
		default:
			return ACTION_LIMIT_PER_MIN;
	}
}

// Chrome: white-label UI assets fetched on every page render (incl. pre-auth
// login/TOTP). theme/tokens are CSS, ui is JSON, asset/* is binary.
const CHROME_EXACT = new Set([
	"/api/brand/theme.css",
	"/api/brand/tokens.css",
	"/api/brand/ui",
]);
const CHROME_ASSET_PREFIX = "/api/brand/asset/";

// Live: endpoints a page hits on an interval (notifications/agent-ops/github/
// canvas events) plus the canvas iframe's high-frequency asset reads (files +
// preview/*), which have the same "many reads per load" shape as app spaces.
const LIVE_EXACT = new Set([
	"/api/notifications",
	"/api/agent-ops",
	"/api/ops/feed",
	"/api/tasks/feed",
	"/api/canvas/events",
	"/api/canvas/files",
	"/api/github/events",
	"/api/github/pending",
]);
const CANVAS_PREVIEW_PREFIX = "/api/canvas/preview/";

/**
 * Classify an /api/* request for rate limiting. Non-GET is always `action`
 * (mutations stay on the strict budget — e.g. POST /api/notifications/read).
 */
export function resolveRateClass(method: string, path: string): RateClass {
	if (method !== "GET") return "action";
	if (path.startsWith("/api/app/")) return "app-asset";
	if (CHROME_EXACT.has(path) || path.startsWith(CHROME_ASSET_PREFIX))
		return "chrome";
	if (LIVE_EXACT.has(path) || path.startsWith(CANVAS_PREVIEW_PREFIX))
		return "live";
	return "action";
}

/** True for `GET /api/app/:space/*` (an app-space static-asset read). #51 API. */
export function isAppAssetGet(method: string, path: string): boolean {
	return resolveRateClass(method, path) === "app-asset";
}

/**
 * Content-Type to use when a CHROME request is rate-limited, so the 429 body
 * matches what a `<link>`/fetch expects (no "Refused to apply style… MIME
 * type" console error — the page just degrades to unthemed). `null` for binary
 * assets, which don't MIME-check the same way.
 */
export function chrome429ContentType(path: string): string | null {
	if (path.endsWith(".css")) return "text/css";
	if (path === "/api/brand/ui") return "application/json";
	return null;
}
