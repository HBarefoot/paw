# Prompt: Paw master — companion light-theme fix, config-removal cleanup, llms.txt, agent-work kanban

You're in the **paw** repo (`~/repos-and-projects/paw`). Read `CLAUDE.md` first, plus
`docs/strategy/PAW-vs-HERMES-strategy.md` and `docs/strategy/PAW-HERMES-BORROW-PLAN.md` for context.

This is **paw kernel/console work** — it lands upstream and merges down to the `construction-agent`
(ConstructAI) fork so every brand inherits it. Fork-only UI (table pagination, ConstructAI Settings
drawers, the domain Jobs/Tasks boards) is **out of scope here** — that's a separate fork session.

Four PRs, **in order**, each a **single unstacked PR off `main`**. After each: stop, report, wait
for review before the next. Do **not** stack.

## Ground rules

**Follow `docs/prompts/_CONVENTIONS.md`** (standing rules + known integration seams) for every PR —
branch+PR discipline, no `Co-Authored-By`, regression-test-fails-first, clean-checkout test hygiene,
gates, the surface-budget rule, and the real-`.js`-files / inline-script-template-trap seam all live
there. This prompt only adds task-specific detail below.

---

## PR 1 — Companion light-theme contrast fix  ·  `fix/companion-light-theme`

### The bug (root-caused — verify, then fix)

The console light/dark switch is a **`.dark` class on `<html>`**, set by `window.__pawSetTheme` in
`src/web/views/layout.tsx` (persisted as `localStorage["paw-theme"]` = `light|system|dark`; **light
= no `.dark` class**). But the companion stylesheet `src/web/public/companion/styles.css` hardcodes
a **dark-only palette** in `:root`:

- `--bg:#050807`, `--text:#f2f7f4`, `--muted:#87a496`, `--faint:#5e8f7c`
- pill tokens `--pill-bg`/`--pill-border` derived from low-alpha `--accent` `color-mix` tints

