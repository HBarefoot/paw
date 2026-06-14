# Design note — Canvas co-pilot bridge (DESIGN-FIRST, security-sensitive, awaiting sign-off)

Source prompt: `docs/prompts/PROMPT-paw-canvas-copilot-bridge.md`. Lets the agent help the admin
**on the page they're actually viewing** — read the live DOM, run JS in their session, live-edit the
canvas page — from the companion injected by `feat/companion-on-canvas` (#120, merged).
**Owner-only, explicitly invoked per action, fully audited.** Branch: `feat/canvas-copilot-bridge`.

Prerequisite: builds on #120 (the injected same-origin companion launcher). ✅ merged.

## 1. RPC surface (minimal verb set)
The injected companion runs **same-origin** on the canvas page → a `postMessage` bridge between the
companion iframe and the host page is viable with no new transport. Verbs:

| Verb | Side-effect? | Approval |
|---|---|---|
| `readDom(selector)` → outerHTML/text (capped) | read-only | none |
| `queryAll(selector)` → count + brief list | read-only | none |
| `highlight(selector)` → outline an element | read-only (visual only) | none |
| `screenshot()` → ask host to canvas-capture (or defer to web-pilot) | read-only | none |
| `execJs(code)` → run JS in the page, return result | **side-effectful** | **required** |
| `applyEdit(file, patch)` → `canvas_write` + live-reload | **side-effectful** | **required** |

Justification: read verbs cover "see/diagnose the page"; `execJs` + `applyEdit` cover "fix it". No
broader surface (no arbitrary network, no storage access) in v1.

## 2. Gating + consent model
- **Owner/admin only.** The bridge is offered only when the page was companion-injected for an
  authenticated admin (#120's `shouldServeCompanion`); the host-page bridge listener verifies the
  message origin is same-origin and ignores everything else.
- **Per-action explicit invocation.** Every `execJs`/`applyEdit` is a discrete, user-visible action —
  no standing/loop execution. Each routes through the **existing approval queue** (#110/#112):
  `GET /api/approvals/pending` + `POST /api/approvals/:id/approve|deny`. The action is **blocked
  until approved** and surfaces on companion/web/Slack like any other approval.
- Read-only verbs need **no** approval (they can't mutate).

## 3. Execution context & containment
- Agent `execJs` runs in the **canvas page's own context** (that's the point — it's the user's live
  page). It is the admin's own authenticated origin. Containment:
  - **No cross-origin**: the bridge refuses targets that aren't the current canvas origin.
  - **No secrets/vault**: the bridge never reads `paw_session`, vault values, or other-origin
    cookies; `execJs` results are size-capped and returned as data, not eval'd anywhere privileged.
  - A buggy/malicious script can only affect the page the admin is already looking at (same blast
    radius as the admin opening devtools) — and only after an explicit approval.
- `applyEdit` goes through `canvas_write` (already sandboxed to the canvas workspace) + the existing
  file-watch live-reload, so edits are constrained to canvas files.

## 4. Audit + recording consent
- Every bridge action writes an `audit_logs` row: `canvas_bridge.<verb>` with selector/file (never
  the full payload of secrets), the approval id, and outcome.
- No session/screen recording in v1 (defer; if added later it's a separate explicit opt-in).

## 5. Failure / disconnect semantics
- Page navigates away / iframe unloads → the bridge channel drops; pending approvals **expire**
  (reuse `actionable(ttl)`/`expireStale`), and on reconnect the companion re-handshakes.
- Approval times out → the queued action is discarded (not executed), audit `…rejected`.
- `execJs`/`applyEdit` error → returned to the agent as a tool error; card/turn continues.

## Tests (with the design)
Owner-gating enforced (non-authed / cross-origin message ignored); side-effectful verbs require an
approval row and are blocked without it; read-only verbs need no approval; every action writes an
audit entry; JS containment (cross-origin refused, no secret access); disconnect expires pendings.

## Open questions for sign-off
1. **`execJs` ceiling**: allow arbitrary JS (gated by approval) vs a constrained command set? (Proposed: arbitrary but per-action approved + audited — matches the prompt.)
2. **Transport**: postMessage RPC only, or also let web-pilot drive the same page? (Proposed: postMessage only here; web-pilot is the separate headless path from #124.)
3. **Approval channel**: reuse the generic approvals inbox, or a dedicated "page action" surface in the companion? (Proposed: reuse generic; companion shows it inline.)
