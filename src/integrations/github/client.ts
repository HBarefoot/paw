import { App, Octokit } from "octokit";
import {
	type ConnectionStatus,
	GITHUB_DEFAULT_BASE_URL,
	type GitHubConfig,
	GitHubError,
	GitHubForbiddenError,
	type RepoSummary,
} from "./types.js";

/**
 * GitHubClient — a house-style wrapper around Octokit's GitHub App auth.
 *
 * Auth: a GitHub App. We mint a short-lived installation token (Octokit handles
 * JWT signing + token rotation internally via `getInstallationOctokit`). The
 * private key + webhook secret come from the vault and never reach the model.
 *
 * Safety: every repo-scoped call passes through `assertRepoAllowed()` so the
 * agent can only ever touch allowlisted `owner/repo` slugs. Write/guard logic
 * (no push to default/protected, no force-push) is added in Phase 2.
 */
export class GitHubClient {
	private readonly app: App;
	private readonly installationId: number;
	private readonly allowlist: Set<string>;
	/** Cached installation-authenticated Octokit (auto-refreshes its token). */
	private installation?: Promise<Octokit>;

	constructor(private readonly config: GitHubConfig) {
		if (!config.appId || !config.privateKey || !config.installationId) {
			throw new GitHubError(
				"GitHub App is not fully configured (need appId, privateKey, installationId).",
			);
		}
		const appId = Number(config.appId);
		const installationId = Number(config.installationId);
		if (!Number.isFinite(appId) || !Number.isFinite(installationId)) {
			throw new GitHubError("GitHub appId/installationId must be numeric.");
		}
		this.installationId = installationId;
		this.allowlist = new Set(
			config.repoAllowlist.map((r) => r.trim().toLowerCase()).filter(Boolean),
		);

		const baseUrl = (config.baseUrl || GITHUB_DEFAULT_BASE_URL).replace(
			/\/+$/,
			"",
		);
		const OctokitWithBase =
			baseUrl === GITHUB_DEFAULT_BASE_URL
				? Octokit
				: Octokit.defaults({ baseUrl });

		this.app = new App({
			appId,
			privateKey: config.privateKey,
			webhooks: { secret: config.webhookSecret || "unset" },
			Octokit: OctokitWithBase,
		});
	}

	/** Whether the App has the minimum config to attempt a connection. */
	isConfigured(): boolean {
		return Boolean(
			this.config.appId && this.config.privateKey && this.config.installationId,
		);
	}

	private octokit(): Promise<Octokit> {
		if (!this.installation) {
			this.installation = this.app.getInstallationOctokit(this.installationId);
		}
		return this.installation;
	}

	/** True if `owner/repo` is permitted. Empty allowlist = nothing allowed. */
	isRepoAllowed(fullName: string): boolean {
		return this.allowlist.has(fullName.trim().toLowerCase());
	}

	private assertRepoAllowed(fullName: string): void {
		if (!this.isRepoAllowed(fullName)) {
			throw new GitHubForbiddenError(
				`Repo "${fullName}" is not in the GitHub allowlist. Add it on the GitHub settings page.`,
			);
		}
	}

	/** App identity + installation account + live rate limit, for the UI. */
	async getStatus(): Promise<ConnectionStatus> {
		if (!this.isConfigured()) return { configured: false, ok: false };
		try {
			const appInfo = await this.app.octokit.rest.apps.getAuthenticated();
			const octokit = await this.octokit();
			const [rate, repos] = await Promise.all([
				octokit.rest.rateLimit.get(),
				octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 1 }),
			]);
			return {
				configured: true,
				ok: true,
				appSlug: appInfo.data?.slug ?? undefined,
				repoCount: repos.data.total_count,
				rateLimit: {
					limit: rate.data.rate.limit,
					remaining: rate.data.rate.remaining,
					reset: rate.data.rate.reset,
				},
			};
		} catch (err) {
			return {
				configured: true,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	/** Repos the installation can access, optionally narrowed to the allowlist. */
	async listRepos(): Promise<RepoSummary[]> {
		const octokit = await this.octokit();
		const repos = await octokit.paginate(
			octokit.rest.apps.listReposAccessibleToInstallation,
			{ per_page: 100 },
		);
		const mapped: RepoSummary[] = repos.map((r) => ({
			fullName: r.full_name,
			private: r.private,
			defaultBranch: r.default_branch,
			url: r.html_url,
		}));
		// If an allowlist is set, only surface allowed repos.
		if (this.allowlist.size === 0) return mapped;
		return mapped.filter((r) => this.isRepoAllowed(r.fullName));
	}

	/**
	 * Read a file's text content from an allowlisted repo. Returns the decoded
	 * UTF-8 content plus metadata. Throws if the path is a directory.
	 */
	async readFile(
		fullName: string,
		path: string,
		ref?: string,
	): Promise<{ content: string; sha: string; size: number; path: string }> {
		this.assertRepoAllowed(fullName);
		const [owner, repo] = fullName.split("/");
		if (!owner || !repo) {
			throw new GitHubError(
				`Invalid repo "${fullName}" (expected owner/repo).`,
			);
		}
		const octokit = await this.octokit();
		try {
			const res = await octokit.rest.repos.getContent({
				owner,
				repo,
				path,
				...(ref ? { ref } : {}),
			});
			const data = res.data;
			if (Array.isArray(data)) {
				throw new GitHubError(`"${path}" is a directory, not a file.`);
			}
			if (data.type !== "file" || typeof data.content !== "string") {
				throw new GitHubError(`"${path}" is not a readable file.`);
			}
			const content = Buffer.from(data.content, "base64").toString("utf-8");
			return { content, sha: data.sha, size: data.size, path: data.path };
		} catch (err) {
			if (err instanceof GitHubError) throw err;
			const status =
				typeof (err as { status?: number }).status === "number"
					? (err as { status: number }).status
					: undefined;
			throw new GitHubError(
				`GitHub getContent ${fullName}/${path} failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
				status,
			);
		}
	}
}
