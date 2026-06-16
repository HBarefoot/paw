# Runbook: verify real `git`/`gh` in the workspace (live E2E)

The hermetic tests cover the decision boundary (`classifyGitCommand`), allowlist refusal, merge gating,
and token redaction. A real push/PR needs network + a live token, so verify that end-to-end here once,
against a throwaway **allowlisted** repo. This is the PR #14 class (resolve a conflicted merge then
finish).

## Preconditions
- GitHub App configured (`github.enabled`, `appId`, `installationId`, `github.appPrivateKey` in vault),
  installed on the target repo, and the repo added to `github.repoAllowlist`.
- Image deployed (or a local container) with `git` + `gh` present:
  `git --version` and `gh --version` both succeed in the container shell.

> **Auth is the App installation token — NOT a `GH_TOKEN` env var.** Each `git`/`gh` call mints a fresh
> installation token via the *same* path the `github_*` API tools use (`getInstallationOctokit().auth()`),
> builds a fresh child env from it, and injects it via an ephemeral `GIT_CONFIG_*` extraheader. A
> process-env `GH_TOKEN` is **never read** — setting one does nothing. Invariant: if the API tools can act
> on a repo, `git`/`gh` can too. If the mint fails, the fault is App config (`appId`/`installationId`/
> `appPrivateKey` in the vault) or the allowlist — not a missing `GH_TOKEN`.

## Steps (drive Paw via chat; it calls the `git`/`gh` tools)
1. **Clone + branch from main** — Paw calls
   `git { repo:"<owner>/<repo>", args:["checkout","-b","paw/e2e","origin/main"] }`
   (the working copy is auto-cloned on first use under `<workspace>/.paw-git/<owner>/<repo>`).
2. **Edit + delete a file**, then `git add -A` and
   `git { ..., args:["commit","-m","paw e2e"] }`.
3. **Push the feature branch** — `git { ..., args:["push","-u","origin","paw/e2e"] }` → succeeds
   (feature branch, not protected).
4. **Open a PR** — `gh { repo:"<owner>/<repo>", args:["pr","create","--fill","--base","main"] }`
   (the tool injects `-R <owner>/<repo>`).
5. **Conflicted-merge resolution (the PR #14 fix)** — on the feature branch:
   `git { ..., args:["merge","-s","ours","origin/main"] }` (or resolve normally), then re-push (step 3).
   The PR flips to `mergeable`.
6. **Merge is gated** — `gh { ..., args:["pr","merge","<n>","--squash"] }` returns
   `{ queued: true, id }` and does **not** merge. Approve it at `/access`-style approvals:
   `POST /api/approvals/<id>/approve` (or the Slack/web prompt). Only then does it merge.

## Asserts (security)
- **Refusals:** `git push origin main` → "Refused"; a non-allowlisted repo → refused with **no** clone.
- **No token on disk:** in the clone dir,
  `grep -ri 'x-access-token\|ghs_\|Authorization' .git/config` → **no matches** (auth is injected via the
  ephemeral `GIT_CONFIG_*` extraheader in the child env, never persisted).
- **No token in logs:** the token never appears in the tool output shown to the model, the `tool_log`
  (`output_preview`), or `audit_log` (`details`) — they show `***`/`[REDACTED]`.

## Fork note (construction-agent)
`gh` must target `-R HBarefoot/construction-agent` explicitly (the tool already injects `-R`); never rely
on remote inference, which resolves the wrong (upstream) remote on the fork.

## Result (record each live run)
The hermetic tests (`tests/integrations/github/client.test.ts`, `tests/tools/git-tools.test.ts`) prove the
mint path and the security boundary in CI. This section records the **live** run, which needs the App
private key from the **deployed instance's vault** + network — so it runs **post-deploy** on the deployed
Paw (or a container with the vault key), not from a local checkout.

Capability chain to get here: binaries ✓ · auth-path ✓ (#162) · sandbox permission ✓ (#164) · token mint ✓
(`fix/installation-token-401` — `getInstallationToken` now mints a real `ghs_…` installation access token
via `POST /app/installations/{id}/access_tokens` instead of returning the App JWT, which caused
`HTTP 401: Bad credentials`). The first green live run below is the end-to-end proof.

| Date | Repo | Clone | Push branch | `gh pr create` | `.git/config` token-free | Notes |
|------|------|-------|-------------|----------------|--------------------------|-------|
| _pending post-deploy_ (fix/installation-token-401) | `HBarefoot/portfolio-henry` | | | | | first confirm `gh pr list` → no 401; then smoke: delete `src/app/.next/` → PR |

Fill a row per run: confirm `gh pr list` returns with no 401, then clone → branch-from-main → edit/delete →
push feature branch → `gh pr create` → confirm the PR exists, and
`grep -ri 'x-access-token\|ghs_\|Authorization' .git/config` → **no matches**.
