import {
	POSTHOG_DEFAULT_HOST,
	type PostHogConfig,
	PostHogError,
	type PostHogStatus,
	type QueryResult,
} from "./types.js";

/**
 * Map a PostHog INGESTION host to its QUERY/app host. Events are sent to
 * `us.i.posthog.com`, but the REST/Query API lives on the app host
 * `us.posthog.com` (no `i.` label). Self-hosted hosts (no `.i.posthog.com`)
 * are returned unchanged.
 */
export function toApiHost(host: string): string {
	return host.replace(/\.i\.posthog\.com/i, ".posthog.com");
}

/**
 * Fetch-based, READ-ONLY PostHog client. All metrics go through the HogQL Query
 * API (`POST /api/projects/{id}/query/`). The personal API key comes pre-resolved
 * from the vault and is sent only as a server-side Bearer header — never returned
 * to a caller, so it cannot reach the model.
 *
 * Endpoints verified against posthog.com/docs (2026-06):
 *   run HogQL   POST /api/projects/{project_id}/query/  { query: { kind:'HogQLQuery', query } }
 *   auth        Authorization: Bearer <personalApiKey>
 */
export class PostHogClient {
	private readonly apiHost: string;
	private readonly personalApiKey: string;
	private readonly projectId: string;
	private readonly timeout: number;

	constructor(config: PostHogConfig) {
		if (!config.personalApiKey) {
			throw new PostHogError(
				"PostHog personal API key is required. Add it to the vault slot `posthog.personalApiKey`.",
			);
		}
		if (!config.projectId) {
			throw new PostHogError(
				"PostHog projectId is required (set config.posthog.projectId from your project settings).",
			);
		}
		this.apiHost = toApiHost(
			(config.host || POSTHOG_DEFAULT_HOST).replace(/\/+$/, ""),
		);
		this.personalApiKey = config.personalApiKey;
		this.projectId = config.projectId;
		this.timeout = config.timeout ?? 15_000;
	}

	isConfigured(): boolean {
		return Boolean(this.personalApiKey && this.projectId);
	}

	/** Run a HogQL query and return its normalized columns/results. */
	async query(hogql: string): Promise<QueryResult> {
		const data = await this.request<{
			results?: unknown[][];
			columns?: string[];
			types?: unknown[];
		}>("POST", `/api/projects/${encodeURIComponent(this.projectId)}/query/`, {
			query: { kind: "HogQLQuery", query: hogql },
		});
		return {
			columns: (data.columns ?? []).map(String),
			results: data.results ?? [],
			types: data.types?.map(String),
		};
	}

	/** Live connection check (a trivial query). Never throws, never returns the key. */
	async getStatus(): Promise<PostHogStatus> {
		if (!this.isConfigured()) return { configured: false, ok: false };
		try {
			await this.query("SELECT 1");
			return { configured: true, ok: true };
		} catch (err) {
			return {
				configured: true,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);
		try {
			const res = await fetch(`${this.apiHost}${path}`, {
				method,
				signal: controller.signal,
				headers: {
					Authorization: `Bearer ${this.personalApiKey}`,
					"Content-Type": "application/json",
				},
				body: body ? JSON.stringify(body) : undefined,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => "");
				const hint =
					res.status === 401 || res.status === 403
						? " — check the personal API key has Query Read permission"
						: res.status === 429
							? " — rate limited; back off and retry"
							: "";
				throw new PostHogError(
					`PostHog ${method} ${path} failed: ${res.status} ${res.statusText}${hint}${text ? ` — ${text}` : ""}`,
					res.status,
				);
			}

			return (await res.json()) as T;
		} catch (err) {
			if (err instanceof PostHogError) throw err;
			if (err instanceof DOMException && err.name === "AbortError") {
				throw new PostHogError(
					`PostHog request timed out after ${this.timeout}ms: ${method} ${path}`,
				);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}
}
