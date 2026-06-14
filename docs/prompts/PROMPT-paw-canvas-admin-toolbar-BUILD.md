# Prompt: Paw master — canvas admin toolbar, FINALIZED BUILD (no sign-off pause)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**.

**This is the finalized, signed-off spec.** It supersedes the design-first prompt
(`PROMPT-paw-canvas-edit-toolbar.md`) and the design note (`docs/design/canvas-admin-toolbar.md`).
**All design questions are decided below — do NOT pause for sign-off. Build it end to end.** The
only stops are the normal per-PR review gates in `_CONVENTIONS.md`.

**Goal (the whole point):** on a served canvas page, the authenticated admin can (1) **prompt the
companion** right there and have it act, (2) **click any text and edit it inline**, and (3) have the
companion **modify the page** on request. Anonymous visitors see a clean page, nothing injected.

## Decisions (locked — these were the open questions; here are the answers)
- **Inline click-to-edit = owner-direct: audited, NOT approval-gated.** Editing your own page in your
  own authenticated session is the same trust as editing the file. Gated only by admin + top-level.
- **Agent/companion-driven edits = approval-gated + audited + owner-only.** `applyEdit` and `execJs`
  go through the existing approval queue (#110/#112), blocked until approved.
- **Anchor stamping uses a vetted position-aware HTML parser (`parse5` `sourceCodeLocationInfo`) —
  NOT a hand-rolled tokenizer.** Splice by byte offset; never re-serialize the DOM. Add a
  **round-trip guard**: refuse the write unless the located byte range equals the expected
  `originalText`.
- **Editable allowlist = text leaves first** (`h1..h6,p,span,a,li,td,th,button,label,blockquote,
  figcaption,small,strong,em,b,i` whose children are text/inline only). Inline-formatted paragraphs
  (text with nested `<strong>`/`<a>`) are the **immediate fast-follow**, called out in the PR.
- **Undo = `canvas_versions` + Esc.** Label the control **"Restore previous version"** (it reverts
  the whole file to a prior snapshot, not just one edit). Esc cancels an unsaved in-place edit.
- **Assistant = a REAL page-scoped chat console, not the display-only `/companion` face.** (This was
  the gap that made earlier builds un-promptable — see PR A.)

## Safety rails (hard requirements, not optional)
Owner/admin + top-level only (reuse #130's `window.top===window.self` reveal + idempotent inject).
Side-effectful agent verbs approval-gated + audited. JS contained to the current canvas origin — no
cross-origin, no secrets/vault. Inline-edit text is HTML-escaped on write (no stored XSS). New write
routes are owner-only, NOT in `PUBLIC_PREFIXES`, path-validated via `safePath`. For v1, prioritize
**`applyEdit`** (structured text patch) over **`execJs`** (arbitrary JS) — ship `execJs` behind a
config flag, default **off**, so the powerful path is opt-in.

---

## PR A — Toolbar + promptable Assistant  ·  `feat/canvas-admin-toolbar`

Replace the bare ✦ launcher with one compact Vercel-Toolbar-style pill (admin + top-level only). It
expands to **Assistant** and **Edit**.

**Assistant must be promptable (the gap fix).** Opening it shows a real **page-scoped chat console**
— a text composer + streamed responses — NOT just the `/companion` display face. Wire it to the
**existing** canvas chat/stream endpoints (`POST /api/canvas/chat` ~app.ts:2364, `POST
/api/canvas/stream` ~2421), passing the **current canvas page path as context** so the agent knows
which page it's working on. Owner-only; reuses `handleInboundStream`. The companion face can ride
along as the avatar, but the panel's defining feature is the input that drives a real agent turn.

**Tests:** toolbar is admin + top-level only (anonymous/framed → none); the Assistant composer posts
to the canvas stream endpoint with the page path as context and renders the streamed reply; one
entry point per page (no duplicate launcher).

## PR B — Inline click-to-edit  ·  `feat/canvas-inline-edit`

**Edit Mode** (toggle in the toolbar, off by default): editable text elements get a hover affordance;
click → `contenteditable` in place; **Enter/blur = save, Esc = cancel**; one element at a time.

Persistence (the hard part — build exactly this):
- On first edit-prep, server parses the **source file** with `parse5` (`sourceCodeLocationInfo`),
  walks editable nodes in document order, assigns stable append-only `data-edit-id="eN"` (never
  renumbered), writes once via `canvas_write`. (Note in the PR: entering Edit Mode mutates the
  source — intentional, makes later edits pure lookups.)
- Save sends `{ path, editId, newText, originalText }` to a new owner-only `POST /api/canvas/edit`
  (not public; `safePath`). Server locates the element by `data-edit-id`, **round-trip-guards**
  against `originalText`, then **splices only the inner-text byte range** — everything else byte-
  identical. Write via `canvas_write` (→ `canvas_versions` snapshot + file-watch event).
- **Optimistic concurrency:** stale `originalText` → reject with "page changed — reload", no clobber.
- **Live reload:** reuse `/api/canvas/events`. **Undo:** "Restore previous version" via
  `canvas_versions`; Esc for unsaved.

**Tests (fail on pre-feature):** an inline edit **persists to the source and survives reload with
surrounding markup/scripts/injected runtime byte-intact**; stale `originalText` → rejected; anchor
stamping is stable/append-only; round-trip guard blocks a mismatched splice; edit is owner-only; new
text HTML-escaped; every save writes an `audit_logs` `canvas.inline_edit` row.

## PR C — Companion-driven edits (bridge)  ·  `feat/canvas-edit-bridge`

The admin asks the Assistant (PR A) to change the page; the same-origin companion bridges to the host
page via `postMessage` RPC. Verbs: read-only (`readDom`, `queryAll`, `highlight`) → no approval;
**`applyEdit`** → approval-gated, writes through the **same `canvas_write` + anchor-patch path as
PR B** (one persistence mechanism, one audit trail); **`execJs`** → approval-gated **and behind the
default-off config flag**. All owner-only, JS contained to origin, no secrets. Audit every
side-effectful action (`canvas_bridge.<verb>`).

**Tests:** `applyEdit`/`execJs` require an approval row and are blocked without it; `execJs` is
unavailable when the flag is off; read-only verbs need no approval; cross-origin/secret access
refused; agent edits land via the same anchor-patch path and audit.

## Out of scope
Structural/layout drag-editing (text first); custom domains; ConstructAI fork UI.

> Build A → B → C as sequential PRs (each its own review), but **do not stop for design sign-off** —
> the decisions above are final.
