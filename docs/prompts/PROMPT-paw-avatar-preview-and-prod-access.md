# Prompt: Paw master — fix prod web-chat "Access denied", + avatar picker live preview

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**
(standing rules + integration seams). Task detail only below.

Two unrelated issues, **two sequential PRs off `main`**. **PR 1 first** — it's breaking production chat.

---

## PR 1 — Web chat "Access denied or rate limited" on production only  ·  `fix/web-chat-access`

**Symptom:** on the deployed instance, the **first** message in a new web conversation returns the
red **"Access denied or rate limited"**; localhost is fine. The companion/feed work (skills load,
badges show), so it's the **inbound chat turn** specifically.

### Root cause (verified in source — confirm against prod, then fix)

- The web chat channel is **`web`**, which is **NOT** in `INTERNAL_CHANNELS`
  (`= {"cron","heartbeat","github","api"}`, `src/kernel/kernel.ts:1386`). So every web turn passes
  through **rate limiting** then **access control** (gates at ~1788/1798 on the streaming path; the
  generic error is yielded at **`kernel.ts:1951`** — `"Access denied or rate limited"`). Note the
  **streaming** path yields this *conflated* error, unlike the non-streaming path (~1404–1434) which
  runs the pairing-code flow.
- The web user id is **`web-${admin.id}`** for an authenticated admin (`src/web/app.ts` ~2435/2497/
  3312…). Access control calls `isUserApproved("web-<id>", "web")` against the **`approved_users`**
  table (`src/security/access-control.ts` ~43–58). Rate limit default is `maxRequestsPerMinute: 30`,
  keyed by user id.
- **The tell:** it fails on the **first** message → a per-minute cap wouldn't trip on message #1, so
  this is almost certainly **access control**, i.e. the authenticated web admin **isn't in
  `approved_users` on prod**. Localhost likely has the admin approved (setup auto-approve / seeded
  DB) or different config. **Confirm with prod logs / the prod DB before committing the fix.**

### Fix — two parts

**A. Make the failure debuggable (do this first, cheap, high value).** The conflated
`"Access denied or rate limited"` string hides which gate fired. Split it: the streaming path must
yield (and log) **distinct** outcomes — rate-limited vs access-denied — mirroring the specific
messages the non-streaming path already uses. This alone makes prod diagnosable.

**B. Stop re-gating authenticated web admins.** An authenticated web session has **already** passed
web auth (password + optional TOTP). It should **not** be re-gated by the external pairing-code
access controller (which exists for Slack/external channels). Pick and justify one:
  - (i) auto-approve `web-<adminId>` in `approved_users` at admin creation/login; or
  - (ii) pass an "authenticated" flag from the web inbound turn and **exempt authenticated web
    sessions** from the pairing access controller; or
  - (iii) treat authenticated-web as trusted in the access-control check.
  Keep **external channels (Slack) still gated**, and **keep rate limiting on** — just make sure its
  prod cap/keying is sane (don't disable it to mask the access bug).

### Tests (fail on pre-fix)
- An **authenticated web-admin** inbound turn is **not** denied by access control; first message
  succeeds.
- An unapproved **external** (e.g. Slack) user is **still** gated (no regression to the pairing flow).
- Rate-limited vs access-denied now produce **distinct** errors/log lines on the streaming path.

---

## PR 2 — Avatar picker: live face preview + polish  ·  `feat/avatar-picker-preview`

**Problem:** the `/preferences` picker (`src/web/views/preferences-page.tsx`) shows **text-only**
cards (`data-avatar={a.key}` + a description) and the avatar list is **duplicated statically** in the
page (the file even warns *"KEYS MUST MATCH the registry"*). Henry wants to **see the face** he's
selecting, and the tab reads as unfinished.

### Build
- **Render a live face preview in each card** by mounting the avatar renderer from the registry
  exposed on **`window.Companion`** (#127) — call each avatar's `build()` into its card. Load the
  companion renderer modules + CSS (`src/web/public/companion/styles.css`, incl. `.robot-face`) on
  `/preferences`.
- **Drive the card list from the registry** (key / label / description) instead of the static copy —
  kill the duplication so adding a registry avatar surfaces a card with no page edit.
- Each preview: a small face at a card-appropriate size, honoring **`--accent`** + **light/dark**
  (#115) + **reduced-motion**; a gentle idle (blink/breath) is nicer than static but keep it cheap.
  Respect the backgrounded-iframe freeze (rest visible, no `opacity:0` entrance). Keep the green
  selected highlight.
- **Polish the layout:** responsive grid, larger cards (face + name + description), so it stops
  looking like a row of empty boxes.

### Tests (fail on pre-feature)
- Each card mounts the correct avatar's face **from the registry**; the list is registry-driven
  (adding a registry avatar yields a new card without editing the page).
- Selecting still writes `localStorage["paw-avatar"]` and live-swaps the open companion (storage
  event); previews render in light **and** dark.

### Out of scope (flag, don't build)
The other 8 avatar designs (separate follow-up); any change to the avatar *renderers* themselves;
fork (ConstructAI) UI.

> Sequencing: PR 1 first (production is broken). PR 2 edits `preferences-page.tsx` + loads companion
> assets; independent of PR 1.
