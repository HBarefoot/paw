# Prompt: Paw master — canvas admin toolbar (fix dup companion + inline edit + companion-driven edits)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**.
Task detail only below. This **extends** `PROMPT-paw-canvas-copilot-bridge.md` (the bridge internals)
with a concrete UX direction and a duplication fix.

**The experience we want (design reference: the Vercel Toolbar):** when the **authenticated admin**
views a served canvas page, they get **one compact, unobtrusive floating toolbar** — not a second
full companion panel. From it they can (a) open the assistant, (b) toggle **Edit Mode** and
**click text to edit it inline**, and (c) ask the companion to **modify the page**. Anonymous
visitors see a clean page, nothing injected.

Two PRs off `main`. **PR 1 first** (it's a visible bug).

---

## PR 1 — Fix the duplicated companion on canvas pages  ·  `fix/canvas-companion-dup`

**Symptom:** on a served public canvas page (e.g. the market-report page) the companion shows
**twice** — a full companion surface *and* the floating launcher.

**Where to look (verified):** the launcher markup is `COMPANION_LAUNCHER` in
`src/web/canvas-serve.ts` — a single hidden-until-click ✦ button + a 380×560 `/companion` iframe
panel, guarded by `if (window.top !== window.self) return;`. It is injected from **two** sites:
- `injectCompanionLauncher(page)` on the `/canvas/share` wrapper (`app.ts` ~2597, gated by
  `isCanvasCompanionVisitor`), and
- `injectCanvasRuntime(html, { companion: true })` (`app.ts` ~3105 / ~3174, gated by
  `shouldServeCompanion` ~384).

Reproduce on the actual served page, then find the second source and guarantee **exactly one**
companion entry point per page. Likely causes to check: a page served through a route that applies
**both** wrappers; a generated canvas page that **embeds its own `/companion`** as content (then the
launcher is the duplicate); or `shouldServeCompanion`/`isCanvasCompanionVisitor` disagreeing. Make
the decision single-sourced.

**Tests (fail on pre-fix):** a page served via each route carries **one** launcher and no inline
companion duplicate; a page touched by both wrappers still injects only once; anonymous visitor →
zero companion markup.

---

## PR 2 — Admin canvas toolbar: inline edit + companion-driven edits  ·  DESIGN-FIRST, pause for sign-off

Powerful + security-sensitive (live DOM editing, JS, persistence). Owner-only, explicit, audited.

### Replace the bare launcher with a Vercel-Toolbar-style toolbar
One compact floating toolbar for the **authenticated admin only**. Unobtrusive pill that expands to:
- **Assistant** — opens the companion (same-origin `/companion`), the single entry point (resolves
  PR 1's "two surfaces" for good).
- **Edit** — toggles Edit Mode.

### Inline click-to-edit (the "click text and change it" ask)
In Edit Mode, hovering a text element shows an affordance (à la Vercel Content Link); clicking makes
it editable in place (contenteditable); on save the change **persists to the canvas source file**
and live-reload reflects it. The **hard part is mapping a DOM edit back to the stored HTML** — design
it explicitly:
- Prefer **stamping editable text elements with stable anchors** (e.g. `data-edit-id`) at serve time
  and patching the **source file by anchor**, NOT re-serializing the whole DOM (which would destroy
  scripts/formatting/the injected runtime).
- Define which nodes are editable (text), how concurrent edits/reload interact, and undo.
- Persist via the existing `canvas_write` path; reuse the canvas file-watch + event-poll reload.

### Companion-driven edits (the bridge — from `PROMPT-paw-canvas-copilot-bridge.md`)
The admin asks the companion to modify the page; the same-origin companion bridges to the host page
(postMessage/RPC) to read the DOM and apply edits through `canvas_write`. **Side-effectful actions
(execJs / applyEdit) gate through the existing approval surface (#110/#112) and write `audit_logs`;
read-only verbs don't.** Owner-only; JS containment per the bridge prompt.

### Design FIRST — propose and PAUSE
Write a short design note covering: the toolbar UX/states; the **DOM→source persistence mapping** for
inline edits; the bridge RPC verb set + per-verb gating (read-only vs approval-required); audit; and
failure/reload/disconnect semantics. **Get sign-off before implementing.** Then build only what's
signed off, with tests: Edit Mode is owner-only; an inline text edit persists to the source file and
survives reload **with surrounding markup/scripts intact**; companion `applyEdit`/`execJs` require an
approval row and are blocked without it; every side-effectful action writes an audit entry.

### Out of scope (flag, don't build)
Structural/layout drag-editing (text first); custom domains; fork (ConstructAI) UI; anything outside
the signed-off RPC/edit surface.

> Design reference only — study the Vercel Toolbar's compact-floating-tool + Edit-Mode/Content-Link
> click-to-edit pattern; do not copy code. Build paw-native.
