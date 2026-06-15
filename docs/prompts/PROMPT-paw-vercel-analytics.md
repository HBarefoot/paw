# Prompt: Paw master — instrument deployed pages with Vercel Web Analytics

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`.**
One PR: `feat/vercel-analytics`. Builds on the Vercel integration (#141/#142/#143).

## Scope & honest boundary (read first)
**Goal: every page Paw publishes to Vercel is auto-instrumented with Vercel Web Analytics**, so traffic
is tracked and visible in the Vercel dashboard.

**This is instrumentation + dashboard visibility ONLY.** Vercel Web Analytics has **no public REST API
to read the metrics back** (open feature request since Nov 2025). So this does **not** feed an
agent-readable improvement loop — the agent can't query this data. The "agent senses metrics →
recommends edits" loop needs a source *with* a query API (GA4 / PostHog / Plausible) and is a
**separate** piece — do NOT build any read-back / loop logic here, and don't imply Vercel feeds it.

## Build
- At **publish time** (the Vercel/canvas publish path that emits the page HTML before deploy), inject
  the Vercel Web Analytics snippet into the page `<head>`/before `</body>`:
  ```html
  <script defer src="/_vercel/insights/script.js"></script>
  ```
  (the CDN/static path — correct for the static-first pages we ship; no npm/build needed). For
  framework builds later, the `@vercel/analytics` package `inject()` is the equivalent — note it as a
  follow-up, don't build it now.
- **Gate behind a config flag** (e.g. `vercel.analytics` default off, or per-publish opt-in) so it's
  explicit. Inject only when enabled.
- It's **privacy-friendly / cookieless by default** (Vercel Web Analytics) — keep it that way; don't
  add anything that collects PII or needs a consent banner. Note this in the PR.
- **Operator step (document, don't automate):** Web Analytics must be **enabled per project in the
  Vercel dashboard** (Analytics tab) — there's no reliable API toggle. So the flow is: agent injects
  the script → operator flips Web Analytics on for the project once (like the one-time Vercel↔GitHub
  link). Capture this in the operator setup notes.

## Tests
- With the flag enabled, the published page HTML contains the `/_vercel/insights/script.js` script
  exactly once; with it disabled, the script is absent.
- Injection doesn't break the page (valid HTML, script in the right place, deduped if the page already
  has it).
- No PII/consent dependency introduced.

## Out of scope (flag, don't build)
- **Reading analytics data back / the improvement loop** — Vercel has no read API; that's a separate
  provider (GA4 MCP / PostHog / Plausible) + a scheduled sense→decide pass. Note it as the next piece.
- `@vercel/analytics` framework package wiring (static script is enough for now).
- Speed Insights (separate product).
- ConstructAI fork UI.
