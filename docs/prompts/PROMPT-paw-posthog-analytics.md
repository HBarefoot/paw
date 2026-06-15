# Prompt: Paw master — PostHog analytics integration (instrument pages + agent-readable metrics)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`.**
This replaces the Vercel-Analytics approach (Vercel has no read API; PostHog does — that's the point).

**Why PostHog:** it does BOTH halves of the improvement loop with one provider — (1) instrument the
published pages so traffic is tracked, and (2) expose a **read API the agent can query**, which is the
"eyes" the loop needs. Free cloud tier (1M events/mo, API included).

Two sequential PRs.

## Config (shared)
Add a `posthog` block: `{ enabled, projectApiKey, personalApiKey, host }`.
- `projectApiKey` — the **public** project key embedded in the page snippet (safe to expose).
- `personalApiKey` — **private**, used by the read integration → **VAULT slot, resolved server-side
  only, never reaches the model** (mirror the GitHub/Vercel secret pattern).
- `host` — `https://us.i.posthog.com` (or `eu`, or a self-hosted URL).
Update **both** the Zod schema (`src/config/schema.ts`) and the `PawConfig` interface
(`src/types/config.ts`) — `_CONVENTIONS.md` seam #3. Disabled by default.

## PR 1 — Instrument published pages  ·  `feat/posthog-instrument`
At **publish time** (the Vercel/canvas publish path that emits page HTML), inject the standard PostHog
web snippet into `<head>` when `posthog.enabled`: it loads `posthog-js` from the PostHog CDN and calls
`posthog.init('<projectApiKey>', { api_host: '<host>' })`. Verify the current snippet against
`posthog.com/docs` before coding (don't hardcode a stale version).
- **Privacy-friendly defaults:** configure for low-friction tracking (consider `person_profiles:
  'identified_only'` / disabling autocapture if you only want pageviews) so client pages stay clean and
  ideally cookieless. Document the choice; no PII, no consent-banner dependency by default.
- Gated by `posthog.enabled`; inject once (dedup if already present).
- **Tests:** published HTML contains the PostHog init with the project key + host when enabled; absent
  when disabled; deduped; valid HTML; no private key ever in page output (only the public project key).

## PR 2 — Agent-readable metrics (the eyes)  ·  `feat/posthog-read`
A `src/integrations/posthog/` integration (`client.ts`, `tools.ts`, `types.ts`) mirroring
`src/integrations/github/` — NOT a plugin/MCP. The `personalApiKey` is resolved from the **vault**
server-side; the model never sees it. **Read-only** — no writes, so **no approval gating needed**.
- Tools (curated, enough for a sense pass — keep the surface small): e.g. `posthog_top_pages`,
  `posthog_pageviews(dateRange, path?)`, `posthog_top_referrers`, `posthog_event_counts(name?)`, and a
  basic `posthog_funnel(steps)`. Optionally one constrained **HogQL** query tool
  (`posthog_query(sql)`) for flexibility — if included, scope it read-only and cap result size.
- API shape (VERIFY against current PostHog docs before coding): auth `Authorization: Bearer
  <personalApiKey>`; the Query API is roughly `POST /api/projects/{project_id}/query/` with a HogQL
  payload; there are also `/insights`, `/events` endpoints. Resolve `project_id` from config or a
  lookup. Don't hardcode a guessed path — confirm endpoints + the current Query API contract.
- Kernel wiring: init the PostHog client only when `enabled && personalApiKey`; register the tools +
  sandbox manifest (read perms) + a `kernel.posthog` accessor; graceful degradation when unconfigured.
- **Tests:** `client.ts` unit tests against a **mocked** PostHog API (top-pages, pageviews, funnel,
  error/rate-limit handling); the `personalApiKey` never appears in model-visible output; tools return
  structured metrics; queries are read-only.

## Out of scope (flag, don't build)
- The scheduled **sense → decide → act loop** orchestration (a cron pass that reads metrics → forms
  recommendations → proposes gated edits via the Vercel edit→redeploy pipeline). That's the NEXT piece;
  this PR only provides the instrument + read primitives it will use. Note it.
- PostHog session replay / feature flags / experiments — analytics read only.
- Per-asset goal definition (leads/sales/signups) — needed by the loop, not by this integration.
- ConstructAI fork UI.

> Disabled by default; goes live when the operator sets `posthog.projectApiKey` + `posthog.host` and
> stores `posthog.personalApiKey` in `/vault`, then enables it. The improvement loop only produces value
> once a published asset is actually taking traffic.
