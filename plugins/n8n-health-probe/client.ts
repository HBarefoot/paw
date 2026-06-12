/**
 * Tiny n8n REST client (public API v1) + connection resolution. Mirrors the
 * fetch + AbortController-timeout + typed-error shape of paw's other
 * integrations. Auth is the n8n API key sent as the `X-N8N-API-KEY` header.
 */

export interface N8nConn {
	/** n8n instance origin, e.g. https://n8n.example.com (no trailing /api/v1). */
	baseUrl: string;
	token: string;
	timeout?: number;
}

export interface N8nWorkflow {
	id: string;
	name: string;
	active: boolean;
}

export interface N8nExecution {
	id: string;
	workflowId: string;
	status?: string; // success | error | crashed | waiting | running | canceled
	startedAt?: string;
	stoppedAt?: string;
	finished?: boolean;
	// Present when includeData=true; shape is defensive (n8n nests deeply).
	data?: {
		resultData?: {
			lastNodeExecuted?: string;
			error?: { message?: string; node?: { name?: string } };
		};
	};
}

export class N8nError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "N8nError";
	}
}

/**
 * Resolve the n8n connection for this plugin. ctx.config is plugin-scoped
 * (`config["n8n-health-probe"]`), so we CANNOT see the global `config.n8n`.
 * Resolution order:
 *   1. this plugin's own config block `{ baseUrl, token }` — `token` may be a
 *      `vault://n8n.token` ref, which the kernel's vault overlay resolves before
 *      the plugin sees it, so the existing n8n secret is reused (no new storage).
 *   2. `PAW_N8N_TOKEN` + a base URL from `PAW_N8N_BASE_URL` or the origin of the
 *      first `PAW_N8N_ENDPOINTS` entry.
 * Returns null when neither yields a usable baseUrl+token (callers degrade to a
 * clean "not configured" tool result).
 */
export function resolveN8nConfig(
	cfg: Record<string, unknown> | undefined,
	env: Record<string, string | undefined>,
): N8nConn | null {
	const c = (cfg ?? {}) as {
		baseUrl?: string;
		token?: string;
		timeout?: number;
	};
	let baseUrl = (c.baseUrl ?? "").trim();
	let token = (c.token ?? "").trim();
	// A vault:// ref that didn't resolve (vault disabled) is unusable.
	if (token.startsWith("vault://")) token = "";

	if (!token) token = (env.PAW_N8N_TOKEN ?? "").trim();
	if (!baseUrl) {
		baseUrl =
			(env.PAW_N8N_BASE_URL ?? "").trim() ||
			originOfFirstEndpoint(env.PAW_N8N_ENDPOINTS);
	}
	if (!baseUrl || !token) return null;
	return {
		baseUrl: baseUrl.replace(/\/+$/, ""),
		token,
		timeout: typeof c.timeout === "number" ? c.timeout : undefined,
	};
}

/** Best-effort origin from PAW_N8N_ENDPOINTS (JSON `[{url}]` or `name=url,...`). */
function originOfFirstEndpoint(raw: string | undefined): string {
	if (!raw) return "";
	let url = "";
	const trimmed = raw.trim();
	try {
		if (trimmed.startsWith("[")) {
			const arr = JSON.parse(trimmed) as Array<{ url?: string }>;
			url = arr.find((e) => e?.url)?.url ?? "";
		} else {
			// name=url,name2=url2 — take the first url after the first '='.
			const first = trimmed.split(",")[0] ?? "";
			url = first.slice(first.indexOf("=") + 1);
		}
		if (!url) return "";
		return new URL(url).origin;
	} catch {
		return "";
	}
}

export class N8nClient {
	private readonly base: string;
	private readonly token: string;
	private readonly timeout: number;

	constructor(conn: N8nConn) {
		this.base = conn.baseUrl.replace(/\/+$/, "");
		this.token = conn.token;
		this.timeout = conn.timeout ?? 10_000;
	}

	listWorkflows(): Promise<{ data: N8nWorkflow[] }> {
		return this.req("/api/v1/workflows?limit=250");
	}

	getWorkflow(id: string): Promise<N8nWorkflow> {
		return this.req(`/api/v1/workflows/${encodeURIComponent(id)}`);
	}

	listExecutions(
		opts: {
			workflowId?: string;
			status?: string;
			limit?: number;
			includeData?: boolean;
		} = {},
	): Promise<{ data: N8nExecution[] }> {
		const qs: string[] = [`limit=${Math.min(opts.limit ?? 100, 250)}`];
		if (opts.workflowId)
			qs.push(`workflowId=${encodeURIComponent(opts.workflowId)}`);
		if (opts.status) qs.push(`status=${encodeURIComponent(opts.status)}`);
		if (opts.includeData) qs.push("includeData=true");
		return this.req(`/api/v1/executions?${qs.join("&")}`);
	}

	private async req<T>(path: string): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);
		try {
			const res = await fetch(`${this.base}${path}`, {
				method: "GET",
				signal: controller.signal,
				redirect: "error",
				headers: {
					"X-N8N-API-KEY": this.token,
					Accept: "application/json",
				},
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new N8nError(
					`n8n GET ${path} failed: ${res.status} ${res.statusText}${
						text ? ` — ${text.slice(0, 200)}` : ""
					}`,
					res.status,
				);
			}
			const raw = await res.text();
			return (raw ? JSON.parse(raw) : null) as T;
		} catch (err) {
			if (err instanceof N8nError) throw err;
			if (err instanceof DOMException && err.name === "AbortError") {
				throw new N8nError(`n8n request timed out after ${this.timeout}ms`, 0);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}
}

const FAILURE_STATUSES = new Set(["error", "crashed"]);
export function isFailure(status: string | undefined): boolean {
	return FAILURE_STATUSES.has((status ?? "").toLowerCase());
}