There is **no light variant, no `.dark` scoping, no `prefers-color-scheme`** — only `--accent` is
brand-driven. So when the companion renders in light mode (e.g. ConstructAI's white right-panel),
the skill pills ("Construction / Skill Creator / Web Pilot / Slack") and the "Hi — I'm …" greeting
are colored for a near-black background and wash out. That is the reported contrast issue.

### What to build

1. Make the companion's **surface tokens** theme-aware: `--bg`, `--text`, `--muted`, `--faint`,
   `--pill-bg`, `--pill-border` (and any other surface/stroke tokens that assume a dark ground).
   Provide **light-appropriate defaults** in `:root`, and override the dark values under
   `html.dark` (reuse the existing class — do NOT invent a new toggle). Keep `--accent` as the
   single brand-driven hue; **derive** the per-mode pill/stroke tints from it with `color-mix`
   rather than hardcoding.
2. Verify the avatar/gel-sphere art (the `:root` gradient/lighting blocks around lines 268–376)
   still reads on a light ground; adjust glow/shadow alphas per mode if needed.
3. Ensure the `ONLINE · N SKILLS` chip, sub-agent nodes, and wire strokes meet contrast in both
   modes.

**Do NOT** add new raw color slots to the Branding tab. The brand supplies the hue; the system
derives accessible fg/bg pairs per mode.

### Tests / verification

- Computed-style assertions (jsdom or a token-level unit test): in light mode (`<html>` without
  `.dark`) the pill text/border and `--text` resolve to light-appropriate values distinct from the
  dark-mode values; under `html.dark` they match today's dark palette (no regression).
- A contrast check on the pill text vs. its background and on `--text` vs `--bg` in **both** modes
  (assert a minimum ratio, e.g. WCAG AA 4.5:1 for text).
- Snapshot/visual note in the PR: companion in light and dark, against a white panel.

### Optional follow-on (own PR if you do it) — `feat/brand-mode-preview`

Add a **light + dark live preview** to the Branding tab so an operator can see the companion +
pills + chrome in both modes before activating a brand. Read-only preview over the existing
`/api/brand/theme.css` + `/api/brand/tokens.css` outputs (`src/web/app.ts` ~4231–4247,
`renderBrandTokensCss` / `renderBrandAppThemeCss`). No new color inputs.

---

## PR 2 — Finish the config-removal fix  ·  `fix/config-removal-callers`

PR #114 fixed MCP removal by adding `replaceConfigOverride`/`deleteConfigOverride` to
`src/config/writer.ts` (wholesale subtree write, no re-merge). The **same delete-by-merge trap**
still exists in two other callers that try to *remove* keys via `saveConfigOverrides` (which deep-
merges and so can't delete):

- the **agents-clear** path (`src/web/app.ts` ~1706)
- the **config-form** save path (`src/web/app.ts` ~1756)

Convert both to use the removal-honoring writer API from #114. Audit the remaining
`saveConfigOverrides` callers (`~1179`, `~3172`, the skills writers `~3493/3504/3514`) and confirm
they are **additive-only** (merge is correct for them) — note the audit result in the PR body.

**Tests (fail on pre-fix):** clearing the relevant key via each path persists the removal (absent
from `config.json` after write and after a re-read), while unrelated keys and the `store.dbPath`
strip guard are preserved.

---

## PR 3 — `llms.txt` / `llms-full.txt` docs  ·  `feat/llms-txt-docs`

Cheapest high-leverage borrow (Hermes QW2) — speeds the coding sessions that build paw + ConstructAI.

Generate, via a script run on build/deploy so they never drift:
- `llms.txt` — a small **curated index**: every meaningful doc/README + a one-line description.
- `llms-full.txt` — the docs **concatenated** for one-shot ingestion.

Source from `README.md`, `CLAUDE.md`, `CONSTRUCT.md` (note it's the fork's), `CHANGELOG.md`,
`REVIEW-2026-06-09.md`, and `docs/`. Serve both at the web root and `/docs/` paths. **Tests:** the
generator produces both files, the curated index lists known docs, output regenerates
deterministically. Effort: trivial.

---

## PR 4 — Agent-work kanban  ·  `feat/agent-work-kanban`  ·  DESIGN-FIRST, pause for sign-off

The real feature, and on-moat: it turns the "autonomous agent workspace" into something a
non-developer can **see and drive** — the consumer-grade UX the strategy doc says to deepen
(Hermes is CLI/chat-only here). A board where each card is a unit of work the user creates, hands to
the agent, and watches move across columns:

```
Backlog → Queued → Agent working → Needs approval → Done   (+ Blocked/Failed)
```

### Reuse what already exists (do not rebuild)

- Agent lifecycle: `kernel.activeAgents` (fed by the `agent:delegated` / `agent:completed` bus
  events; lingers ~5s) — the same source the Agent Ops constellation uses.
- Approval surfaces: the per-channel approvals from #110/#112 (`/api/approvals/*`,
  `plugins/slack/approvals.ts`, approvals DB columns) drive the **"Needs approval"** column —
  a card sitting there resolves from Slack Block Kit or the web modal, same row everywhere.
- Console page pattern: mirror `/ops` and `/github` — vanilla-JS modules served as **real `.js`
  files** from `src/web/public/…` (NOT template strings), a page view under `src/web/views/`
  inside the paw `Layout`, polled via a `GET /api/…/feed` route backed by a pure builder
  (`src/web/routes/…`), like `ops-feed.ts`.
- B4 checkpoints (if landed): a card's agent run should reference its workspace snapshot so the
  card carries a one-click rollback. Note the dependency; don't block on it if B4 isn't merged yet.

### Before building — propose and PAUSE

Write a short design note covering: the **work-item store** (new SQLite table: id, title, body,
column/status, linked session/agent id, approval row id, checkpoint id, timestamps, audit), the
**state machine** (who moves cards — user drag vs. agent events vs. approval resolution), how
creating a card **kicks off** agent work (delegation entrypoint), the **feed/poll** shape, and the
page/nav placement. **Stop and get sign-off on this design before implementing.**

### Build (after sign-off)

The store + migration, the `/api/agent-work/*` routes (list/create/move/feed) + pure builder, the
console page + nav entry, and the wiring: create card → delegate agent → card auto-advances on
`agent:delegated`/`agent:completed`, parks in "Needs approval" when an approval row is pending,
lands in Done/Failed on completion. **Tests:** card lifecycle advances on simulated agent events;
an approval-gated card parks and resolves correctly; the feed builder is pure and deterministic;
creating a card delegates exactly one agent; access-controlled like other console routes.

Keep the board a **paw primitive**; the fork later skins domain Jobs/Tasks boards over the same
store/feed.

---

## Out of scope here (other sessions / later)

- **Fork UI:** ConstructAI table pagination, Settings config-in-drawers, domain Jobs/Tasks kanban —
  construction-agent session.
- **Context compression** (Hermes QW3 second half — lossy mid-thread summarization for long
  threads): a worthwhile later paw PR, but it "needs care" and isn't scoped here. Flag, don't build.
- **`supabase_create_table` type-fidelity** (requested `int8` id came out `uuid`; first rejected
  `id` as reserved): real paw tool bug, its own small PR when you get to it.
- **Hermes breadth** (more messaging platforms, deploy backends, providers, RL/trajectory tooling):
  deliberately declined per `PAW-vs-HERMES-strategy.md` — do not chase.

*Borrow the parts. Win on the canvas moat.*
