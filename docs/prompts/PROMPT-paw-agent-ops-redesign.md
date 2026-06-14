# Prompt: Paw master — redesign the Agent Operations dashboard + clean up

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**.

**Goal:** replace the current Dashboard (the Agent Ops console at `/`) — which is not pulling its
weight — with the new **Agent Operations** design, wired to the **real** ops data, then **delete the
dead code** the redesign leaves behind.

## Prerequisite — read the design from the repo
The design is dropped at **`Skill Layout Design/Agent Operations.html`** (+ any assets/screenshots in
that folder). **Read it from there** — the Anthropic share link is not fetchable. Study its layout,
panels, hierarchy, and interactions.

**Ignore the logo in the design — it is a placeholder.** Use paw's real brand mark / the active
brand (`/api/brand/ui`, `compileBrandBrief`), never the design's logo.

## What exists today (replace the presentation, KEEP the real data)
- Page view: `src/web/views/ops-page.tsx` (mounts the console inside the paw `Layout` at `/`).
- Presentation: vanilla JS modules under `src/web/public/ops/` — `shell.js` (grid: top bar / mode
  rail / stage / scrub / inspector), `engine.js`, `ui.js`, `viz-stream.js` + `viz-swarm.js` (the two
  canvas lenses), `styles.css`. ~1,800 lines total.
- **Data (real — reuse, don't mock):** `GET /api/ops/feed` → `src/web/routes/ops-feed.ts` (pure,
  unit-tested): completed ops from `tool_log` (real durations), in-flight ops, the skill/MCP topology
  node set, the active sub-agent swarm, and hook-sourced per-tool metrics (`toolMetrics`). The new
  dashboard must render from **this real feed**, not invented data.

## Build
- Port the new Agent Operations design to the dashboard as **real `.js`/`.css` files** under
  `src/web/public/ops/` (never template-literal strings — inline-script-template-trap, see
  `_CONVENTIONS.md`). Mount it through `ops-page.tsx` at the same `/` route.
- **Map every widget to a real field** from `/api/ops/feed`. If the design shows a metric the feed
  doesn't expose, either **derive** it from existing data or **add a small, pure, unit-tested field
  to `ops-feed.ts`** — do NOT fabricate or hardcode sample numbers. If the design implies data paw
  genuinely doesn't have, call it out in the PR rather than faking it.
- Light/dark correct (reuse the `.dark` token pattern), brand `--accent`-driven, responsive,
  reduced-motion respected. Keep the existing `~2s` poll of `/api/ops/feed`.

## Clean up (explicit — this is half the task)
After the new dashboard works, **remove the dead code the redesign orphans:**
- Delete unused old modules (e.g. `viz-swarm.js` / `viz-stream.js` / `engine.js` / `ui.js` /
  old `styles.css` — whichever the new design no longer uses) and their references in `ops-page.tsx`.
- Delete or update the corresponding **tests** (e.g. lens/shell tests that no longer apply); add tests
  for the new rendering.
- Remove any now-unused fields/branches in `ops-feed.ts` that only the old lenses consumed.
- No orphaned imports, dead CSS, or `window.*` globals left dangling. `bun run lint` clean; `tsc`
  baseline; confirm nothing else imports the deleted modules (grep before deleting).

## Tests
- The dashboard renders from `/api/ops/feed` with **real** data (no mock/sample numbers); empty-feed
  state renders cleanly.
- Any new `ops-feed.ts` field is pure + unit-tested.
- Deleted modules/tests are fully removed with **no remaining references** (build + grep clean).
- Light/dark both pass; the design's placeholder logo is NOT used (brand mark is).

## Out of scope
Changes to what the agent/kernel *does*; the ConstructAI fork's separate Dashboard module; new data
sources beyond what a widget genuinely needs.

> One PR off `main`: `feat/agent-ops-redesign` (or split build vs cleanup into two sequential PRs if
> the diff is large — your call, but the cleanup must land, not linger).
