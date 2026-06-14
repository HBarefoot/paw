# Prompt: Paw master — agent QA on canvas pages (Web Pilot)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**.
Task detail only below.

**Goal:** let the agent **test a canvas page in a real browser** — load it, see it, run JS against
it, drive the UI, and record — using the existing Web Pilot plugin. One PR off `main`:
`feat/canvas-webpilot-qa`.

## What already exists (verified — extend, don't duplicate)

`plugins/web-pilot/` runs Playwright/Chromium (`index.ts`: lazy `chromium.launch`, per-session pages
capped at `maxPages`, `defaultTimeout`). Its tools (`plugins/web-pilot/tools.ts`) already cover most
of the ask:
- `browser_navigate` (goto) · `browser_get_text` · `browser_click` · `browser_fill` ·
  **`browser_screenshot`** ("see the browser") · **`browser_evaluate`** ("execute JS").

So "see the browser / execute JS / test the UI" largely **exist**. This PR adds the gaps and makes
them usable against canvas pages.

## What to build

1. **Recording** — add `browser_record_start` / `browser_record_stop` (Playwright context
   `recordVideo`, or a screenshot-sequence → file). Returns a saved artifact path under the
   workspace (audit-logged). Enforce a max duration / size cap.
2. **Console + network capture** (optional but high-value for QA) — a `browser_console`/
   `browser_network` read that returns recent console errors / failed requests for the current page,
   so the agent can diagnose a broken canvas page, not just see it.
3. **Authenticated canvas testing.** Public canvas pages (`/canvas/share/:token`) work as-is. To
   test an **auth-gated** page (`/api/app/:space/*`, or a companion-injected page) the headless
   browser needs a session — provide a controlled way to attach the owner's session (e.g. inject the
   session cookie / a short-lived token) **for the owner's own pages only**, and document the
   boundary. Do **not** build a general credential-injection tool.
4. **Respect the plugin sandbox.** Honor `plugins/web-pilot/manifest.json` permissions, the page cap,
   and timeouts. Network egress stays within what the sandbox already allows.

## Tests (fail on pre-feature code)
- `record_start` → action → `record_stop` produces a non-empty artifact file; duration/size cap
  enforced.
- console/network capture returns structured entries for a page with a known error.
- The authed-page path attaches a session and loads a gated canvas page; the unauthed path is
  rejected as today.
- Page cap + timeout still hold (don't regress the eviction logic in `getPage`).

## Out of scope (flag, don't build)
The in-page co-pilot bridge into the user's *live* browser (that's `feat/canvas-copilot-bridge` —
this PR is the agent's *own* headless browser); changes to canvas serving; fork UI.
