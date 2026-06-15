# Prompt: give Paw real git — `gh` + `git` in the workspace with a scoped, auto-rotating token

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`.**
One PR: `feat/workspace-git-gh`.

## Why (verified, not hypothetical)
Paw can read repos (`github_read_file`) and write single files (`github_commit_files`) through the
GitHub **API**, but it has **no real git**: the exec workspace has no `git`/`gh`/`curl`, and the API
tools **cannot** (a) delete files (`content: null` is rejected), (b) resolve a **conflicted merge**, or
(c) do a strategy-merge. Net effect, observed on `HBarefoot/portfolio-henry` PR #14: Paw resolved the
work, committed the tree, got the build green — then **could not finish** because the branch was
`mergeable_state: dirty` against `main` and there is no API path to a `merge -s ours` + push. It looped
asking for git auth. This PR closes that gap so Paw can clone → branch-from-main → commit → push →
open/merge PRs autonomously.

## Goal
Add `git` + GitHub CLI (`gh`) to Paw's exec workspace, authenticated with a **scoped, short-lived**
token, so `execute_code`/`exec_command` can run real git workflows — gated by the existing repo
allowlist and approval queue. **Do not** weaken the kernel's security posture to get there.

## Design (decide the exact shape; these are the constraints)

### 1. Tooling in the image
Install `git` and `gh` in the runtime/workspace image. Keep the install pinned and minimal.

### 2. Auth — reuse the GitHub App installation token (preferred)
Paw already mints an **installation token** for the `github_*` tools. Reuse it: export it into the exec
environment (e.g. `GH_TOKEN`/`GITHUB_TOKEN`) for the duration of a git call and run `gh auth setup-git`
(or a git credential helper) so `git push` authenticates as the app.
- It's already **installation-scoped** (only installed repos, `contents: write`, `pull_requests`) and
  **short-lived (~1h)** — refresh on the same cadence/path as the API-tool token; never let a stale
  token reach `git push` (that was a separate prod symptom — a stale installation token broke reads
  until restart).
- **Token hygiene (load-bearing):** the token lives only in the **ephemeral** workspace env for the
  call; it is **never** written to disk, never persisted in `config.json`, and is **redacted** from any
  captured stdout/stderr, the tool-log, and `audit_logs`. Verify the redaction — don't assume it.
- Fallback only if app-token plumbing into the shell is genuinely heavy: a fine-grained PAT in the
  vault (`github.token` slot), same scoping rules. Prefer the app token (auto-rotates, already scoped).

### 3. Surface — don't loosen `exec_command` globally
`exec_command` is single-command / no-shell-operators by design; don't relax that for everyone.
Choose one and justify it:
- (a) Let Paw drive multi-step git via **`execute_code`** (its preferred multi-step path) issuing
  individual `git`/`gh` invocations, **or**
- (b) add a thin, **audited `git`/`gh` passthrough** tool that enforces the allowlist + approvals.

### 4. Allowlist + approvals (reuse, don't fork)
- `git`/`gh` may only target repos in the **GitHub allowlist** — a non-allowlisted repo is **refused**.
- **Never push to `main`** (Railway auto-deploys). Pushes to protected branches and **merges** route
  through the **channel-agnostic approval queue** (conventions seam #7: `GET /api/approvals/pending` +
  `POST /api/approvals/:id/approve|deny`). Branch pushes + PR opens can be allowed without approval;
  merges to `main` require it. Decide the exact line and state it in the PR body.
- Encode the branch-from-main / small-PR / merge-fast discipline (already in `_CONVENTIONS.md` §Standing
  rules) into whatever helper you add, so Paw can't stack branches.

### 5. Fork gotcha
On the `construction-agent` fork, `gh pr …` resolves the wrong remote (upstream/paw). Any `gh` call
must target the explicit repo (`gh … -R <owner>/<repo>`), never rely on remote inference.

## Tests (must fail on pre-change code)
- Paw can **clone an allowlisted repo, branch from `main`, commit, push, and open a PR** end-to-end
  (integration harness or a documented, reproducible manual run committed to the PR).
- A `git`/`gh` op against a **non-allowlisted** repo is **refused**.
- A **merge to `main`** is blocked without an approved approval-queue entry.
- The token **never appears** in the tool-log, `audit_logs`, or captured command output (assert
  redaction — this is the regression test that fails today).
- Existing `github_*` API tools still work (no regression).

## Operator note (Henry)
This is the capability that lets Paw finish conflicted PRs on its own (the PR #14 class). Until it
lands + deploys, conflicted merges stay a manual `git merge -s ours` + push. **Security fix → merge
down to the construction-agent fork** (same kernel, same gap).
