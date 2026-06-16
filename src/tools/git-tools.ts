import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type GitHubApprovals,
	originFromSessionId,
} from "../integrations/github/approvals.js";
import type { GitHubClient } from "../integrations/github/client.js";
import type { ToolDefinition, ToolResult } from "../types/message.js";

/**
 * Real `git` + `gh` in the exec workspace, authenticated with the GitHub App
 * installation token (auto-rotating, installation-scoped). This is the only path
 * to clone → branch-from-main → resolve-conflict → commit → push → open/merge a
 * PR autonomously — the GitHub API tools can't delete files, resolve a conflicted
 * merge, or strategy-merge.
 *
 * Security boundary (NOT a general shell):
 *  - Every call names an explicit `owner/repo`; non-allowlisted repos are refused
 *    before anything spawns.
 *  - `git push` to a protected branch (default `main`) and any force-push are
 *    REFUSED. `gh pr merge` (a merge to a base that may be `main`) is GATED through
 *    the channel-agnostic approval queue, never executed inline.
 *  - The token is fetched fresh per call, injected ONLY into the child env via an
 *    ephemeral `http.extraheader` (never a remote URL or `.git/config` on disk),
 *    and REDACTED from all captured output before it reaches the model or logs.
 *  - `gh` always targets `-R owner/repo` (never relies on remote inference — the
 *    construction-agent fork resolves the wrong remote otherwise).
 */

export interface GitToolsDeps {
	client: GitHubClient;
	approvals?: GitHubApprovals | null;
	/** Workspace root; per-repo working copies live under `<root>/.paw-git`. */
	workspacePath: string;
	/** Branches git/gh may not push to directly; merges to them are gated. */
	protectedBranches?: string[];
	maxOutputLength?: number;
	/** Per-invocation timeout (ms). Clones can be slow — default 180s. */
	execTimeout?: number;
	audit?: (action: string, details: Record<string, unknown>) => void;
	/**
	 * Absolute path to the `git` binary. Omit (`undefined`) to resolve once at
	 * registration via `Bun.which`; pass a string to pin it; pass `null` to force
	 * the "not installed" path. A testability seam so the spawned argv is
	 * deterministic and the not-found branch is exercisable.
	 */
	gitBin?: string | null;
	/** Absolute path to the `gh` binary — same resolution rules as `gitBin`. */
	ghBin?: string | null;
}

export type GitClassification =
	| { action: "allow" }
	| { action: "refuse"; reason: string }
	| {
			action: "gate-merge";
			summary: string;
			params: Record<string, unknown>;
	  };

const FORCE_FLAGS = new Set(["--force", "-f", "--mirror"]);

/** `gh` subcommands that accept `-R owner/repo`. NOT `api` (repo is in the path). */
const GH_REPO_FLAG_SUBCMDS = new Set([
	"pr",
	"issue",
	"repo",
	"run",
	"release",
	"workflow",
	"browse",
	"label",
]);

/**
 * A PATH that resolves `git`/`gh` even when the inherited `process.env.PATH` is
 * stripped/empty at spawn time (the Railway-container ENOENT). Standard bin dirs
 * first, then whatever the process inherited.
 */
function resolvePath(): string {
	return ["/usr/local/bin", "/usr/bin", "/bin", process.env.PATH]
		.filter(Boolean)
		.join(":");
}

