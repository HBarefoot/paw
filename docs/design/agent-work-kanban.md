# Design note — Agent-work kanban (DESIGN-FIRST, awaiting sign-off)

Source prompt: `docs/prompts/PROMPT-paw-theme-kanban-docs.md` (PR4). A board where each
card is a unit of work the user creates, hands to the agent, and watches move across
columns. Paw primitive; the fork later skins domain Jobs/Tasks over the same store/feed.

Columns: `Backlog → Queued → Agent working → Needs approval → Done` (+ `Blocked`, `Failed`).

## 1. Work-item store (new SQLite table `agent_work`)
```
id TEXT PK
title TEXT NOT NULL
body TEXT DEFAULT ''            -- the instruction handed to the agent
status TEXT NOT NULL            -- backlog|queued|working|needs_approval|done|blocked|failed
session_id TEXT                 -- the chat/agent session this card drives
agent_name TEXT                 -- delegated agent (from kernel.activeAgents)
approval_id TEXT                -- linked github_pending_actions / approvals row when parked
checkpoint_id TEXT              -- B4 workspace snapshot (nullable; one-click rollback later)
error TEXT                      -- failure reason when status=failed
position INTEGER NOT NULL       -- ordering within a column
created_by INTEGER              -- admin id (single-admin deploy)
created_at, updated_at TEXT DEFAULT (datetime('now'))
```
Migration runs inline in `src/store/db.ts` (same pattern as other tables). Store module
`src/store/agent-work.ts` (pure CRUD + `move(id,status,position)` + `listByColumn()`).

## 2. State machine — who moves cards
- **User** (drag, or create): `backlog ⇄ queued`; `queued → working` is the "hand to agent" action.
- **Agent events** (bus, the same source Agent Ops uses): on `agent:delegated` for the card's
  session → `working`; on `agent:completed` → `done` (or `failed` if the run errored).
- **Approval resolution** (#110/#112): when a card's run enqueues an approval row, the card →
  `needs_approval` (store `approval_id`); on approve/deny resolution → resumes to `working`/`done`
  or `blocked`. Driven by the existing approval bus events — the card never forks the engine.
- **Manual override**: user can force `blocked`/`failed`→`queued` (retry).
Guard: status transitions validated in `agent-work.ts` (reject illegal jumps), unit-tested.

## 3. Create → kick off agent (delegation entrypoint)
Creating a card in `queued` (or moving to `queued`) and pressing "Start" calls the **existing
delegation path** (the one the chat uses to spawn an agent for a session) with `{title+body}` as the
turn and a fresh `session_id` stored on the card. **Exactly one agent per card** (tested). No new
agent runtime — reuse the kernel's delegate.

## 4. Feed / poll shape (mirror `/ops`)
- `GET /api/agent-work/feed` → pure builder `src/web/routes/agent-work-feed.ts` (like `ops-feed.ts`):
  `{ columns: { <status>: Card[] }, version }`. Polled ~2s by the page.
- `GET /api/agent-work` (list), `POST /api/agent-work` (create+optionally start),
  `POST /api/agent-work/:id/move` `{status,position}`, `POST /api/agent-work/:id/start`,
  `POST /api/agent-work/:id/retry`. Access-controlled like other console routes.

## 5. Page / nav
- Vanilla-JS modules served as **real `.js` files** from `src/web/public/agent-work/` (NOT template
  strings — inline-script-template-trap), a view `src/web/views/agent-work-page.tsx` inside the paw
  `Layout`, nav entry "Work" (primary nav). Drag-and-drop via native HTML5 DnD.

## 6. Tests
Card lifecycle advances on simulated `agent:delegated`/`agent:completed`; an approval-gated card
parks in `needs_approval` and resolves; feed builder pure + deterministic; create delegates exactly
one agent; illegal transitions rejected; routes access-controlled.

## Open questions for sign-off
1. **B4 checkpoints**: link `checkpoint_id` now (nullable, wired when B4 lands) or omit until B4? (Proposed: include the nullable column now.)
2. **Drag semantics**: can the user drag a card INTO `working` (force-start) or only via the Start button? (Proposed: Start button only; dragging into `working` is rejected.)
3. **Nav placement**: primary nav "Work" vs under a section. (Proposed: primary.)
