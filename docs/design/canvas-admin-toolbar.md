# Design note — Canvas admin toolbar: inline edit + companion-driven edits (SHIPPED)

> **Status: SHIPPED** — built across PRs #131 (toolbar + promptable Assistant), #132 (inline
> click-to-edit), #133 (companion-driven approval-gated edit), #134 (share-page fix). The live-DOM
> bridge (`readDom`/`highlight`/`execJs` + the `execJs` flag) is the one **deferred** follow-up
> (browser-unverifiable + the streamHandler approval-gate gap noted in #133). Kept as the design record.


Source prompt: `docs/prompts/PROMPT-paw-canvas-edit-toolbar.md`. **Extends** the co-pilot bridge note
(`docs/design/canvas-copilot-bridge.md`) with a concrete UX (a Vercel-Toolbar-style floating toolbar)
and the inline **click-to-edit** persistence design. Owner-only, explicit, audited. Design reference
only — study the Vercel Toolbar's compact-floating-tool + Edit-Mode/Content-Link pattern; build
paw-native, no copied code.

Prerequisite shipped: the single companion launcher per page (`fix/canvas-companion-dup`, PR #130) —
the toolbar **replaces** that bare launcher and inherits its top-level-only reveal + idempotent
injection, so "one entry point per page" holds for good.

Branch (when signed off): `feat/canvas-admin-toolbar`.

---

## 0. Scope of THIS note vs the bridge note
- The **RPC verb set + per-verb gating + JS containment** for companion-driven edits are already
  designed in `canvas-copilot-bridge.md` (§1–§3). This note does **not** re-litigate them; it adopts
  them and adds the two missing pieces the prompt calls for: **(A) the toolbar UX/states** and
  **(B) the DOM→source persistence mapping for inline click-to-edit** (the hard part).
- Out of scope (flag, don't build): structural/layout drag-editing (text first), custom domains, the
  ConstructAI fork UI, anything beyond the signed-off RPC/edit surface.

---

## 1. Toolbar UX & states (replaces the bare ✦ launcher)
One compact floating pill, **authenticated admin only**, **top-level only** (reuses #130's
`window.top === window.self` reveal + `display:none` default, so embedded/sandboxed frames never paint
it). Anonymous visitors get a byte-clean page — unchanged.

States:
- **Collapsed** — a small unobtrusive pill, bottom-right. Hover/click expands.
- **Expanded** — a short horizontal toolbar:
  - **Assistant** → opens the same-origin `/companion` panel (the single entry point; resolves the
    "two surfaces" complaint for good — there is no separate launcher anymore).
  - **Edit** → toggles **Edit Mode** (off by default).
  - small status slot (idle / "Editing" / "Saving…" / "Saved" / "Page changed — reload").
- **Edit Mode ON** — editable text elements get a subtle hover affordance (outline + edit cursor, à
  la Vercel Content Link). The page is otherwise live.
- **Editing element** — clicking an editable element makes it `contenteditable`, focuses it;
  **Enter / blur = save**, **Esc = cancel** (revert to pre-edit text). One element at a time.
- **Saving / Saved / Conflict** — toast + toolbar status; conflict offers Reload.
- **Assistant open** — the companion panel; from there the admin can ask for page edits (bridge, §3).

All toolbar markup/CSS stays scoped under `paw-cmp-*` / a new `paw-tb-*` namespace so it can't clobber
the page; injected through the **single seam** `injectCanvasRuntime`/`injectCompanionLauncher` in
`src/web/canvas-serve.ts` (keep it a real template-literal-cooked script per the inline-script-trap
rules — no regex literals/backslashes).

---

## 2. Inline click-to-edit — DOM→source persistence mapping (the hard part)
**Goal:** a DOM text edit persists back to the **stored canvas HTML source**, and live-reload reflects
it — **without re-serializing the DOM** (which would destroy scripts, formatting, and the injected
runtime).

### 2.1 Editable node definition (conservative allowlist)
A node is editable iff it is a leaf-ish text element: tag in
`{h1..h6, p, span, a, li, td, th, button, label, blockquote, figcaption, small, strong, em, b, i}`
**and** its children are text / inline-formatting only (no block/structural children, no `<script>`,
no `<style>`). Editing replaces the element's **text content only** — never attributes or structure.
New text is HTML-escaped on write (no markup injection).

### 2.2 Stable anchors, persisted to source (`data-edit-id`)
Map a DOM edit to a source location by **anchor**, not by DOM re-serialization:
- **Lazy, persisted stamping.** The first time a page is prepared for editing, the server parses the
  **source file** with a **position-aware** HTML parser, walks editable nodes in document order, and
  assigns each a stable `data-edit-id="eN"` (append-only; **never renumbered**), then writes the file
  once via `canvas_write`. Served HTML therefore always carries the same anchors the source has.
- **Patch by anchor.** On save the client sends `{ path, editId, newText, originalText }`. The server
  locates the element by `data-edit-id="eN"` and **splices only its inner-text byte range** in the
  source string; everything else (scripts, runtime, whitespace) is byte-identical. Write goes through
  the existing `canvas_write` path → which already snapshots to `canvas_versions` (last 10) and fires
  the file-watch event.
- **Why persisted-to-source (not client-only ordering):** anchors in the source make every later edit
  a pure lookup, immune to client/server enumeration drift. If the agent regenerates the file
  (`canvas_write` of fresh HTML), anchors are simply re-stamped on next edit-prep.
- **Parser choice (open question §6):** a small position-tracking HTML parser. Prefer a tiny
  dependency or a constrained hand-rolled tokenizer over a full DOM lib; **must** preserve unparsed
  regions verbatim. We only need: enumerate editable elements with their inner-text source ranges +
  read/insert a single attribute. No full serialization path is ever taken.

### 2.3 Concurrency, reload, undo
- **Optimistic concurrency.** The save carries `originalText` (what the client saw). If the source's
  current text at that anchor differs (agent edit, another tab), **reject** with "page changed —
  reload" rather than clobber. No silent overwrite.
- **Live-reload.** Reuse the existing `/api/canvas/events` file-changed poll (the same one app-space
  pages use) so a saved edit refreshes other viewers; the editing tab updates optimistically and
  reconciles on the event.
- **Undo.** Durable undo reuses `canvas_versions` (canvas_write already snapshots pre-write). v1:
  Esc cancels an **unsaved** edit in-place; a saved edit is undone via version restore (toolbar
  "Undo last save" → restore previous `canvas_versions` row for that path). A per-session client undo
  stack is a nicety, not required for v1.

### 2.4 Persistence seam
New owner-only route `POST /api/canvas/edit` (NOT in `PUBLIC_PREFIXES`; re-checks the admin session
exactly like `isCanvasCompanionVisitor`) → does the anchor stamp/patch → writes via `canvas_write`.
Path is validated to the canvas workspace (reuse `safePath`).

---

## 3. Companion-driven edits (the bridge)
Adopted verbatim from `canvas-copilot-bridge.md`:
- Same-origin `postMessage` RPC between the companion iframe and the host page.
- **Read-only verbs** (`readDom`, `queryAll`, `highlight`, `screenshot`) → no approval.
- **Side-effectful verbs** (`execJs`, `applyEdit`) → **approval-required** via the existing queue
  (`GET /api/approvals/pending` + `POST /api/approvals/:id/approve|deny`, #110/#112), **blocked until
  approved**, owner-only, JS contained to the current canvas origin (no cross-origin, no secrets/vault).
- `applyEdit` writes through the **same `canvas_write` + anchor-patch** path as §2, so agent edits and
  human inline edits share one persistence mechanism and one audit trail.

---

## 4. Gating model — the key distinction (open question §6.1)
- **Inline click-to-edit = a DIRECT owner action.** The admin is editing their own page in their own
  authenticated session (same trust as editing the file in the editor). Proposed: **owner-only +
  audited, NO approval** — you don't approve yourself. Gated only by the toolbar being admin/top-level.
- **Companion-driven `applyEdit`/`execJs` = the AGENT acting on your behalf.** Proposed:
  **approval-required + audited** (the approval queue exists precisely to gate agent side-effects).

This keeps the human-direct path frictionless while the agent-driven path stays explicitly consented.
Flagged for sign-off in §6.

---

## 5. Audit
- Inline edit → `audit_logs`: `canvas.inline_edit` (path, editId, outcome; text **hashed/length**, not
  the full content of any sensitive copy).
- Bridge action → `canvas_bridge.<verb>` (selector/file, approval id, outcome) per the bridge note.
- Every **side-effectful** action writes an audit row; read-only verbs do not.

## 6. Failure / reload / disconnect
- Page navigates away / iframe unloads → bridge channel drops; pending approvals **expire**
  (`actionable(ttl)`/`expireStale`); companion re-handshakes on reconnect.
- Inline save conflict → rejected, toast "reload", no write.
- `execJs`/`applyEdit` error → returned to the agent as a tool error; turn continues.
- Approval timeout → queued action discarded, audit `…rejected`.

---

## 7. Open questions for sign-off
1. **Inline-edit approval:** confirm inline click-to-edit is owner-direct → **audited but not
   approval-gated** (agent-driven `applyEdit` stays approval-gated). (Proposed: yes.)
2. **HTML parser for anchor stamping:** acceptable to add a small position-aware HTML parser
   dependency, or hand-roll a constrained tokenizer? (Proposed: tiny dep if vetted, else hand-roll;
   either way never re-serialize.)
3. **Editable allowlist:** is the §2.1 tag set right for v1 (text leaves only), or also allow
   editing inline-formatted paragraphs (text with nested `<strong>`/`<a>`)? (Proposed: leaves first;
   inline-formatted as a fast-follow.)
4. **Undo depth:** rely on `canvas_versions` (last 10) for durable undo, plus Esc for unsaved — or
   build a fuller client undo stack in v1? (Proposed: versions + Esc.)
5. **Toolbar vs companion split:** Assistant button opens the existing `/companion` panel (no new
   surface), correct? (Proposed: yes — one entry point.)

## 8. Tests (when signed off)
- Toolbar is owner-only + top-level-only (anonymous/framed → none); Assistant opens `/companion` once.
- Edit Mode is owner-only; an inline text edit **persists to the source file** and **survives reload
  with surrounding markup/scripts/the injected runtime byte-intact** (the anchor-splice guarantee).
- Save with a stale `originalText` → rejected (no clobber).
- Anchor stamping is stable/append-only across repeated edits.
- Companion `applyEdit`/`execJs` require an approval row and are **blocked without it**; read-only
  verbs need none; cross-origin/secret access refused.
- Every side-effectful action (inline edit + bridge mutate) writes an `audit_logs` entry.

---

**STATUS: SHIPPED** (PRs #131–#134). The live-DOM bridge verbs + `execJs` flag remain the deferred
follow-up; everything else here landed.
