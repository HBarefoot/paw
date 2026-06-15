import {
	type CreateProjectOptions,
	type DeployReadyState,
	type DeployTarget,
	type DeploymentStatus,
	type DeploymentSummary,
	type DomainResult,
	type ListDeploymentsOptions,
	type ProjectResult,
	type ProjectSummary,
	VERCEL_DEFAULT_BASE_URL,
	type VercelConfig,
	VercelError,
	type VercelStatus,
} from "./types.js";

/** Normalize an arbitrary string into a valid Vercel project name:
 *  lowercase, `[a-z0-9._-]` only, no leading/trailing/collapsed separators,
 *  capped at 100 chars (Vercel's limit). */
export function slugifyProjectName(raw: string): string {
	const s = raw
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^[-._]+|[-._]+$/g, "")
		.slice(0, 100)
		.replace(/[-._]+$/g, "");
	return s || "project";
}

interface VercelProjectJson {
	id?: string;
	name?: string;
	framework?: string | null;
	link?: { type?: string; org?: string; repo?: string };
}

/** Raw `GET /v7/deployments` item (subset). The id is `uid`; `url` may be null. */
interface VercelDeploymentJson {
	uid?: string;
	id?: string;
	url?: string | null;
	readyState?: string;
	state?: string;
	target?: string | null;
	createdAt?: number;
	created?: number;
}

function toProjectResult(
	p: VercelProjectJson,
	createdNew: boolean,
): ProjectResult {
	const linkedRepo =
		p.link?.org && p.link?.repo
			? `${p.link.org}/${p.link.repo}`
			: (p.link?.repo ?? undefined);
	return {
		id: String(p.id ?? ""),
		name: String(p.name ?? ""),
		framework: p.framework ?? null,
		linkedRepo,
		createdNew,
	};
}

/**
 * Fetch-based Vercel REST client. Single-operator, static-first PoC surface.
 * The token comes pre-resolved from the vault (`config.vercel.token`) and is
 * sent only as a server-side `Authorization: Bearer` header — never returned to
 * a caller, so it cannot reach the model.
 *
 * Endpoint versions verified against vercel.com/docs/rest-api (2026-06):
 *   create project  POST /v11/projects
 *   get project     GET  /v9/projects/{idOrName}
 *   list projects   GET  /v9/projects
 *   list deploys    GET  /v7/deployments?projectId=…&target=…&limit=…
 *   deploy status   GET  /v13/deployments/{idOrUrl}
 *   add domain      POST /v10/projects/{idOrName}/domains
 */
export class VercelClient implements DeployTarget {
	private readonly baseUrl: string;
	private readonly token: string;
	private readonly teamId?: string;
	private readonly timeout: number;

	constructor(config: VercelConfig) {
		if (!config.token) {
			throw new VercelError(
				"Vercel token is required. Add it to the vault slot `vercel.token`.",
			);
		}
		this.baseUrl = (config.baseUrl || VERCEL_DEFAULT_BASE_URL).replace(
			/\/+$/,
			"",
		);
		this.token = config.token;
		this.teamId = config.teamId || undefined;
		this.timeout = config.timeout ?? 15_000;
	}

	isConfigured(): boolean {
		return Boolean(this.token);
	}

