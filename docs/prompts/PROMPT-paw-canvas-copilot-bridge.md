# Prompt: Paw master — canvas co-pilot bridge (DESIGN-FIRST, security-sensitive)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**.
Task detail only below.

**Goal:** let the agent help the admin **on the page they're actually viewing** — read the live DOM,
run JS in *their* session, and live-edit the canvas page — from the companion injected by
`feat/companion-on-canvas`. This is powerful and risky. **Owner-only, explicitly invoked, fully
audited.** Branch: `feat/canvas-copilot-bridge`.

## Hard prerequisite
This builds on **`feat/companion-on-canvas`** (auth-gated companion injection). Land that first.

## Build on (verified)
- The injected companion runs **same-origin** on the canvas page → a `postMessage`/RPC bridge between
  the companion and the host page is viable without a new transport.
- The agent already has `canvas_write` / `canvas_read` and canvas has a **live file-watch +
  event-poll reload** loop — so an edit applied via `canvas_write` reloads in place.
- Approvals are channel-agnostic (#110/#112): `GET /api/approvals/pending` +
  `POST /api/approvals/:id/approve|deny` — **reuse this as the consent gate** for risky actions.
- Audit log table exists (`audit_logs`) — every bridge action writes an entry.

## Design FIRST — propose and PAUSE for sign-off
Before writing feature code, write a short design note covering:
1. **RPC surface:** the minimal verb set — e.g. `readDom(selector)`, `highlight(selector)`,
   `execJs(code)`, `applyEdit(file, patch)` (→ `canvas_write` + reload). Justify each; keep it small.
2. **Gating + consent model:** owner/admin **only**; every `execJs` / `applyEdit` is **explicitly
   invoked per action** (no silent/standing execution) and routed through the **approval surface**
   for confirmation. Define exactly which verbs are read-only (no approval) vs. side-effectful
   (approval required).
3. **Execution context & containment:** where agent JS runs (page context vs. a sandboxed frame),
   what it can/can't reach, and how a malicious or buggy script is contained. No access to secrets,
   vault, or cross-origin.
4. **Audit + recording consent:** what each action logs to `audit_logs`; if session/screen recording
   is included, how the user consents.
5. **Failure/disconnect semantics:** page navigates away, bridge drops, approval times out.

**Stop and get sign-off on this design before implementing.** Then build only what's signed off,
with tests defined alongside the design (at minimum: owner-gating enforced; side-effectful verbs
require an approval row and are blocked without it; every action writes an audit entry; read-only
verbs need no approval; JS containment holds).

## Out of scope
Anything not in the signed-off RPC verb set; custom domains; the headless QA browser
(`feat/canvas-webpilot-qa` is separate); fork UI.