function normalizeBranch(ref: string): string {
	const parts = ref.split(":");
	const dst = parts[parts.length - 1] ?? ref;
	return dst.replace(/^\+/, "").replace(/^refs\/heads\//, "");
}

/**
 * Pure decision for a `git`/`gh` invocation — the security boundary, unit-tested
 * in isolation. `currentBranch` (resolved from the clone's HEAD by the handler)
 * is used only when a `git push` gives no explicit refspec.
 */
export function classifyGitCommand(
	tool: "git" | "gh",
	args: string[],
	opts: { protectedBranches: string[]; currentBranch?: string },
): GitClassification {
	const protectedSet = new Set(
		opts.protectedBranches.map((b) => b.trim().toLowerCase()).filter(Boolean),
	);
	const isProtected = (b: string | undefined): boolean =>
		!!b && protectedSet.has(b.trim().toLowerCase());

	if (tool === "git") {
		if (args[0] !== "push") return { action: "allow" };

		if (
			args.some((a) => FORCE_FLAGS.has(a) || a.startsWith("--force-with-lease"))
		)
			return { action: "refuse", reason: "force-push is not allowed" };
		if (args.includes("--all"))
			return {
				action: "refuse",
				reason: "push --all is not allowed (it could push a protected branch)",
			};

		const positional = args.slice(1).filter((a) => !a.startsWith("-"));
		// positional ~ [remote?, refspec?]; no refspec → the checked-out branch.
		const dst =
			positional.length >= 2
				? normalizeBranch(positional[1])
				: opts.currentBranch;
		if (isProtected(dst))
			return {
				action: "refuse",
				reason: `push to protected branch "${dst}" is not allowed. Push a feature branch and open a PR; merges to ${[...protectedSet].join("/")} go through approval.`,
			};
		return { action: "allow" };
	}

	// gh
	if (args[0] === "repo" && (args[1] === "delete" || args[1] === "archive"))
		return { action: "refuse", reason: `gh repo ${args[1]} is not allowed` };
	if (args[0] === "pr" && args[1] === "merge") {
		const num = args.slice(2).find((a) => /^\d+$/.test(a));
		return {
			action: "gate-merge",
			summary: num ? `Merge PR #${num}` : "Merge a pull request",
			params: num ? { number: Number(num) } : {},
		};
	}
	return { action: "allow" };
}

/** Branch checked out in a clone, or undefined (not cloned / detached HEAD). */
function currentBranchOf(cloneDir: string): string | undefined {
	try {
		const head = readFileSync(join(cloneDir, ".git", "HEAD"), "utf8").trim();
		const m = head.match(/^ref:\s+refs\/heads\/(.+)$/);
		return m ? m[1] : undefined;
	} catch {
		return undefined;
	}
}

export function createGitTools(deps: GitToolsDeps): ToolDefinition[] {
	const protectedBranches =
		deps.protectedBranches && deps.protectedBranches.length > 0
			? deps.protectedBranches
			: ["main"];
	const maxOutputLength = deps.maxOutputLength ?? 30_000;
	const timeout =
		deps.execTimeout && deps.execTimeout > 0 ? deps.execTimeout : 180_000;
	const gitRoot = join(deps.workspacePath, ".paw-git");
	// Isolated HOME so the child never reads a developer's ~/.gitconfig or a
	// persisted ~/.config/gh/hosts.yml — auth comes only from the per-call env.
	const homeDir = join(tmpdir(), "paw-git-home");

	// Resolve the binaries to ABSOLUTE paths ONCE so the spawn never depends on
	// the child env's PATH (the `posix_spawn 'git' ENOENT` on Railway: a bare
	// name + a stripped PATH won't resolve even though git is at /usr/bin/git).
	// `undefined` deps → resolve via Bun.which; a string pins it; `null` = absent.
	const gitBin =
		deps.gitBin !== undefined
			? deps.gitBin
			: (Bun.which("git", { PATH: resolvePath() }) ?? null);
	const ghBin =
		deps.ghBin !== undefined
			? deps.ghBin
			: (Bun.which("gh", { PATH: resolvePath() }) ?? null);
	// Verify-first diagnostic (one-time, at boot): shows whether PATH was stripped
	// and where the binaries resolved. No secrets in this line.
	console.log(
		`[git-tools] resolved git=${gitBin ?? "NOT FOUND"} gh=${ghBin ?? "NOT FOUND"} PATH=${process.env.PATH ? "set" : "EMPTY"}`,
	);

	const cloneDirFor = (owner: string, name: string): string =>
		join(gitRoot, owner, name);

	// Build a FRESH child env per call from the just-minted App installation token.
	// A process-env GH_TOKEN is NEVER consulted — the GH_TOKEN/GITHUB_TOKEN set here
	// come from `token` (minted by client.getInstallationToken()), so setting a
	// GH_TOKEN on the host does nothing. Auth is the App installation token, period.
	function buildEnv(token: string): {
		env: Record<string, string>;
		b64: string;
	} {
		const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
		return {
			b64,
			env: {
				PATH: resolvePath(),
				HOME: homeDir,
				LANG: process.env.LANG ?? "C.UTF-8",
				GIT_TERMINAL_PROMPT: "0",
				GH_PROMPT_DISABLED: "1",
				GH_NO_UPDATE_NOTIFIER: "1",
				GH_TOKEN: token,
				GITHUB_TOKEN: token,
				// Ephemeral auth header for github.com — kept in the child ENV only,
				// never written to .git/config or a remote URL.
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
				GIT_CONFIG_VALUE_0: `Authorization: Basic ${b64}`,
			},
		};
	}

	// Replace EVERY occurrence of the token (and its base64 auth form) with ***
	// before any output reaches the model or the tool-log.
	function redactSecrets(s: string, token: string, b64: string): string {
		if (!s) return s;
		return s.split(token).join("***").split(b64).join("***");
	}

	async function run(
		bin: string,
		args: string[],
		cwd: string,
		token: string,
		b64: string,
		env: Record<string, string>,
	): Promise<{ output: string; isError: boolean }> {
		const proc = Bun.spawn([bin, ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			env,
		});
		const timer = setTimeout(() => proc.kill(), timeout);
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		clearTimeout(timer);

		let output = "";
		if (stdout) output += stdout;
		if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;
		output += `\n[exit code: ${exitCode}]`;
		output = redactSecrets(output, token, b64);
		if (output.length > maxOutputLength)
			output = `${output.slice(0, maxOutputLength)}\n... (truncated)`;
		return { output, isError: exitCode !== 0 };
	}

	function parseRepo(
		input: Record<string, unknown>,
	): { repo: string; owner: string; name: string } | { error: string } {
		const repo = String(input.repo ?? "").trim();
		const [owner, name] = repo.split("/");
		if (!owner || !name || repo.split("/").length !== 2)
			return { error: 'Provide "repo" as "owner/name".' };
		if (!deps.client.isRepoAllowed(repo))
			return {
				error: `Repo "${repo}" is not in the GitHub allowlist — refused.`,
			};
		return { repo, owner, name };
	}

	function parseArgs(input: Record<string, unknown>): string[] | null {
		const a = input.args;
		if (!Array.isArray(a) || a.some((x) => typeof x !== "string")) return null;
		return a as string[];
	}

	const git: ToolDefinition = {
		name: "git",
		description:
			'Run real git in a managed per-repo working copy (auto-cloned from the allowlisted repo on first use). Authenticated as the GitHub App. Use for clone/branch/merge/commit/push and conflict resolution. NEVER pushes to a protected branch (main) or force-pushes — push a feature branch and open a PR with the `gh` tool. Pass args as an array, e.g. {"repo":"owner/name","args":["checkout","-b","fix/x","origin/main"]}.',
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: {
					type: "string",
					description: "owner/name (must be allowlisted)",
				},
				args: {
					type: "array",
					items: { type: "string" },
					description: 'git arguments (no shell), e.g. ["status"]',
				},
			},
			required: ["repo", "args"],
		},
		handler: async (input): Promise<ToolResult> => {
			if (!gitBin)
				return {
					content:
						"git is not installed (no `git` binary found on PATH). Cannot run git commands.",
					is_error: true,
				};
			const r = parseRepo(input);
			if ("error" in r) return { content: r.error, is_error: true };
			const args = parseArgs(input);
			if (!args)
				return { content: 'Provide "args" as a string array.', is_error: true };

			const cloneDir = cloneDirFor(r.owner, r.name);
			const cls = classifyGitCommand("git", args, {
				protectedBranches,
				currentBranch: currentBranchOf(cloneDir),
			});
			if (cls.action === "refuse")
				return { content: `Refused: ${cls.reason}`, is_error: true };

			let token: string;
			try {
				token = await deps.client.getInstallationToken();
			} catch (err) {
				return {
					content: `Error: could not mint the GitHub App installation token (${err instanceof Error ? err.message : String(err)}). Check the App config (appId / installationId / appPrivateKey in the vault) and that "${r.repo}" is allowlisted. git/gh authenticate via the App token — do NOT set a GH_TOKEN env var.`,
					is_error: true,
				};
			}
			const { env, b64 } = buildEnv(token);
			mkdirSync(homeDir, { recursive: true });

			try {
				// Auto-clone the working copy on first use (skip if args IS a clone).
				const isClone = args[0] === "clone";
				if (!isClone && !existsSync(join(cloneDir, ".git"))) {
					mkdirSync(join(gitRoot, r.owner), { recursive: true });
					const cl = await run(
						gitBin,
						["clone", `https://github.com/${r.repo}.git`, cloneDir],
						gitRoot,
						token,
						b64,
						env,
					);
					if (cl.isError)
						return {
							content: `Clone failed:\n${cl.output}`,
							is_error: true,
						};
				}
				const cwd = isClone ? gitRoot : cloneDir;
				const res = await run(gitBin, args, cwd, token, b64, env);
				deps.audit?.("git.exec", {
					repo: r.repo,
					argv0: args[0],
					isError: res.isError,
				});
				return { content: res.output, is_error: res.isError };
			} catch (err) {
				return {
					content: `Error running git: ${redactSecrets(err instanceof Error ? err.message : String(err), token, b64)}`,
					is_error: true,
				};
			}
		},
	};

	const gh: ToolDefinition = {
		name: "gh",
		description:
			'Run the GitHub CLI against an allowlisted repo. `-R owner/name` is added automatically for `pr`/`issue`/`repo`/`run`/`release`/`workflow`/`browse`/`label`; `gh api` is NOT given `-R` (put the repo in the path, e.g. ["api","repos/owner/name/pulls"]). Use for `pr create`, `pr view`, `pr checks`, `run view`, `api`, etc. `gh pr merge` is NOT run inline — it is queued for human approval (merges can target main). Pass args as an array, e.g. {"repo":"owner/name","args":["pr","create","--fill","--base","main"]}.',
		plugin: "github",
		input_schema: {
			type: "object",
			properties: {
				repo: {
					type: "string",
					description: "owner/name (must be allowlisted)",
				},
				args: {
					type: "array",
					items: { type: "string" },
					description: 'gh arguments (no shell), e.g. ["pr","list"]',
				},
			},
			required: ["repo", "args"],
		},
		handler: async (input): Promise<ToolResult> => {
			if (!ghBin)
				return {
					content:
						"gh is not installed (no `gh` binary found on PATH). Cannot run GitHub CLI commands.",
					is_error: true,
				};
			const r = parseRepo(input);
			if ("error" in r) return { content: r.error, is_error: true };
			const args = parseArgs(input);
			if (!args)
				return { content: 'Provide "args" as a string array.', is_error: true };

			const cls = classifyGitCommand("gh", args, { protectedBranches });
			if (cls.action === "refuse")
				return { content: `Refused: ${cls.reason}`, is_error: true };
			if (cls.action === "gate-merge") {
				if (!deps.approvals)
					return {
						content:
							"Merge requires approval but the approval queue is unavailable.",
						is_error: true,
					};
				const sid =
					typeof input.__sessionId === "string" ? input.__sessionId : null;
				const id = deps.approvals.enqueue(
					"merge_pr",
					r.repo,
					`${cls.summary} in ${r.repo}`,
					cls.params,
					sid ?? "agent",
					originFromSessionId(sid),
				);
				deps.audit?.("git.merge.queued", { repo: r.repo, id });
				return {
					content: JSON.stringify({
						queued: true,
						id,
						message:
							"Merge queued for human approval — it will NOT merge until approved.",
					}),
				};
			}

			let token: string;
			try {
				token = await deps.client.getInstallationToken();
			} catch (err) {
				return {
					content: `Error: could not mint the GitHub App installation token (${err instanceof Error ? err.message : String(err)}). Check the App config (appId / installationId / appPrivateKey in the vault) and that "${r.repo}" is allowlisted. git/gh authenticate via the App token — do NOT set a GH_TOKEN env var.`,
					is_error: true,
				};
			}
			const { env, b64 } = buildEnv(token);
			mkdirSync(homeDir, { recursive: true });
			const cloneDir = cloneDirFor(r.owner, r.name);
			const cwd = existsSync(cloneDir) ? cloneDir : deps.workspacePath;
			// Pin the repo with -R, but ONLY for subcommands that accept it — never
			// `gh api` (its repo goes in the request path; -R errors). Pass through
			// calls that already pin a repo. The allowlist check ran in parseRepo.
			const alreadyPinned = args.includes("-R") || args.includes("--repo");
			const ghArgs =
				!alreadyPinned && GH_REPO_FLAG_SUBCMDS.has(args[0])
					? [...args, "-R", r.repo]
					: args;
			try {
				const res = await run(ghBin, ghArgs, cwd, token, b64, env);
				deps.audit?.("gh.exec", {
					repo: r.repo,
					argv0: args[0],
					isError: res.isError,
				});
				return { content: res.output, is_error: res.isError };
			} catch (err) {
				return {
					content: `Error running gh: ${redactSecrets(err instanceof Error ? err.message : String(err), token, b64)}`,
					is_error: true,
				};
			}
		},
	};

	return [git, gh];
}
