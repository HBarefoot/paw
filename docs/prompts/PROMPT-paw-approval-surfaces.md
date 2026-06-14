# Prompt: Per-Channel Approval Surfaces + Unstick the Companion (paw, upstream)

> Paste as the task prompt for a coding agent working in the **paw** repo (`~/repos-and-projects/paw`). Read `CLAUDE.md` first. Three work items, ideally one PR (they're tightly coupled), branch `feat/approval-surfaces`.

---

## Background / diagnosis (confirmed in code)

The companion shows **"Waiting for your approval…"** with a worried face and gets stuck there indefinitely. Root cause, traced:

- The companion's `waiting` state is driven by `pendingApprovals` in the ops feed (`src/web/app.ts:~942`) = `kernel.githubApprovals.listPending().length` (`src/integrations/github/approvals.ts:97`), i.e. rows in `github_pending_actions` with `status='pending'`.
- The **only** surface to resolve a pending action today is the web `/github` page. Approvals queued from any other context (or left over from old sessions) sit `pending` forever, with no notification and no in-context way to act — so the companion wedges on "waiting" and the operator has no idea what it's waiting for.

Two things to fix: (1) make pending approvals **actionable in the channel they came from** (Slack ↔ Web UI), and (2) make the companion's waiting state **honest and self-clearing**.

---

## Work item A — Generalize the approvals queue + record origin channel

The queue is GitHub-specific today. Make it a **general approval surface** (GitHub is the first user; future: destructive Supabase/WordPress ops, etc.) and record where each request originated so it can be routed back.

- Add an `origin` concept to the pending-action record: `origin_channel` (`web` | `slack` | `cron` | …) and `origin_ref` (e.g. Slack channel+thread ts, or web session id) — additive nullable columns on `github_pending_actions` (idempotent migration in `src/store/db.ts`); if you rename the table to something general like `pending_approvals`, keep a view/compat shim so existing code + the `/github` page keep working, and justify the choice. Don't break the GitHub approvals page.
- When the agent enqueues an approval (the `approvals.enqueue(...)` path), capture the originating channel/ref from the inbound message context that triggered it. If origin is unknown, default to `web`.
- Keep the existing `approve()` / `reject()` methods as the single resolution path — every surface below calls them. Resolution from any surface updates the same row, so the count drops everywhere at once.

## Work item B — Deliver the approval to the originating channel

When an action is queued for approval, **push an interactive prompt to the channel it came from**, and let the operator approve/deny *there*.

**Web UI:** a context modal (reuse the `pawModal` DOM-node pattern — NOT an HTML string; remember the string→textContent trap that bit three callers) showing: action summary, target (repo/PR/etc.), requester, and **Approve / Deny** buttons. Trigger it when the ops-feed poll reports a new pending approval for this session, or via a bell/indicator the operator can click to open the pending list. Approve/Deny POST to a new authed endpoint (`/api/approvals/:id/approve` | `/deny`) that calls the existing `approve()`/`reject()`. On success, close the modal and let the next poll clear the companion.

**Slack:** the Slack plugin runs **Socket Mode** (no public URL needed — interactive payloads arrive over the socket). When an approval is queued with `origin_channel='slack'`, post a Block Kit message to the origin channel/thread with the action summary + **Approve** / **Deny** buttons (`block_actions`). Handle the interaction callback in the Slack plugin → call `approve()`/`reject()` → update the Slack message in place ("✅ Approved by @user" / "❌ Denied"). Guard: only the authorized operator may act (check the Slack user against the allowlist/approved-users).

**General rule:** the surface that *shows* the prompt matches the origin channel. A web-originated approval → web modal; a Slack-originated one → Slack buttons. Both resolve the same underlying row, so resolving in one place clears it everywhere (the companion, the `/github` page, the other channel's stale prompt should reflect resolution on next render).

## Work item C — Make the companion's waiting state honest & self-clearing

- The `waiting` face must reflect **currently-actionable** pending approvals only. When the count returns to 0 (resolved from any surface), the companion must leave `waiting` on the next poll — verify there's no latch that keeps it stuck.
- Add a **staleness guard** so an orphaned/abandoned pending row can never wedge the face forever: e.g. pending actions older than a configurable TTL (default 24h) are surfaced distinctly ("stale — review on /github") and/or auto-expired to a `expired` status with an audit entry — your call, but a pending row must not be able to hold the companion in `waiting` indefinitely with no operator recourse.
- The caption should be **informative**, not just "Waiting for your approval…": include what + how many (e.g. "Waiting for your approval — merge PR #42" / "2 actions awaiting approval"), so the operator knows what it wants without hunting.
- **Migration/cleanup:** ship a one-time guard that any pre-existing `pending` rows are still resolvable through the new surfaces (don't strand the current stuck row — it should appear in the new web modal/list so the operator can clear it without SQL).

---

## Tests
- Enqueue with origin=web → web pending list/endpoint returns it; approve via `/api/approvals/:id/approve` → row `executed`, count→0.
- Enqueue with origin=slack → Block Kit message built with Approve/Deny actions; simulated `block_actions` from the authorized user → `approve()` called, message updated; unauthorized user → rejected, no state change.
- Resolution from one surface drops the count seen by the ops feed (companion clears).
- Staleness: a pending row older than TTL no longer holds `waiting` (expired/flagged per your design).
- Migration idempotent; `/github` page still lists + resolves pending actions; existing approval tests still pass.

## Gates
`bun test` green from a clean checkout; `bun x tsc --noEmit` baseline; `bun run lint` zero new on touched files; no `Co-Authored-By: Claude` trailers; surgical merge-friendly diffs; the Slack interaction code lives in the Slack plugin (don't grow `app.ts` beyond the new approval endpoints + mounts).

## Acceptance
Queue an approval from a Slack-triggered action → an Approve/Deny prompt appears **in that Slack thread**; tap Approve → it executes, the message updates, and the companion stops "waiting." Do the same from the web → a context modal appears in the Web UI with Approve/Deny. Leave one unresolved past the TTL → the companion no longer wedges. The currently-stuck production row is resolvable from the new web surface without touching SQL.

## Downstream note
construction-agent inherits this on next merge-down — ConstructAI gets per-channel approvals for free (relevant once its agent gates destructive client-facing actions).
