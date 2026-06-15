# Prompt: Paw master — Vercel deployment discovery (close the publish-chain gate)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`.**
One PR: `feat/vercel-deployment-discovery`. Context: the publish-chain validation
(`docs/VERCEL-PUBLISH-CHAIN-VALIDATION-2026-06-15.md`) found the chain **can't capture the live URL** —
`vercel_create_project` returns a project but no deployment, and there's no tool to find the
deployment. This closes that gate-blocker.

## Build — deployment discovery (the gate-blocker)
Add to `src/integrations/vercel/` (client + a tool):
- **`client.listDeployments({ projectId, target?, limit? })`** over `GET /v6/deployments?projectId=…`
  (filter `target=production` for the prod deploy; `limit=1` for "latest"). Returns each deployment's
  **id, url, readyState, target, createdAt**. **Verify the current endpoint version + query params
  against the live Vercel docs before coding** (versions drift — don't hardcode v6 if it's moved).
- A tool **`vercel_latest_deployment(project, target?)`** returning the latest deployment's
  `{ id, url, state, target }` — so the agent can, after creating/linking a project: get the latest
  **production** deployment → poll `vercel_deploy_status` (which already takes an id/url) until `READY`
  → return the live URL. Optionally also expose `vercel_list_deployments`.
- Read-only → no approval gating (mirror the existing read tools). Token stays vault-resolved,
  server-side, never in tool output (assert in tests).

With this, the chain is completable from tools: create project → `vercel_latest_deployment` →
`vercel_deploy_status` until READY → live URL.

## Production-vs-preview — guidance + a guard (not a rewrite)
The published page only reaches the **production** URL when its content is on the repo's **default
branch**. paw's `GitHubClient.commitFiles` refuses the default branch by design (commits land on a
feature branch → Vercel serves *preview*). Do NOT weaken that safety. Instead:
- Have `vercel_latest_deployment` default to **`target=production`** and clearly label preview vs
  production in the output, so the agent doesn't hand back a preview URL thinking it's live.
- Add a short **operator note** (in `docs/` or the integration README) stating the production
  requirement: the page must reach the **default branch** — operator seeds `main`, or a later
  **gated `merge_pr`** flow promotes it. Don't auto-merge here.

## Explicitly NOT in this PR (decisions made — flag, don't build)
- **Auto repo-creation** — keep the App-model constraint (operator creates + installs + allowlists the
  repo). Document it; do not add a create-repo path. (Revisit, gated, only for the multi-user vision.)
- **Vercel client retry/backoff** for 429/5xx — defer to Phase 2 (batch provisioning); single-page
  cadence doesn't need it.

## Tests
- `listDeployments` / `vercel_latest_deployment` return id/url/state/target from a **mocked** Vercel
  API; `target=production` filter applied; empty result handled (no deployment yet).
- Integrates with `vercel_deploy_status` (the returned id is accepted).
- Token never appears in tool output.
- Clean-checkout hygiene per `_CONVENTIONS.md`.

> After this merges, the chain is tool-complete. Then the **operator-assisted live run** (runbook in
> `docs/VERCEL-PUBLISH-CHAIN-VALIDATION-2026-06-15.md`) confirms the three open live questions —
> (a) does create-with-linked-repo auto-deploy the default branch, (b) the exact
> Vercel↔GitHub-not-connected error, (c) does the page render at the production URL — to flip the
> verdict to GO.
