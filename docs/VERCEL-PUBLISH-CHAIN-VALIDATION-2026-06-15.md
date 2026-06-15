# Vercel publish-chain validation — failure-mode map & readiness audit

**Date:** 2026-06-15 · **Scope:** prove `static page → GitHub repo → live Vercel URL` is reliable
enough to build Vercel Phase 2 on. · **Status of this document:** code-grounded readiness audit +
runbook. **The live run has NOT been executed** (see "Why no live run yet").

---

## TL;DR — go / no-go

**NO-GO for an *agent-autonomous* chain as it stands.** The underlying plumbing (VercelClient
error handling, idempotent get-or-create, the gated approval→execute path) is solid, but the
**agent tool surface has two hard gaps** that stop the prompt's chain before "capture the live URL":

1. **No deployment discovery.** `vercel_create_project` returns a *project* (id/name/framework/
   linkedRepo) — **never a deployment id or URL** — and there is **no `vercel_list_deployments`
   tool**. `vercel_deploy_status` *requires* a deployment id/hostname you have no tool to obtain.
   → Step 4 ("poll `vercel_deploy_status` until READY → capture the live URL") **cannot be
   completed from the tools**; the URL must be read from the Vercel dashboard.
2. **No repo creation.** There is **no `github_create_repo` tool** and no create method on
   `GitHubClient` — the GitHub *App* model is structurally confined to repos it's already
   installed on + allowlisted. → Step 2 ("create a new GitHub repo … existing GitHub integration")
   is **not supported**; the repo must be created + App-installed + allowlisted manually.

Plus one **behavioral risk** to confirm in the live run (production-vs-preview + deploy sequencing,
see Step 3/4 below).

**The operator-assisted chain can almost certainly produce a live URL** (Henry creates+seeds the
repo, connects Vercel↔GitHub, the agent links the project, URL read from the dashboard). But that's
not "boring," and it's not agent-autonomous. **Recommendation: close Gap #1 (a small fix PR) and
decide the repo-creation + production-branch story before Phase 2.** Then a single live run to
confirm Vercel's create-time auto-deploy behavior flips this to GO.

---

## Why no live run yet

The live run requires operator credentials that are **not reachable from the dev session**, and
the prerequisites are Henry's dashboard actions:

- No running paw instance locally (`:3000` down); no local DB/vault.
- Local `~/.paw/config.json`: `vercel.enabled` unset + no token; `github.enabled` unset + no App
  creds + empty allowlist; `posthog` disabled. `credentials.json` has only ollama/provider/slack.
- A Vercel API token, the one-time **Vercel↔GitHub app connection**, and the paw GitHub App are
  all operator-owned and live on the Railway production instance, which this session can't drive.

Fabricating a "live URL came back" result would violate the success criteria, so the run is
deferred to the runbook below. Everything in the failure-mode map marked **[code]** is confirmed
from the implementation and needs no live run; items marked **[confirm live]** need the run.

---

## Per-step failure-mode map

Endpoints (verified in `src/integrations/vercel/client.ts`): create `POST /v11/projects` · get
`GET /v9/projects/{idOrName}` · list `GET /v9/projects` · deploy status `GET /v13/deployments/
{idOrUrl}` · add domain `POST /v10/projects/{idOrName}/domains`. Auth: server-side
`Authorization: Bearer <token>` only — **the token never appears in any tool output**
(`tests/integrations/vercel/tools.test.ts` asserts this). **[code]**

### Step 1 — generate the static page
No integration surface. The only published-page concern is PostHog injection (see Bonus).