	/** Live connection check for the console page: project count or an error.
	 *  Never throws and never returns the token. */
	async getStatus(): Promise<VercelStatus> {
		if (!this.isConfigured()) return { configured: false, ok: false };
		try {
			const projects = await this.listProjects();
			return {
				configured: true,
				ok: true,
				projectCount: projects.length,
				team: this.teamId,
			};
		} catch (err) {
			return {
				configured: true,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	async getOrCreateProject(opts: CreateProjectOptions): Promise<ProjectResult> {
		const name = slugifyProjectName(opts.name);

		// 1) Idempotency: return an existing project of the same name as-is.
		const existing = await this.getProject(name);
		if (existing) return toProjectResult(existing, false);

		// 2) Create. Link the repo so pushes auto-deploy (when a repo is given).
		const body: Record<string, unknown> = {
			name,
			framework: opts.framework ?? null,
		};
		if (opts.repo) {
			body.gitRepository = { type: "github", repo: opts.repo };
		}
		try {
			const created = await this.request<VercelProjectJson>(
				"POST",
				"/v11/projects",
				undefined,
				body,
			);
			return toProjectResult(created, true);
		} catch (err) {
			// 3) Lost a create race (name now taken) — re-fetch and return it.
			if (err instanceof VercelError && err.status === 409) {
				const raced = await this.getProject(name);
				if (raced) return toProjectResult(raced, false);
			}
			throw err;
		}
	}

	async getDeploymentStatus(idOrUrl: string): Promise<DeploymentStatus> {
		const d = await this.request<{
			id?: string;
			uid?: string;
			readyState?: string;
			url?: string;
		}>("GET", `/v13/deployments/${encodeURIComponent(idOrUrl)}`);
		return {
			id: String(d.id ?? d.uid ?? idOrUrl),
			readyState: d.readyState ?? "QUEUED",
			url: d.url,
		};
	}

	async addDomain(
		projectIdOrName: string,
		name: string,
	): Promise<DomainResult> {
		const d = await this.request<{
			name?: string;
			verified?: boolean;
			verification?: DomainResult["verification"];
		}>(
			"POST",
			`/v10/projects/${encodeURIComponent(projectIdOrName)}/domains`,
			undefined,
			{ name },
		);
		return {
			name: String(d.name ?? name),
			verified: Boolean(d.verified),
			verification: d.verification ?? [],
		};
	}

	async listProjects(): Promise<ProjectSummary[]> {
		const r = await this.request<{ projects?: VercelProjectJson[] }>(
			"GET",
			"/v9/projects",
		);
		return (r.projects ?? []).map((p) => ({
			id: String(p.id ?? ""),
			name: String(p.name ?? ""),
			framework: p.framework ?? null,
		}));
	}

	/**
	 * List a project's deployments, newest first. `GET /v7/deployments`. Filter
	 * `target: "production"` for the prod deploy; `limit: 1` for "the latest".
	 * Note: the id field in the API is `uid`, and `url` is null while a deploy is
	 * still uploading.
	 */
	async listDeployments(
		opts: ListDeploymentsOptions,
	): Promise<DeploymentSummary[]> {
		const r = await this.request<{ deployments?: VercelDeploymentJson[] }>(
			"GET",
			"/v7/deployments",
			{
				projectId: opts.projectId,
				target: opts.target,
				limit: opts.limit !== undefined ? String(opts.limit) : undefined,
			},
		);
		return (r.deployments ?? []).map((d) => ({
			id: String(d.uid ?? d.id ?? ""),
			url: d.url ?? null,
			readyState: (d.readyState ?? d.state ?? "QUEUED") as DeployReadyState,
			target: d.target ?? null,
			createdAt: Number(d.createdAt ?? d.created ?? 0),
		}));
	}

	/** GET a project by id or name; null on 404 (any other error propagates). */
	private async getProject(
		idOrName: string,
	): Promise<VercelProjectJson | null> {
		try {
			return await this.request<VercelProjectJson>(
				"GET",
				`/v9/projects/${encodeURIComponent(idOrName)}`,
			);
		} catch (err) {
			if (err instanceof VercelError && err.status === 404) return null;
			throw err;
		}
	}

	/** Build an absolute URL, appending the team scope + any extra query. */
	private url(
		path: string,
		query?: Record<string, string | undefined>,
	): string {
		const params = new URLSearchParams();
		if (this.teamId) params.set("teamId", this.teamId);
		if (query) {
			for (const [k, v] of Object.entries(query)) {
				if (v !== undefined) params.set(k, v);
			}
		}
		const qs = params.toString();
		return `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
	}

	private async request<T>(
		method: string,
		path: string,
		query?: Record<string, string | undefined>,
		body?: unknown,
	): Promise<T> {
		const url = this.url(path, query);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);
		try {
			const res = await fetch(url, {
				method,
				signal: controller.signal,
				headers: {
					Authorization: `Bearer ${this.token}`,
					"Content-Type": "application/json",
				},
				body: body ? JSON.stringify(body) : undefined,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new VercelError(
					`Vercel ${method} ${path} failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
					res.status,
				);
			}

			return (await res.json()) as T;
		} catch (err) {
			if (err instanceof VercelError) throw err;
			if (err instanceof DOMException && err.name === "AbortError") {
				throw new VercelError(
					`Vercel request timed out after ${this.timeout}ms: ${method} ${path}`,
				);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}
}
