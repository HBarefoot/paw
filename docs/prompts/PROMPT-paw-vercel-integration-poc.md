# Prompt: Paw master — Vercel integration, Phase 1 PoC (Git → live URL)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**.

**This is a de-risking proof-of-concept, not a product.** Goal: prove the chain *the agent takes a
static page → a GitHub repo → a live Vercel URL* works **reliably**, single-operator, static-first.
If this is flaky, we stop and rethink; if it's solid, it's the foundation for public-web provisioning.
**Narrow on purpose** — resist building more than the one flow below.

## Architecture (why this exists)
Paw should NOT serve public pages from the kernel. Public assets live on the user's own Vercel +
repo (edge, certs, infinite scale, zero kernel load). Phase 1 wires the missing piece: a **Vercel
deploy-target integration**. GitHub is already built (`src/integrations/github/`); Vercel is the gap
(current integrations: `github, hubspot, strapi, supabase, wordpress` — no host).

## Build — mirror the GitHub integration
Create `src/integrations/vercel/` (`client.ts`, `tools.ts`, `types.ts`) modeled on
`src/integrations/github/` (NOT a plugin/MCP). Specifics:
- **Auth/secrets:** config block `vercel { enabled, token, teamId? }`; the **token is a VAULT slot**
  resolved server-side only — the model/canvas never see it (mirror the GitHub `appPrivateKey`
  pattern). Update **both** the Zod schema (`src/config/schema.ts`) and the `PawConfig` interface
  (`src/types/config.ts`) — `_CONVENTIONS.md` seam #3.
- **Sandbox perms** inferred by tool-name prefix like the other integrations.
- **Irreversible actions** (create project, add domain, trigger deploy) **enqueue for approval +
  audit**, reusing the existing approval queue + `audit_logs` pattern the GitHub integration uses.

## The one flow (end to end)
Given a static page (HTML/CSS/JS the agent already produces), one path:
1. Create a GitHub repo + commit the page — **reuse the existing GitHub integration**.
2. Create a **Vercel project linked to that repo** (`gitRepository`) so pushes auto-deploy.
3. Push → Vercel builds/deploys (for pure static, no build config needed).
4. Return the **live URL**; optionally attach a domain.

## Vercel REST API — shape (VERIFY exact versions against live docs before coding)
Stable facts: auth is `Authorization: Bearer <token>` (+ optional `?teamId=`/`?slug=` for team
scope). Create project ≈ `POST /v#/projects` with `{ name, framework: null, gitRepository: { type:
"github", repo: "owner/name" } }` (linking the repo is what makes pushes auto-deploy). Direct
deploy fallback ≈ `POST /v#/deployments`. Domains ≈ `POST /v#/projects/{id}/domains`. Status ≈
`GET /v#/deployments/{id}`. **The version numbers drift — the agent MUST confirm current endpoint
versions + required params against `vercel.com/docs/rest-api` (browse it) before implementing; do not
hardcode a guessed version.**

## Tools (minimal set)
`vercel_create_project` (with repo link), `vercel_deploy_status`, `vercel_add_domain`,
`vercel_list_projects`. Keep the surface small.

## Reliability — the actual deliverable
- **Idempotent:** re-running create-project for an existing name returns/updates rather than
  duplicating; track the repo→project mapping.
- **Map the failure modes** in the PR body: build failure, rate limit, partial/half-created state,
  re-run behavior, revoked/expired token. This map is the point of the PoC.
- **Success criterion:** with the operator's connected GitHub + Vercel token, the agent publishes
  **one real static page to a live Vercel URL, reproducibly.**

## Tests
- `client.ts` unit tests against a **mocked** Vercel API: create-project (with `gitRepository`),
  deploy-status, add-domain, list; idempotent re-run; error surfacing (rate limit/4xx/5xx).
- Irreversible actions require an approval row and are blocked without it.
- The Vercel token is resolved server-side and **never** appears in model-visible context.
- Clean-checkout hygiene (scrub `PAW_*`, temp `PAW_CONFIG_DIR`) per `_CONVENTIONS.md`.

## Out of scope (do NOT build — this is the discipline)
Multi-user OAuth / per-user tokens (single-operator, token in the vault); framework/buildable-project
scaffolding (static-first only); the public-site↔Supabase data wiring; the metrics→decision loop;
any deploy target other than Vercel (but keep `client.ts` behind a thin interface so a second target
is possible later — don't hard-couple the kernel to Vercel).

> One PR off `main`: `feat/vercel-integration` (split scaffolding vs the end-to-end flow into two
> sequential PRs if the diff is large). Disabled by default; goes live when the operator sets
> `vercel.token` in the vault + `vercel.enabled`.