### Step 2 — create repo + commit the page
- **GAP [code]:** no repo-creation tool/method (see TL;DR #2). Repo must be created manually, the
  paw GitHub App installed on it, and `owner/repo` added to `github.repoAllowlist`.
- **commit lands on a feature branch, never the default branch [code]:** `GitHubClient.commitFiles`
  **refuses the default/any protected branch** and never force-pushes (`client.ts:261-281`). So the
  agent commits to a feature branch + opens a PR. This is the GitHub integration working *as
  designed* — but it interacts badly with Vercel production deploys (Step 3/4).
- **Failure surfacing [code]:** allowlist miss → the client refuses with a clear "not allowlisted"
  error; default-branch write → explicit "Create a feature branch and open a PR" error; 403 from a
  missing App permission → self-explanatory ("contents: write") error (tested).

### Step 3 — `vercel_create_project` (linked) + approve
- **Gated by design [code]:** the tool does NOT create — it `enqueue`s a `vercel_create_project`
  approval and returns `{ queued:true, id }`. A human approves at the surface; the kernel-registered
  executor then runs `client.getOrCreateProject(...)` (`kernel.ts` vercel block;
  `approvals.ts:368-371`). On executor throw, the row flips to **`failed`** with the error captured
  in `result_json` and an audit entry — no half-approved state. **[code]**
- **Vercel↔GitHub not connected [confirm live]:** if the one-time dashboard connection is missing,
  `POST /v11/projects` with `gitRepository` is expected to fail (or create an *unlinked* project).
  `getOrCreateProject` surfaces it as a `VercelError(status)` → the approval row flips to `failed`
  with the Vercel message. **Confirm the exact status/text in the live run.**
- **Idempotency [code]:** `getOrCreateProject` first GETs the project by slugified name and returns
  it unchanged if present (`createdNew:false`); on a create **409 race** it re-fetches and returns
  the existing one. So re-running the approved action does **not** duplicate. (Step 6 ✓ at the
  client layer; the *tool* re-queues a new approval each call — that's expected, the executor is
  idempotent.) **[code]**
- **401 revoked/expired token [code]:** `request()` throws `VercelError("… 401 …")` → row `failed`.
- **429 rate limit [code]:** surfaces as `VercelError("… 429 …")` → row `failed`. **Note:** the
  Vercel client has **no retry/backoff** (unlike the AI providers' `withRetry`). A transient 429
  fails the action; the human must re-approve/re-run. Low risk at single-page cadence; flag for
  Phase 2 if batch provisioning is planned.
- **Timeout [code]:** `AbortController` at `timeout` (default 15s) → `VercelError("… timed out …")`
  (no `status`) → row `failed`. Re-runnable (idempotent).

### Step 4 — poll `vercel_deploy_status` until READY → capture the live URL
- **GAP [code]:** **no way to obtain the deployment id/URL via tools** (see TL;DR #1).
  `getOrCreateProject`→`ProjectResult` has no URL; there is no `vercel_list_deployments`; the
  console page (`vercel-page.tsx`) shows only a project *count*. `vercel_deploy_status` needs an
  id/hostname you can only get from the Vercel dashboard. **This is the chain's broken link.**
- **No deploy trigger + sequencing risk [confirm live]:** `VercelClient` has **no deploy endpoint**
  — deployment is entirely Vercel **auto-on-push**. Linking a repo at create time does not reliably
  deploy the *existing* HEAD; the deploy is the *next push after the link exists*. The prompt's
  order (commit in Step 2, link in Step 3) means the push precedes the link → **a deployment may
  not be triggered at all** until a subsequent push. Confirm whether Vercel auto-deploys the
  default branch on project-create-with-linked-repo (it often does) — this is the single most
  important live-run question.
- **Production vs preview [confirm live]:** the page was committed to a *feature branch* (Step 2),
  but Vercel serves **production** from the repo's **default branch** and **preview** for other
  branches/PRs. So even with a successful deploy, the feature-branch page lands at a *preview* URL,
  not the production `<project>.vercel.app`. Production requires the content on the default branch —
  i.e. **merge the PR** (a gated `merge_pr` action) or seed `main` directly.
- **Build failure [confirm live]:** `getDeploymentStatus` maps `readyState` to
  `QUEUED/BUILDING/READY/ERROR/CANCELED`; `ERROR` means the build failed → inspect on Vercel. For a
  plain static one-file page a build failure is unlikely, but a wrong framework preset could cause
  one — pass no `framework` for a static site.

### Step 5 — open the URL, confirm it renders
Manual. Blocked by Step 4's URL-capture gap unless the URL is taken from the dashboard.

### Step 6 — idempotency re-run
Covered at the client layer (Step 3, idempotency). **[code]** ✓

### Bonus — PostHog snippet on the published HTML
If `posthog.enabled` + `projectApiKey`, the kernel wires `htmlPublishTransform` so
`github_commit_files` injects the snippet into committed `*.html` (PR #148). The published page's
`<head>` should carry `posthog.init('<projectApiKey>', …)`. Verifiable by viewing source on the
live page. **[code path present; confirm on the live page]**

### Domain attach (`vercel_add_domain`)
Gated like create; on approve the executor runs `client.addDomain` → returns `{ name, verified,
verification[] }`. If unverified, the result carries the **TXT challenge** to add to DNS. Failure
modes mirror Step 3 (401/429/timeout → row `failed`). Not on the critical path for the first run.

---

## Failure-mode summary table

| Mode | Where it surfaces | Handled? |
|---|---|---|
| Allowlist miss / default-branch write | GitHubClient explicit error | ✅ clear message |
| Vercel↔GitHub not connected | `getOrCreateProject` → VercelError → row `failed` | ⚠️ confirm status/text live |
| 401 revoked/expired token | `VercelError(401)` → row `failed` | ✅ surfaced (no auto-recover) |
| 429 rate limit | `VercelError(429)` → row `failed` | ⚠️ **no retry/backoff** in client |
| Timeout | `AbortController` → `VercelError` (no status) | ✅ surfaced, re-runnable |
| Partial / half-created | approve() wraps execute in try/catch → `failed` + audit | ✅ no half state |
| Build failure | `readyState: ERROR` from deploy status | ✅ *if* you can poll it |
| Re-run / idempotency | get-or-create + 409 re-fetch | ✅ no duplicate |
| **Capture live URL** | — | ❌ **no tool returns a deployment id/URL** |
| **Repo creation** | — | ❌ **no tool; App-model manual setup** |
| Production vs preview | feature-branch deploy ⇒ preview only | ⚠️ needs default-branch / PR merge |
| Domain attach | `addDomain` → TXT challenge | ✅ |

---

## Candidate fix PRs (flagged, not patched here)

1. **`feat/vercel-deployment-discovery` (highest priority).** Add `vercel_list_deployments(project)`
   (or `vercel_latest_deployment`) over `GET /v6/deployments?projectId=…`, and/or have
   `getOrCreateProject` return the latest production deployment URL. Without this the agent chain
   cannot capture or open the live URL. **This is the gate-blocker.**
2. **Vercel client retry/backoff** for 429/5xx, mirroring `src/ai/retry.ts`'s `withRetry`. Low
   urgency for single-page cadence; needed if Phase 2 provisions in batches.
3. **Repo-creation story (design decision, not necessarily code).** Either accept the App-model
   constraint and document "operator creates + installs + allowlists the repo," or add a
   create-repo path. Recommend documenting the constraint; auto-create fights the App security model.
4. **Production-branch guidance / helper.** Document that the page must reach the default branch
   (merge the PR) for a production deploy, or add a thin "publish to production" flow.

---

## Runbook — Henry executes the live run (operator-assisted)

**Prereqs (once):** Vercel token → `/vault` slot `vercel.token`; `vercel.enabled` (+ `teamId` if a
team); **connect Vercel↔GitHub in the Vercel dashboard**; create a throwaway GitHub repo with a
simple `index.html` on its **default branch** (this sidesteps Gap #2 and the feature-branch/preview
issue); ensure the paw GitHub App is installed on it; add `owner/repo` to `github.repoAllowlist`;
restart paw.

**In a paw chat:**
1. "Create a Vercel project named `<name>` linked to `owner/repo`." → **approve** the queued
   `vercel_create_project` at the approval surface.
2. In the **Vercel dashboard**, open the project → Deployments → copy the latest deployment's
   hostname/id and confirm it reaches **READY** (or ask the agent: "Check `vercel_deploy_status`
   for `<hostname>`").
3. **Open the production URL** (`https://<project>.vercel.app`) in a browser → confirm the page
   renders.
4. **Idempotency:** ask the agent to create the same-named project again → confirm it reports the
   existing project (no duplicate).
5. **(If posthog.enabled)** View source on the live page → confirm `posthog.init(...)` is present.

**Capture per step:** exact tool output, any `VercelError`/approval `failed` rows (with the error
text), the deployment `readyState` progression, and whether create-with-link auto-deployed the
default branch (the key sequencing question). Paste back; I'll fold the live results into this map
and finalize the go/no-go.

**What the live run must answer to flip to GO:** (a) does project-create-with-linked-repo
auto-deploy the default branch without a separate push? (b) what is the exact
Vercel↔GitHub-not-connected error? (c) does the page actually render at the production URL? With
Gap #1 closed and (a)/(c) confirmed, the chain is "boring" enough for Phase 2.
