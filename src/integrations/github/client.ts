import { App, Octokit } from "octokit";
import { normalizePrivateKey } from "./private-key.js";
import {
	type BranchSummary,
	type CheckRunSummary,
	type CommitFileInput,
	type ConnectionStatus,
	GITHUB_DEFAULT_BASE_URL,
	type GitHubConfig,
	GitHubError,
	GitHubForbiddenError,
	type PrSummary,
	type RepoSummary,
	type ReviewCommentSummary,
	type ReviewSummary,
	type WorkflowRunSummary,
} from "./types.js";

/**
 * Heuristic hint appended to 403/404 errors so an opaque "Resource not
 * accessible by integration" becomes self-explanatory: it names the GitHub App
 * permission the operation most likely needs, derived from the operation's
 * context string. Pure (no API call) so it stays offline-testable.
 */
function scopeHint(ctx: string): string {
	const c = ctx.toLowerCase();
	let perm: string;
	if (
		c.includes("workflow") ||
		c.includes("dispatch") ||
		c.includes("action")
	) {
		perm = "`actions: write`";
	} else if (c.includes("pull") || c.includes("merge")) {
		perm = "`pull_requests: write`";
	} else if (c.includes("issue") || c.includes("comment")) {
		perm = "`issues: write`";
	} else if (
		c.includes("commit") ||
		c.includes("ref") ||
		c.includes("blob") ||
		c.includes("tree") ||
		c.includes("content") ||
		c.includes("branch")
	) {
		perm = "`contents: write`";
	} else {
		perm = "the matching write permission";
	}
	return ` — the GitHub App installation likely lacks ${perm}, or is not installed on this repo. Adjust the App's repository permissions (and re-accept the request) at github.com/settings/installations, and confirm the repo is in the allowlist.`;
}

