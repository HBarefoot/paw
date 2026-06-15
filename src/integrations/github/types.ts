/**
 * GitHub integration types. The agent authenticates as a GitHub App (fine-grained
 * per-repo permissions, short-lived installation tokens, webhooks). Secrets
 * (private key, webhook secret) live in the vault and are overlaid into config at
 * boot — they are NEVER exposed to the model/canvas.
 */

export interface GitHubConfig {
	enabled: boolean;
	/** GitHub App ID (numeric, stored as string in config). */
	appId: string;
	/** Installation ID the App is installed under (per account/org). */
	installationId: string;
	/** PEM private key — overlaid from vault slot `github.appPrivateKey`. */
	privateKey: string;
	/** Webhook signing secret — overlaid from vault slot `github.webhookSecret`. */
	webhookSecret: string;
	/** API base URL. api.github.com for public; GHES uses a custom host. */
	baseUrl: string;
	/** Allowlist of `owner/repo` the agent may touch. Empty = none allowed. */
	repoAllowlist: string[];
	/** Optional fine-grained PAT — overlaid from vault slot `github.token`. Used
	 *  by the `git`/`gh` workspace tools only as a fallback when App installation
	 *  auth is unavailable. Prefer the auto-rotating App token. */
	token?: string;
	/** Branches that `git`/`gh` may never push to directly and whose merges are
	 *  approval-gated. Defaults to `["main"]`. */
	protectedBranches?: string[];
}

export const GITHUB_DEFAULT_BASE_URL = "https://api.github.com";

export interface RepoSummary {
	fullName: string;
	private: boolean;
	defaultBranch: string;
	url: string;
}

export interface BranchSummary {
	name: string;
	protected: boolean;
	sha: string;
}

export interface PrSummary {
	number: number;
	title: string;
	state: string;
	draft: boolean;
	head: string;
	base: string;
	url: string;
	mergeable?: boolean | null;
	author?: string;
}

/** A file to create/update in a single atomic commit. */
export interface CommitFileInput {
	path: string;
	/** File content — UTF-8 text, or a base64 string when `encoding` is "base64". */
	content: string;
	/**
	 * How `content` is encoded. "utf-8" (default) for text; "base64" to commit
	 * binary files (images, fonts, etc.) by passing their base64 as-is.
	 */
	encoding?: "utf-8" | "base64";
}

export interface CheckRunSummary {
	name: string;
	status: string; // queued | in_progress | completed
	conclusion: string | null; // success | failure | cancelled | ...
	url?: string;
}

export interface WorkflowRunSummary {
	id: number;
	name: string;
	event: string;
	status: string;
	conclusion: string | null;
	branch: string;
	url: string;
	createdAt: string;
}

export interface ReviewCommentSummary {
	author?: string;
	body: string;
	path?: string;
	line?: number | null;
}

export interface ReviewSummary {
	author?: string;
	state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED
	body: string;
	submittedAt?: string;
}

export interface RateLimitInfo {
	limit: number;
	remaining: number;
	reset: number; // epoch seconds
}

export interface ConnectionStatus {
	configured: boolean;
	ok: boolean;
	appSlug?: string;
	accountLogin?: string;
	repoCount?: number;
	rateLimit?: RateLimitInfo;
	error?: string;
}

/** Base error for GitHub client failures (carries HTTP status when available). */
export class GitHubError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "GitHubError";
	}
}

/** Thrown when a repo is not in the configured allowlist. */
export class GitHubForbiddenError extends GitHubError {
	constructor(message: string) {
		super(message, 403);
		this.name = "GitHubForbiddenError";
	}
}
