// Rate-limit policy for the global /api/* limiter. Extracted so the
// classification is unit-testable without booting the full web app.

/**
 * App-space static-asset GETs (`GET /api/app/:space/*`) get a separate, much
 * higher per-IP budget than the shared /api/* limit: a single app-space page
 * pulls ~40 assets and the 2s refresh poller adds ~30 req/min, which would trip
 * the shared 60/min and blank the page (the browser receives a JSON 429 where
 * it expected a script/stylesheet). These reads are session-authed and
 * path-safe; 600/min keeps a runaway client bounded without breaking real app
 * spaces.
 */
export const APP_ASSET_LIMIT_PER_MIN = 600;

/** True for `GET /api/app/:space/*` (an app-space static-asset read). */
export function isAppAssetGet(method: string, path: string): boolean {
	return method === "GET" && path.startsWith("/api/app/");
}