/**
 * GitHubClient — a house-style wrapper around Octokit's GitHub App auth.
 *
 * Auth: a GitHub App. We mint a short-lived installation token (Octokit handles
 * JWT signing + token rotation internally via `getInstallationOctokit`). The
 * private key + webhook secret come from the vault and never reach the model.
 *
 * Safety: every repo-scoped call passes through `assertRepoAllowed()` so the
 * agent can only ever touch allowlisted `owner/repo` slugs. Writes refuse the
 * default/protected branch and never force-push, structurally confining the
 * agent to the branch + PR workflow. Irreversible actions (merge, delete) are
 * gated for human approval in Phase 3.
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
			privateKey: normalizePrivateKey(config.privateKey),
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

	/**
	 * A fresh, short-lived installation access token string for use by real
	 * `git`/`gh` in the exec workspace. The App auth strategy caches + auto-
	 * rotates it (~1h TTL), so calling this per git invocation never hands a
	 * stale token to `git push`. Prefers the App token; falls back to a vault
	 * `github.token` PAT only if App auth is unavailable/fails. The returned
	 * value is a SECRET — callers must inject it into an ephemeral child env and
	 * redact it from any captured output/logs; never persist it to disk.
	 */
	async getInstallationToken(): Promise<string> {
		try {
			const auth = (await this.app.octokit.auth({
				type: "installation",
				installationId: this.installationId,
			})) as { token?: string };
			if (auth?.token) return auth.token;
		} catch (err) {
			if (!this.config.token) throw err;
		}
		if (this.config.token) return this.config.token;
		throw new GitHubError(
			"No git token available (App installation auth returned no token and no github.token PAT is set).",
		);
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
			throw this.toError(`GitHub getContent ${fullName}/${path} failed`, err);
		}
	}

	// --- Phase 2: read + build core ---

	private split(fullName: string): { owner: string; repo: string } {
		this.assertRepoAllowed(fullName);
		const [owner, repo] = fullName.split("/");
		if (!owner || !repo) {
			throw new GitHubError(
				`Invalid repo "${fullName}" (expected owner/repo).`,
			);
		}
		return { owner, repo };
	}

	private toError(ctx: string, err: unknown): GitHubError {
		if (err instanceof GitHubError) return err;
		const status =
			typeof (err as { status?: number }).status === "number"
				? (err as { status: number }).status
				: undefined;
		const base = `${ctx}: ${err instanceof Error ? err.message : String(err)}`;
		// A 403/404 on a write is almost always a missing App permission or an
		// installation that doesn't cover the repo — annotate it so the model and
		// the user know exactly what to fix instead of seeing GitHub's opaque
		// "Resource not accessible by integration".
		const message =
			status === 403 || status === 404 ? `${base}${scopeHint(ctx)}` : base;
		return new GitHubError(message, status);
	}

	/** Default branch for a repo (cached). */
	async getDefaultBranch(fullName: string): Promise<string> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const res = await octokit.rest.repos.get({ owner, repo });
			return res.data.default_branch;
		} catch (err) {
			throw this.toError(`GitHub repos.get ${fullName} failed`, err);
		}
	}

	/**
	 * Guard: refuse to write directly to a repo's default or any protected
	 * branch. The agent must always work on a feature branch and open a PR.
	 */
	private async assertBranchWritable(
		fullName: string,
		branch: string,
	): Promise<void> {
		const { owner, repo } = this.split(fullName);
		const defaultBranch = await this.getDefaultBranch(fullName);
		if (branch === defaultBranch) {
			throw new GitHubForbiddenError(
				`Refusing to commit directly to the default branch "${branch}" of ${fullName}. Create a feature branch and open a PR.`,
			);
		}
		const octokit = await this.octokit();
		try {
			const res = await octokit.rest.repos.getBranch({ owner, repo, branch });
			if (res.data.protected) {
				throw new GitHubForbiddenError(
					`Refusing to commit to protected branch "${branch}" of ${fullName}.`,
				);
			}
		} catch (err) {
			// A 404 means the branch doesn't exist yet — that's fine for callers
			// that create it. Re-throw the forbidden guard and other errors.
			if (err instanceof GitHubForbiddenError) throw err;
			const status = (err as { status?: number }).status;
			if (status === 404) return;
			throw this.toError(`GitHub getBranch ${fullName}#${branch} failed`, err);
		}
	}

	async listBranches(fullName: string): Promise<BranchSummary[]> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
				owner,
				repo,
				per_page: 100,
			});
			return branches.map((b) => ({
				name: b.name,
				protected: Boolean(b.protected),
				sha: b.commit.sha,
			}));
		} catch (err) {
			throw this.toError(`GitHub listBranches ${fullName} failed`, err);
		}
	}

	async getPr(fullName: string, number: number): Promise<PrSummary> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const res = await octokit.rest.pulls.get({
				owner,
				repo,
				pull_number: number,
			});
			const p = res.data;
			return {
				number: p.number,
				title: p.title,
				state: p.state,
				draft: Boolean(p.draft),
				head: p.head.ref,
				base: p.base.ref,
				url: p.html_url,
				mergeable: p.mergeable,
				author: p.user?.login,
			};
		} catch (err) {
			throw this.toError(`GitHub pulls.get ${fullName}#${number} failed`, err);
		}
	}

	async listPrs(
		fullName: string,
		state: "open" | "closed" | "all" = "open",
	): Promise<PrSummary[]> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const prs = await octokit.paginate(octokit.rest.pulls.list, {
				owner,
				repo,
				state,
				per_page: 50,
			});
			return prs.map((p) => ({
				number: p.number,
				title: p.title,
				state: p.state,
				draft: Boolean(p.draft),
				head: p.head.ref,
				base: p.base.ref,
				url: p.html_url,
				author: p.user?.login,
			}));
		} catch (err) {
			throw this.toError(`GitHub pulls.list ${fullName} failed`, err);
		}
	}

	/**
	 * Create a feature branch from `fromRef` (default: the repo default branch).
	 * Refuses to create the default branch and never overwrites an existing ref.
	 */
	async createBranch(
		fullName: string,
		newBranch: string,
		fromRef?: string,
	): Promise<{ branch: string; sha: string }> {
		const { owner, repo } = this.split(fullName);
		const defaultBranch = await this.getDefaultBranch(fullName);
		if (newBranch === defaultBranch) {
			throw new GitHubForbiddenError(
				`Refusing to create a branch named after the default branch "${newBranch}".`,
			);
		}
		const octokit = await this.octokit();
		try {
			// Resolve the base commit SHA from fromRef (branch name or SHA) or the
			// default branch HEAD.
			const baseRef = fromRef || defaultBranch;
			const baseSha = await this.resolveSha(owner, repo, baseRef);
			await octokit.rest.git.createRef({
				owner,
				repo,
				ref: `refs/heads/${newBranch}`,
				sha: baseSha,
			});
			return { branch: newBranch, sha: baseSha };
		} catch (err) {
			throw this.toError(
				`GitHub createRef ${fullName}#${newBranch} failed`,
				err,
			);
		}
	}

	/** Resolve a branch name or SHA to a commit SHA. */
	private async resolveSha(
		owner: string,
		repo: string,
		ref: string,
	): Promise<string> {
		// 40-hex looks like a SHA already.
		if (/^[0-9a-f]{40}$/i.test(ref)) return ref;
		const octokit = await this.octokit();
		const res = await octokit.rest.git.getRef({
			owner,
			repo,
			ref: `heads/${ref}`,
		});
		return res.data.object.sha;
	}

	/**
	 * Commit one or more files to a feature branch as a SINGLE atomic commit
	 * (Git Data API: blobs → tree → commit → fast-forward ref update). Never
	 * force-pushes; refuses the default/protected branch.
	 */
	async commitFiles(
		fullName: string,
		branch: string,
		files: CommitFileInput[],
		message: string,
	): Promise<{ commitSha: string; url: string }> {
		if (files.length === 0) {
			throw new GitHubError("commitFiles requires at least one file.");
		}
		await this.assertBranchWritable(fullName, branch);
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const headSha = await this.resolveSha(owner, repo, branch);
			const baseCommit = await octokit.rest.git.getCommit({
				owner,
				repo,
				commit_sha: headSha,
			});
			const baseTreeSha = baseCommit.data.tree.sha;

			// Create blobs, then a tree layered on the base tree. Binary files are
			// committed by passing base64 through as-is; text is base64-wrapped.
			const treeItems = await Promise.all(
				files.map(async (f) => {
					const isBase64 = f.encoding === "base64";
					const blob = await octokit.rest.git.createBlob({
						owner,
						repo,
						content: isBase64
							? f.content
							: Buffer.from(f.content, "utf-8").toString("base64"),
						encoding: "base64",
					});
					return {
						path: f.path,
						mode: "100644" as const,
						type: "blob" as const,
						sha: blob.data.sha,
					};
				}),
			);
			const tree = await octokit.rest.git.createTree({
				owner,
				repo,
				base_tree: baseTreeSha,
				tree: treeItems,
			});
			const commit = await octokit.rest.git.createCommit({
				owner,
				repo,
				message,
				tree: tree.data.sha,
				parents: [headSha],
			});
			// Fast-forward only — force defaults to false, so a non-FF update fails
			// loudly instead of clobbering history.
			await octokit.rest.git.updateRef({
				owner,
				repo,
				ref: `heads/${branch}`,
				sha: commit.data.sha,
				force: false,
			});
			return {
				commitSha: commit.data.sha,
				url: commit.data.html_url,
			};
		} catch (err) {
			throw this.toError(
				`GitHub commitFiles ${fullName}#${branch} failed`,
				err,
			);
		}
	}

	/**
	 * Open a PR (find-or-create by head→base). Base defaults to the default
	 * branch. Returns the existing open PR if one already targets head→base.
	 */
	async openPr(
		fullName: string,
		opts: {
			head: string;
			base?: string;
			title: string;
			body?: string;
			draft?: boolean;
		},
	): Promise<PrSummary> {
		const { owner, repo } = this.split(fullName);
		const base = opts.base || (await this.getDefaultBranch(fullName));
		if (opts.head === base) {
			throw new GitHubError(
				`PR head and base are both "${base}" — nothing to merge.`,
			);
		}
		const octokit = await this.octokit();
		try {
			// Idempotency: reuse an existing open PR for this head→base.
			const existing = await octokit.rest.pulls.list({
				owner,
				repo,
				state: "open",
				head: `${owner}:${opts.head}`,
				base,
			});
			if (existing.data.length > 0) {
				return this.getPr(fullName, existing.data[0].number);
			}
			const res = await octokit.rest.pulls.create({
				owner,
				repo,
				head: opts.head,
				base,
				title: opts.title,
				body: opts.body,
				draft: opts.draft,
			});
			const p = res.data;
			return {
				number: p.number,
				title: p.title,
				state: p.state,
				draft: Boolean(p.draft),
				head: p.head.ref,
				base: p.base.ref,
				url: p.html_url,
				author: p.user?.login,
			};
		} catch (err) {
			throw this.toError(`GitHub pulls.create ${fullName} failed`, err);
		}
	}

	/** Update a PR's title/body/base. State changes (close/merge) are gated. */
	async updatePr(
		fullName: string,
		number: number,
		patch: { title?: string; body?: string; base?: string },
	): Promise<PrSummary> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			await octokit.rest.pulls.update({
				owner,
				repo,
				pull_number: number,
				...(patch.title !== undefined ? { title: patch.title } : {}),
				...(patch.body !== undefined ? { body: patch.body } : {}),
				...(patch.base !== undefined ? { base: patch.base } : {}),
			});
			return this.getPr(fullName, number);
		} catch (err) {
			throw this.toError(
				`GitHub pulls.update ${fullName}#${number} failed`,
				err,
			);
		}
	}

	/** Add a comment to a PR or issue (both use the issues comment API). */
	async comment(
		fullName: string,
		number: number,
		body: string,
	): Promise<{ url: string }> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const res = await octokit.rest.issues.createComment({
				owner,
				repo,
				issue_number: number,
				body,
			});
			return { url: res.data.html_url };
		} catch (err) {
			throw this.toError(
				`GitHub createComment ${fullName}#${number} failed`,
				err,
			);
		}
	}

	/**
	 * Open a new issue. A regular write (not gated) — closing an issue is the
	 * separate, approval-gated `closeIssue` path.
	 */
	async createIssue(
		fullName: string,
		opts: {
			title: string;
			body?: string;
			labels?: string[];
			assignees?: string[];
		},
	): Promise<{ number: number; url: string; title: string; state: string }> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const res = await octokit.rest.issues.create({
				owner,
				repo,
				title: opts.title,
				...(opts.body !== undefined ? { body: opts.body } : {}),
				...(opts.labels ? { labels: opts.labels } : {}),
				...(opts.assignees ? { assignees: opts.assignees } : {}),
			});
			const i = res.data;
			return {
				number: i.number,
				url: i.html_url,
				title: i.title,
				state: i.state,
			};
		} catch (err) {
			throw this.toError(`GitHub issues.create ${fullName} failed`, err);
		}
	}

	/**
	 * Update an issue's title/body/labels/assignees. Deliberately does NOT touch
	 * `state` — closing/reopening goes through the approval-gated `closeIssue` so
	 * the human gate can't be bypassed via an update.
	 */
	async updateIssue(
		fullName: string,
		number: number,
		patch: {
			title?: string;
			body?: string;
			labels?: string[];
			assignees?: string[];
		},
	): Promise<{ number: number; url: string; title: string; state: string }> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			await octokit.rest.issues.update({
				owner,
				repo,
				issue_number: number,
				...(patch.title !== undefined ? { title: patch.title } : {}),
				...(patch.body !== undefined ? { body: patch.body } : {}),
				...(patch.labels !== undefined ? { labels: patch.labels } : {}),
				...(patch.assignees !== undefined
					? { assignees: patch.assignees }
					: {}),
			});
			const res = await octokit.rest.issues.get({
				owner,
				repo,
				issue_number: number,
			});
			const i = res.data;
			return {
				number: i.number,
				url: i.html_url,
				title: i.title,
				state: i.state,
			};
		} catch (err) {
			throw this.toError(
				`GitHub issues.update ${fullName}#${number} failed`,
				err,
			);
		}
	}

	// --- Phase 3: gated actions (executed only after human approval) ---

	async mergePr(
		fullName: string,
		number: number,
		method: "merge" | "squash" | "rebase" = "squash",
	): Promise<{ merged: boolean; sha?: string }> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const res = await octokit.rest.pulls.merge({
				owner,
				repo,
				pull_number: number,
				merge_method: method,
			});
			return { merged: res.data.merged, sha: res.data.sha };
		} catch (err) {
			throw this.toError(
				`GitHub pulls.merge ${fullName}#${number} failed`,
				err,
			);
		}
	}

	async deleteBranch(
		fullName: string,
		branch: string,
	): Promise<{ deleted: boolean }> {
		// Same guard as writes: never delete the default or a protected branch.
		await this.assertBranchWritable(fullName, branch);
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			await octokit.rest.git.deleteRef({
				owner,
				repo,
				ref: `heads/${branch}`,
			});
			return { deleted: true };
		} catch (err) {
			throw this.toError(`GitHub deleteRef ${fullName}#${branch} failed`, err);
		}
	}

	async closeIssue(
		fullName: string,
		number: number,
	): Promise<{ closed: boolean }> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			await octokit.rest.issues.update({
				owner,
				repo,
				issue_number: number,
				state: "closed",
			});
			return { closed: true };
		} catch (err) {
			throw this.toError(
				`GitHub issues.update ${fullName}#${number} failed`,
				err,
			);
		}
	}

	async dispatchWorkflow(
		fullName: string,
		workflowId: string,
		ref: string,
		inputs?: Record<string, string>,
	): Promise<{ dispatched: boolean }> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			await octokit.rest.actions.createWorkflowDispatch({
				owner,
				repo,
				workflow_id: workflowId,
				ref,
				...(inputs ? { inputs } : {}),
			});
			return { dispatched: true };
		} catch (err) {
			throw this.toError(
				`GitHub createWorkflowDispatch ${fullName} (${workflowId}) failed`,
				err,
			);
		}
	}

	// --- Phase 4: CI feedback (read-only) ---

	/** Check runs (CI status) for a ref — a branch name, tag, or commit SHA. */
	async getChecks(
		fullName: string,
		ref: string,
	): Promise<{ ref: string; checks: CheckRunSummary[] }> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
				owner,
				repo,
				ref,
				per_page: 100,
			});
			return {
				ref,
				checks: runs.map((c) => ({
					name: c.name,
					status: c.status,
					conclusion: c.conclusion,
					url: c.html_url ?? undefined,
				})),
			};
		} catch (err) {
			throw this.toError(
				`GitHub checks.listForRef ${fullName}@${ref} failed`,
				err,
			);
		}
	}

	/** Recent GitHub Actions workflow runs, optionally filtered to a branch. */
	async getWorkflowRuns(
		fullName: string,
		branch?: string,
		limit = 15,
	): Promise<WorkflowRunSummary[]> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const res = await octokit.rest.actions.listWorkflowRunsForRepo({
				owner,
				repo,
				per_page: Math.min(limit, 50),
				...(branch ? { branch } : {}),
			});
			return res.data.workflow_runs.map((r) => ({
				id: r.id,
				name: r.name ?? r.display_title ?? "",
				event: r.event,
				status: r.status ?? "",
				conclusion: r.conclusion,
				branch: r.head_branch ?? "",
				url: r.html_url,
				createdAt: r.created_at,
			}));
		} catch (err) {
			throw this.toError(`GitHub listWorkflowRuns ${fullName} failed`, err);
		}
	}

	/**
	 * Jobs + step outcomes for a workflow run, with truncated log excerpts for
	 * failing jobs — enough for the agent to diagnose and fix a red CI run.
	 */
	async getRunLogs(
		fullName: string,
		runId: number,
		maxLogChars = 8000,
	): Promise<{
		runId: number;
		conclusion: string | null;
		jobs: Array<{
			name: string;
			status: string;
			conclusion: string | null;
			failedSteps: string[];
			log?: string;
		}>;
	}> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const run = await octokit.rest.actions.getWorkflowRun({
				owner,
				repo,
				run_id: runId,
			});
			const jobsRes = await octokit.paginate(
				octokit.rest.actions.listJobsForWorkflowRun,
				{ owner, repo, run_id: runId, per_page: 50 },
			);
			const jobs = await Promise.all(
				jobsRes.map(async (j) => {
					const failedSteps = (j.steps ?? [])
						.filter((s) => s.conclusion === "failure")
						.map((s) => s.name);
					let log: string | undefined;
					if (j.conclusion === "failure") {
						log = await this.fetchJobLog(owner, repo, j.id, maxLogChars);
					}
					return {
						name: j.name,
						status: j.status,
						conclusion: j.conclusion,
						failedSteps,
						log,
					};
				}),
			);
			return { runId, conclusion: run.data.conclusion, jobs };
		} catch (err) {
			throw this.toError(
				`GitHub getRunLogs ${fullName} run ${runId} failed`,
				err,
			);
		}
	}

	/** Fetch a single job's plain-text log, tail-truncated to maxChars. */
	private async fetchJobLog(
		owner: string,
		repo: string,
		jobId: number,
		maxChars: number,
	): Promise<string> {
		const octokit = await this.octokit();
		try {
			// This endpoint 302-redirects to the raw log; Octokit follows it and
			// returns the text body in `data`.
			const res = await octokit.request(
				"GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
				{ owner, repo, job_id: jobId },
			);
			const text =
				typeof res.data === "string" ? res.data : String(res.data ?? "");
			return text.length > maxChars
				? `…(truncated)\n${text.slice(-maxChars)}`
				: text;
		} catch (err) {
			return `(could not fetch log: ${err instanceof Error ? err.message : String(err)})`;
		}
	}

	/** PR reviews + review comments, so the agent can act on requested changes. */
	async getPrReviews(
		fullName: string,
		number: number,
	): Promise<{ reviews: ReviewSummary[]; comments: ReviewCommentSummary[] }> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const [reviews, comments] = await Promise.all([
				octokit.paginate(octokit.rest.pulls.listReviews, {
					owner,
					repo,
					pull_number: number,
					per_page: 50,
				}),
				octokit.paginate(octokit.rest.pulls.listReviewComments, {
					owner,
					repo,
					pull_number: number,
					per_page: 50,
				}),
			]);
			return {
				reviews: reviews.map((r) => ({
					author: r.user?.login,
					state: r.state,
					body: r.body ?? "",
					submittedAt: r.submitted_at,
				})),
				comments: comments.map((c) => ({
					author: c.user?.login,
					body: c.body,
					path: c.path,
					line: c.line,
				})),
			};
		} catch (err) {
			throw this.toError(
				`GitHub getPrReviews ${fullName}#${number} failed`,
				err,
			);
		}
	}

	// --- Phase 5: UI overview helpers ---

	/** The configured allowlist (lowercased owner/repo slugs). */
	allowedRepos(): string[] {
		return Array.from(this.allowlist);
	}

	/** Open PRs across every allowlisted repo, tagged with their repo. */
	async getAllOpenPrs(): Promise<Array<PrSummary & { repo: string }>> {
		const repos = this.allowedRepos();
		const lists = await Promise.all(
			repos.map(async (r) => {
				try {
					const prs = await this.listPrs(r, "open");
					return prs.map((p) => ({ ...p, repo: r }));
				} catch {
					return [];
				}
			}),
		);
		return lists.flat();
	}

	/** The unified diff for a PR (raw `diff` media type), tail-capped. */
	async getPrDiff(
		fullName: string,
		number: number,
		maxChars = 60_000,
	): Promise<string> {
		const { owner, repo } = this.split(fullName);
		const octokit = await this.octokit();
		try {
			const res = await octokit.rest.pulls.get({
				owner,
				repo,
				pull_number: number,
				mediaType: { format: "diff" },
			});
			// With the diff media type the body is the raw diff text.
			const diff = res.data as unknown as string;
			const text = typeof diff === "string" ? diff : String(diff);
			return text.length > maxChars
				? `${text.slice(0, maxChars)}\n…(diff truncated)`
				: text;
		} catch (err) {
			throw this.toError(`GitHub getPrDiff ${fullName}#${number} failed`, err);
		}
	}
}
