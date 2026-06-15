# Vercel integration

Deploy-target integration: the agent provisions public static assets onto the operator's own
Vercel + GitHub repo (Vercel auto-deploys on push). The API token is vault-resolved
(`vercel.token`), server-side only — it never reaches the model.

## Tools

- **Reads** (immediate): `vercel_list_projects`, `vercel_deploy_status`,
  `vercel_latest_deployment`, `vercel_list_deployments`.
- **Gated** (queued for one-click human approval, executed on approve): `vercel_create_project`,
  `vercel_add_domain`.

## Capturing the live URL (the publish chain)

After creating/linking a project, the chain is tool-complete:

1. `vercel_create_project` (gated) → approve → project linked to the repo.
2. `vercel_latest_deployment(project)` → the latest **production** deployment `{ id, url, state, target }`.
3. `vercel_deploy_status(id)` → poll until `state`/`readyState` is `READY`.
4. Live URL = `https://<url>`.

## Production vs preview — IMPORTANT

A published page only reaches the **production** URL when its content is on the repo's **default
branch**. By design, `GitHubClient.commitFiles` **refuses to commit to the default/protected
branch** and never force-pushes — so an agent commit lands on a *feature branch*, and Vercel
serves that as a **preview** deployment (preview deploys have `target: null`).

To get the page live in **production**, the content must reach the default branch:

- the **operator seeds `main`** with the initial page, or
- a later **gated `merge_pr`** flow promotes a reviewed feature branch.

`vercel_latest_deployment` defaults to `target=production` and echoes `target` in its output so the
agent never hands back a preview URL thinking it's live; when there's no production deployment yet it
returns `found: false` with this explanation. **Do not weaken `commitFiles`' default-branch refusal,
and do not auto-merge** — promotion to production is a deliberate, human-gated step.

## Not built (deliberate)

- **Auto repo-creation** — the GitHub App model is intentional: the operator creates the repo,
  installs the App on it, and adds `owner/repo` to the GitHub allowlist. (Revisit, gated, only for
  the multi-user vision.)
- **Client retry/backoff** for 429/5xx — deferred to Phase 2 (batch provisioning); single-page
  cadence doesn't need it.
