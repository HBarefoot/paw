# Prompt: Paw master — prompt actions (chat messages + saved-prompt library)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**
(standing rules + integration seams). This prompt adds task-specific detail only.

Add quote / copy / edit affordances in **two places** — chat message bubbles *and* the saved-prompt
library. Two sequential PRs off `main`.

## What already exists (reuse, don't rebuild)

- **Saved-prompt library** is fully built: `prompts` table (`src/store/prompts.ts` →
  `StoredPrompt {id,title,body,tags,use_count,...}`), `/prompts` page (`views/prompts-page.tsx`),
  and `/api/prompts` CRUD in `src/web/app.ts`: `GET` list (~3322), `POST` create (~3331),
  `PUT /:id` update (~3348), `DELETE /:id` (~3365), `POST /:id/use` (~3372). So **edit already
  exists server-side**.
- **Chat** is `src/web/views/chat.tsx`; the "Prompts" toolbar button calls `openPrompts()` (~49)
  which fetches `/api/prompts` and inserts a chosen prompt into the composer.

---

## PR 1 — Chat message actions  ·  `feat/chat-message-actions`

On each message bubble in `chat.tsx`, add a small action row (hover/kebab):
- **Copy** — copy the message text to clipboard (`navigator.clipboard`; fallback for null-origin).
- **Quote** — insert the message text into the composer as a quoted block (e.g. prefixed `> `),
  focused and ready to extend. Define the quote format once and reuse.
- **Edit** — for the **user's own** messages: load the text back into the composer to edit and
  re-send as a new turn. Decide and document whether re-sending **forks** from that point (drops
  later turns) or appends a fresh turn — pick the least-surprising behavior and note it; do **not**
  mutate stored history in place unless you add an explicit, tested path for it.

Keep it keyboard-accessible and don't disturb streaming/in-flight messages. **Tests:** copy emits
the right text; quote inserts the formatted block into the composer; edit repopulates the composer
from the chosen user message; edit is not offered on assistant messages (or is read-only there).

## PR 2 — Saved-prompt library UX  ·  `feat/prompt-library-actions`

On the `/prompts` page and the in-chat picker:
- **Copy** — two senses; build both and label them clearly: copy the prompt **body to clipboard**,
  and **Duplicate** the entry (`createPrompt` from an existing one, title suffixed "(copy)").
- **Edit** — inline edit of title/body/tags wired to the existing `PUT /api/prompts/:id` (surface
  the already-present server capability in the UI; no new route needed).
- **Insert as quote** — in the chat picker, an option to insert the prompt **wrapped as a quoted
  block** (same quote format as PR 1) rather than raw, so it reads as referenced context.

**Tests:** duplicate creates a new row from an existing prompt; inline edit persists via `PUT` and
re-renders; copy-body yields the body text; insert-as-quote inserts the wrapped form. Reuse the
PR 1 quote helper (extract it so both share one definition).

## Out of scope (flag, don't build)
Conversation-history rewriting/branching beyond the documented edit-resend behavior; new prompt
storage fields; fork (ConstructAI) UI.
