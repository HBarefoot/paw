import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { basename, isAbsolute } from "node:path";
import type { GitHubClient } from "../../src/integrations/github/client.js";
import {
	type GitToolsDeps,
	classifyGitCommand,
	createGitTools,
} from "../../src/tools/git-tools.js";
import type { ToolDefinition } from "../../src/types/message.js";

// ---- classifyGitCommand (the pure security boundary) ----
describe("classifyGitCommand", () => {
	const opts = { protectedBranches: ["main"] };

	test("git push to a protected branch is refused", () => {
		expect(
			classifyGitCommand("git", ["push", "origin", "main"], opts).action,
		).toBe("refuse");
		// explicit src:dst form
		expect(
			classifyGitCommand("git", ["push", "origin", "HEAD:main"], opts).action,
		).toBe("refuse");
	});

	test("git push to a feature branch is allowed", () => {
		expect(
			classifyGitCommand("git", ["push", "origin", "fix/x"], opts).action,
		).toBe("allow");
		expect(
			classifyGitCommand("git", ["push", "-u", "origin", "fix/x"], opts).action,
		).toBe("allow");
	});

	test("git push with no refspec uses the checked-out branch", () => {
		expect(
			classifyGitCommand("git", ["push"], {
				protectedBranches: ["main"],
				currentBranch: "main",
			}).action,
		).toBe("refuse");
		expect(
			classifyGitCommand("git", ["push"], {
				protectedBranches: ["main"],
				currentBranch: "fix/x",
			}).action,
		).toBe("allow");
	});

	test("force-push and --all are refused", () => {
		expect(
			classifyGitCommand("git", ["push", "--force", "origin", "fix/x"], opts)
				.action,
		).toBe("refuse");
		expect(
			classifyGitCommand(
				"git",
				["push", "--force-with-lease", "origin", "fix/x"],
				opts,
			).action,
		).toBe("refuse");
		expect(
			classifyGitCommand("git", ["push", "--all", "origin"], opts).action,
		).toBe("refuse");
	});

	test("ordinary git commands are allowed", () => {
		for (const a of [
			["status"],
			["checkout", "-b", "fix/x", "origin/main"],
			["merge", "-s", "ours", "origin/main"],
			["rm", "f.txt"],
		])
			expect(classifyGitCommand("git", a, opts).action).toBe("allow");
	});

	test("gh pr merge is gated, with the PR number captured", () => {
		const c = classifyGitCommand("gh", ["pr", "merge", "14", "--squash"], opts);
		expect(c.action).toBe("gate-merge");
		if (c.action === "gate-merge") expect(c.params).toEqual({ number: 14 });
	});

	test("gh pr create / repo delete", () => {
		expect(
			classifyGitCommand("gh", ["pr", "create", "--fill"], opts).action,
		).toBe("allow");
		expect(classifyGitCommand("gh", ["repo", "delete"], opts).action).toBe(
			"refuse",
		);
	});
});

// ---- tool handlers (mocked Bun.spawn + fake deps) ----
const TOKEN = "ghs_SECRETtoken1234567890ABCDEFabcdef";

let spawnCalls: string[][] = [];
// biome-ignore lint/suspicious/noExplicitAny: test shim for Bun.spawn
let realSpawn: any;

function mockSpawn(stdout: string, exitCode = 0) {
	// biome-ignore lint/suspicious/noExplicitAny: minimal proc stub
	(Bun as any).spawn = (argv: string[]) => {
		spawnCalls.push(argv);
		return {
			stdout,
			stderr: "",
			exited: Promise.resolve(exitCode),
			kill() {},
		};
	};
}

function fakeDeps(over: Partial<GitToolsDeps> = {}): {
	deps: GitToolsDeps;
	enqueued: Array<Record<string, unknown>>;
} {
	const enqueued: Array<Record<string, unknown>> = [];
	const client = {
		isRepoAllowed: (r: string) => r === "HBarefoot/portfolio-henry",
		getInstallationToken: async () => TOKEN,
	} as unknown as GitHubClient;
	const approvals = {
		enqueue: (
			action: string,
			repo: string,
			summary: string,
			params: Record<string, unknown>,
		) => {
			enqueued.push({ action, repo, summary, params });
			return "pa_1";
		},
	} as unknown as GitToolsDeps["approvals"];
	const deps: GitToolsDeps = {
		client,
		approvals,
		workspacePath: "/tmp/paw-git-test-ws",
		protectedBranches: ["main"],
		// Pin the binaries so the spawned argv[0] is a known absolute path —
		// deterministic and independent of whether the CI runner has git/gh.
		gitBin: "/usr/bin/git",
		ghBin: "/usr/bin/gh",
		...over,
	};
	return { deps, enqueued };
}

function tools(deps: GitToolsDeps): {
	git: ToolDefinition;
	gh: ToolDefinition;
} {
	const [git, gh] = createGitTools(deps);
	return { git, gh };
}

beforeEach(() => {
	spawnCalls = [];
	// biome-ignore lint/suspicious/noExplicitAny: save original
	realSpawn = (Bun as any).spawn;
});
afterEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: restore original
	(Bun as any).spawn = realSpawn;
});

