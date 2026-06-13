/**
 * Per-process asset version for cache-busting static assets (CSS/JS) served from
 * `self` — changes on every server start/deploy. Shared so `app.ts` and the
 * `Layout` view emit the SAME `?v=` token for a given boot.
 */
export const ASSET_VERSION = Date.now().toString(36);
