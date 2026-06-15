/**
 * PostHog read integration — types.
 *
 * The agent's "eyes" on published-page traffic: a thin, READ-ONLY client over
 * PostHog's HogQL Query API plus a small set of curated metric tools. The
 * `personalApiKey` is resolved from the vault (`posthog.personalApiKey`) and
 * sent only as a server-side `Authorization: Bearer` header — it must NEVER
 * reach the model. There are no writes, so nothing here is approval-gated.
 */

export const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";
/** Hard cap on rows any single query may return (the freeform tool appends this
 *  LIMIT when one is missing). PostHog itself allows up to 50k with an explicit
 *  LIMIT; we stay well under that for a "sense pass". */
export const POSTHOG_MAX_ROWS = 1000;

/** Config block (`config.posthog`). `personalApiKey` is overlaid from the vault
 *  slot `posthog.personalApiKey` server-side — it must NEVER reach the model. */
export interface PostHogConfig {
	enabled: boolean;
	/** PUBLIC project key (snippet only — not used by the read client). */
	projectApiKey: string;
	/** PRIVATE personal API key (read API). Vault-resolved, server-side only. */
	personalApiKey: string;
	/** Numeric project id (PostHog project settings). */
	projectId: string;
	/** Ingestion host, e.g. https://us.i.posthog.com. The query API host is
	 *  derived from it (the app host, without the `i.` ingest label). */
	host: string;
	timeout: number;
}

/** Normalized result of a HogQL query. */
export interface QueryResult {
	columns: string[];
	results: unknown[][];
	types?: string[];
}

/** Live connection summary for a status check. Never carries the key. */
export interface PostHogStatus {
	configured: boolean;
	ok: boolean;
	error?: string;
}

/** Thrown by the PostHog client for any non-2xx response or transport failure.
 *  `status` is the HTTP status when one is available (undefined for timeouts). */
export class PostHogError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "PostHogError";
	}
}