describe("git/gh tool handlers", () => {
	test("a non-allowlisted repo is refused without spawning", async () => {
		mockSpawn("should not run");
		const { deps } = fakeDeps();
		const { git } = tools(deps);
		const res = await git.handler({ repo: "evil/repo", args: ["status"] });
		expect(res.is_error).toBe(true);
		expect(String(res.content)).toContain("not in the GitHub allowlist");
		expect(spawnCalls.length).toBe(0);
	});

	test("gh pr merge is queued for approval — never run inline", async () => {
		mockSpawn("should not run");
		const f = fakeDeps();
		const { gh } = tools(f.deps);
		const res = await gh.handler({
			repo: "HBarefoot/portfolio-henry",
			args: ["pr", "merge", "14", "--squash"],
		});
		expect(spawnCalls.length).toBe(0); // not executed
		expect(f.enqueued).toHaveLength(1);
		expect(f.enqueued[0]).toMatchObject({
			action: "merge_pr",
			params: { number: 14 },
		});
		expect(String(res.content)).toContain("queued");
	});

	test("the installation token is REDACTED from gh output", async () => {
		// gh emits the token in its output; the tool must never surface it.
		mockSpawn(`authenticated with ${TOKEN}\nok`);
		const { deps } = fakeDeps();
		const { gh } = tools(deps);
		const res = await gh.handler({
			repo: "HBarefoot/portfolio-henry",
			args: ["pr", "view", "14"],
		});
		expect(String(res.content)).not.toContain(TOKEN);
		expect(String(res.content)).toContain("***");
	});

	test("a minted token reaches Bun.spawn — the mint no longer short-circuits", async () => {
		// fix/git-gh-installation-token: when getInstallationToken resolves (App token
		// minted), the handler must SPAWN gh, not error before it. (The real mint is
		// covered in client.test.ts; here the token is stubbed to assert the path.)
		mockSpawn("ok");
		const { deps } = fakeDeps();
		const { gh } = tools(deps);
		const res = await gh.handler({
			repo: "HBarefoot/portfolio-henry",
			args: ["pr", "create", "--fill", "--base", "main"],
		});
		expect(spawnCalls.length).toBeGreaterThan(0);
		expect(res.is_error).toBeFalsy();
	});

	test("gh always pins the repo with -R owner/name", async () => {
		mockSpawn("ok");
		const { deps } = fakeDeps();
		const { gh } = tools(deps);
		await gh.handler({
			repo: "HBarefoot/portfolio-henry",
			args: ["pr", "list"],
		});
		const argv = spawnCalls[spawnCalls.length - 1] ?? [];
		expect(basename(argv[0])).toBe("gh");
		expect(argv).toContain("-R");
		expect(argv).toContain("HBarefoot/portfolio-henry");
	});

	// fix/git-gh-spawn-and-flags — Fix 1: spawn an ABSOLUTE binary path so the
	// child env's (possibly stripped) PATH can't cause `posix_spawn ENOENT`.
	test("spawns the resolved absolute binary, not the bare name", async () => {
		mockSpawn("ok");
		const { deps } = fakeDeps();
		const { gh } = tools(deps);
		await gh.handler({
			repo: "HBarefoot/portfolio-henry",
			args: ["pr", "list"],
		});
		const argv = spawnCalls[spawnCalls.length - 1] ?? [];
		expect(isAbsolute(argv[0])).toBe(true); // pre-change: argv[0] === "gh"
		expect(basename(argv[0])).toBe("gh");
	});

	test("git spawns the resolved absolute binary too", async () => {
		mockSpawn("ok");
		const { deps } = fakeDeps();
		const { git } = tools(deps);
		await git.handler({
			repo: "HBarefoot/portfolio-henry",
			args: ["status"],
		});
		// first spawn is the auto-clone, last is the actual command — both git
		for (const argv of spawnCalls) {
			expect(isAbsolute(argv[0])).toBe(true);
			expect(basename(argv[0])).toBe("git");
		}
	});

	// fix/git-gh-spawn-and-flags — Fix 2: `gh api` must NOT get -R (its repo is in
	// the request path; -R errors with "unknown shorthand flag: 'R'").
	test("gh api gets NO -R (repo is in the path)", async () => {
		mockSpawn("{}");
		const { deps } = fakeDeps();
		const { gh } = tools(deps);
		await gh.handler({
			repo: "HBarefoot/portfolio-henry",
			args: ["api", "repos/HBarefoot/portfolio-henry/pulls"],
		});
		const argv = spawnCalls[spawnCalls.length - 1] ?? [];
		expect(argv).not.toContain("-R"); // pre-change: -R was appended
		expect(basename(argv[0])).toBe("gh");
	});

	test("a repo-flag subcommand (pr) still gets -R owner/name", async () => {
		mockSpawn("ok");
		const { deps } = fakeDeps();
		const { gh } = tools(deps);
		await gh.handler({
			repo: "HBarefoot/portfolio-henry",
			args: ["pr", "view", "14"],
		});
		const argv = spawnCalls[spawnCalls.length - 1] ?? [];
		expect(argv).toContain("-R");
		expect(argv).toContain("HBarefoot/portfolio-henry");
	});

	test("missing binary → clear error, no spawn", async () => {
		mockSpawn("should not run");
		const { deps } = fakeDeps({ ghBin: null });
		const { gh } = tools(deps);
		const res = await gh.handler({
			repo: "HBarefoot/portfolio-henry",
			args: ["pr", "list"],
		});
		expect(res.is_error).toBe(true);
		expect(String(res.content)).toContain("gh is not installed");
		expect(spawnCalls.length).toBe(0);
	});

	test("git push to main is refused without spawning", async () => {
		mockSpawn("should not run");
		const { deps } = fakeDeps();
		const { git } = tools(deps);
		const res = await git.handler({
			repo: "HBarefoot/portfolio-henry",
			args: ["push", "origin", "main"],
		});
		expect(res.is_error).toBe(true);
		expect(String(res.content)).toContain("Refused");
		expect(spawnCalls.length).toBe(0);
	});
});
