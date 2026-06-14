# Prompt: Paw master — companion skill inbox + approve/decline

You're in the **paw** repo (`~/repos-and-projects/paw`). Read `CLAUDE.md` first.

Build **two** companion features, and **only** these two:

1. **Skill inbox notifications** — click a skill pill on the companion to open an inbox of that
   skill's notifications, and mark them read (per-item and all).
2. **Approve / decline in the inbox** — pending approvals surface in the relevant skill's inbox
   with Approve / Decline actions, resolving through paw's existing approval queue.

This is **paw kernel/console work** (the companion is core → every fork, incl. ConstructAI,
inherits it). One PR off `main`: `feat/companion-inbox-approvals`.

> **Scope discipline — do NOT build anything else.** No "companion presents outcomes / result
> bubble" (that's a separate future feature). No light/dark theme changes to the companion (a
> separate `fix/companion-light-theme` PR owns `companion/styles.css` — see note at the end). No new
> notification *sources*. Stay inside the two features above; if you find adjacent work, flag it in
> the PR body rather than doing it.

## Ground rules

**Follow `docs/prompts/_CONVENTIONS.md`** (standing rules + known integration seams) — branch+PR
discipline, no `Co-Authored-By`, regression-test-fails-first, clean-checkout test hygiene, gates, and
the seams that matter most here (the companion same-origin-iframe model, real-`.js`/`.css` files, and
the backgrounded-iframe animation-freeze) all live there. This prompt only adds task-specific detail
below.

---

## Architecture you're building on (verified — reuse, don't reinvent)

**The companion is an iframe** at `src/web/public/companion/` (`shell.js` ~974 lines is the entry).
It's **served same-origin at `/companion`** (see `src/web/views/chat.tsx` ~1738) specifically so it
**can call `/api/*` directly** — it already fetches `/api/ops/feed`. Use direct `fetch` for inbox
data + actions; you do **not** need a new iframe→parent write channel.

**The parent shell** (`src/web/views/chat.tsx`) pushes live state to the iframe via `postMessage`:
- `notifyPortraitAmbient(...)` (~1610) posts `paw:ambient` with `unread`, `pendingApprovals`,
  `pendingApprovalsLabel`, `unreadByKind`.
- `paw:notify` (~1625) already relays individual notification items
  (`{id, title, level, url}`) — **but the companion's message handler (`shell.js` ~439) doesn't
  handle `paw:notify` today.** You may either start handling it for live push, or just re-fetch on
  open. Don't break the existing `paw:ambient` / `paw:tool` / `paw:input` / `paw:speak` handling.

**Already implemented (don't rebuild):** per-skill unread **badges**. `buildDock()` (`shell.js`
~491) renders one pill per skill with `data-key = skill key`; `renderBadges()` (~533) badges a pill
from `unreadByKind[key]` and toggles `has-alert`. Your inbox hangs off these exact pills/keys.

**APIs that already exist (verified):**
- `GET /api/notifications` (`app.ts` ~1477) → notification items + `unreadByKind`
  (`kernel.notifications.unreadCountByKind()`). A notification's **`kind` === the skill key** (the
  same key as the pill's `data-key`; see the skill/service registry at `app.ts` ~245–268, where
  `kind: "skill" | "service"` and MCP services are `mcp:<name>`).
- `POST /api/notifications/read` (`app.ts` ~1486) with `{ id }` → `kernel.notifications.markRead(id)`.
- `GET /api/approvals/pending` (`app.ts` ~1319) → `{ pending: q.actionable(ttlHours) }` (the
  channel-agnostic approval queue from #110/#112).
- `POST /api/approvals/:id/approve` (~1325) and `POST /api/approvals/:id/deny` (~1344).

Store: `src/store/notifications.ts` (`unreadCountByKind`, `markRead`). Approval queue resolves
through the same `approve()`/`deny()` everywhere (web modal, Slack Block Kit) — your buttons just
hit the HTTP routes above.

---

## Feature 1 — Skill inbox + mark read

- Make each **skill pill clickable** (`buildDock`/the pill nodes in `shell.js`). On click, open an
  **inbox panel** for that skill (slide-in beside the dock; bottom-sheet on narrow widths). Toggle
  open/closed; clicking another pill switches the panel's skill; Esc / outside-click closes.
- Populate the panel by fetching `GET /api/notifications` and filtering items to the clicked skill's
  `kind === pill data-key`. Each item: status glyph (done / needs-attention), title, detail,
  relative timestamp, unread dot. Empty state when none.
- **Mark read**: clicking an item → `POST /api/notifications/read {id}`; a **Mark all read** action
  marks every unread item for that skill (loop the ids, or add a `{ kind }` branch to the read route
  if cleaner — if you extend the route, that's the one allowed small server change, justify it in
  the PR). On success, update the pill badge + `has-alert` immediately (optimistic, then reconcile
  against the next `paw:ambient`/refetch). Don't let counts go negative or desync.
- Keep it resilient to the existing live updates: a `paw:ambient` tick arriving while the panel is
  open must not clobber the open panel or double-count.

## Feature 2 — Approve / decline from the inbox

- Fetch `GET /api/approvals/pending` and **route each pending row to a skill's inbox** by its
  originating skill/tool key where available (match to a pill `data-key`). If a pending row has no
  resolvable skill association, surface it in a clear fallback affordance (e.g. a dedicated
  "Approvals" entry) rather than dropping it — decide and document the mapping.
- Render approval items distinctly from plain notifications (they need a decision, not just a read):
  show the action label + **Approve** / **Decline** buttons.
- **Approve** → `POST /api/approvals/:id/approve`; **Decline** → `POST /api/approvals/:id/deny`.
  On success, remove the row from the panel and refresh the pending count / `pendingApprovals`
  badge. Handle the already-resolved race (row resolved elsewhere — Slack/web modal — between fetch
  and click): a 404/conflict should reconcile silently, not error at the user.
- These are **side-effectful, irreversible-ish controls** — make the buttons unambiguous and
  require the explicit click (no accidental hover-fire); show in-flight state and the resolved
  outcome.

---

## Tests (must fail on pre-feature code)

- Pill click opens the inbox filtered to that skill's `kind`; switching pills re-filters.
- Mark-read posts the right id(s) and the pill badge/`has-alert` updates; mark-all clears the
  skill's unread; counts never go negative.
- A `paw:ambient` update arriving while the panel is open reconciles without clobbering or
  double-counting.
- Pending approvals render in the correct skill inbox (and the fallback affordance for unmapped
  rows); Approve hits `/approve`, Decline hits `/deny`; the row disappears and the pending count
  updates.
- Already-resolved approval (simulate 404/conflict) reconciles silently.
- Prefer unit/DOM-level tests over the live preview iframe (note from the prototype: a *backgrounded*
  iframe freezes CSS entrance animations at their `0%` frame — don't author keyframes that rest at
  `opacity:0`/`scale(0)`, and don't rely on the preview for verification).

---

## Out of scope (flag, don't build)

- Companion **result/outcome bubble** (presenting task results beside the orb) — separate feature.
- Companion **light/dark contrast** fix — owned by `fix/companion-light-theme`, which edits the same
  `companion/styles.css`. **Sequencing:** if that PR is in flight, land it first and rebase this on
  top to avoid colliding in `styles.css`; otherwise keep your CSS additions in a clearly-marked
  block so the theme PR merges cleanly.
- Any new notification sources, fork (ConstructAI) UI, or changes to the approval *engine* (#110/
  #112) beyond calling its existing routes.

*Borrow the parts. Win on the canvas moat.*
