/**
 * Vercel deploy-target integration — types and the swappable `DeployTarget`
 * seam.
 *
 * This is the Phase 1 PoC host integration: the kernel provisions public assets
 * onto the operator's own Vercel + GitHub repo rather than serving them itself.
 * `DeployTarget` is the abstraction the kernel and tools depend on, so a future
 * second host can be added without re-coupling. One interface, one impl today.
 */

export const VERCEL_DEFAULT_BASE_URL = "https://api.vercel.com";

/** Config block (`config.vercel`). `token` is overlaid from the vault slot
 *  `vercel.token` server-side — it must NEVER reach the model. */
export interface VercelConfig {
	enabled: boolean;
	token: string;
	teamId?: string;
	baseUrl: string;
	timeout: number;
}

/** Result of get-or-create on a project. `createdNew` distinguishes a fresh
 *  create from an idempotent hit on an existing project. */
export interface ProjectResult {
	id: string;
	name: string;
	framework: string | null;
	/** `owner/repo` if a Git repository is linked. */
	linkedRepo?: string;
	createdNew: boolean;
}

export interface ProjectSummary {
	id: string;
	name: string;
	framework: string | null;
}

export type DeployReadyState =
	| "QUEUED"
	| "BUILDING"
	| "READY"
	| "ERROR"
	| "CANCELED"
	| (string & {});

export interface DeploymentStatus {
	id: string;
	readyState: DeployReadyState;
	/** Deployment hostname (no scheme), e.g. `my-app-abc123.vercel.app`. */
	url?: string;
}

export interface DomainVerification {
	type: string;
	domain: string;
	value: string;
	reason?: string;
}

export interface DomainResult {
	name: string;
	verified: boolean;
	/** TXT (etc.) challenges to satisfy when `verified` is false. */
	verification: DomainVerification[];
}

export interface CreateProjectOptions {
	/** Desired project name. Implementations may slugify it. */
	name: string;
	/** `owner/repo` to link for auto-deploy-on-push. Omit for an unlinked project. */
	repo?: string;
	framework?: string | null;
}

/**
 * The swappable deploy-target seam. Tools and the kernel approval executors
 * depend on this, not on `VercelClient` directly, so the kernel is not
 * hard-coupled to Vercel.
 */
export interface DeployTarget {
	getOrCreateProject(opts: CreateProjectOptions): Promise<ProjectResult>;
	getDeploymentStatus(idOrUrl: string): Promise<DeploymentStatus>;
	addDomain(projectIdOrName: string, name: string): Promise<DomainResult>;
	listProjects(): Promise<ProjectSummary[]>;
}

/** Live connection summary for the console page. Never carries the token. */
export interface VercelStatus {
	configured: boolean;
	ok: boolean;
	projectCount?: number;
	team?: string;
	error?: string;
}

/** Thrown by the Vercel client for any non-2xx response or transport failure.
 *  `status` is the HTTP status when one is available (undefined for timeouts). */
export class VercelError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "VercelError";
	}
}
