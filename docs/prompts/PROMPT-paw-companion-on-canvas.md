# Prompt: Paw master — companion on canvas pages (authenticated visitors only)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**
(standing rules + integration seams — note especially the companion same-origin-iframe seam). Task
detail only below.

**Goal:** when an **authenticated owner/admin** opens a served canvas page, inject the Companion so
they get the in-context assistant. **Anonymous visitors see the plain page** — no companion, no
leakage. One PR off `main`: `feat/companion-on-canvas`.

## What you're building on (verified)

- Every served canvas page passes through **`injectCanvasRuntime(html)`** (`src/web/canvas-serve.ts`
  ~60) — the single HTML post-process seam. Serve sites that call it: `/canvas/share/:token`
  (`app.ts` ~2523, **public** — in `PUBLIC_PREFIXES`), the canvas file handlers (~3046, ~3113), and
  the auth-gated app-space route `GET /api/app/:space/*` (~3064+, **not** public → already requires
  a session).
- Auth state is on the request: the auth middleware sets `admin` on the Hono context
  (`src/web/middleware/auth.ts`); `PUBLIC_PREFIXES` marks public routes (canvas share/preview are
  public, but downstream handlers can still read whether a valid session exists).
- The **companion** is served same-origin at `/companion` (you shipped #115/#116). Same-origin → it
  can run on the paw host and fetch `/api/*`.

## What to build

1. **Thread auth state into the injection.** `injectCanvasRuntime` is currently a pure
   `(html) => html`. Give it an authenticated-visitor signal (e.g. a second arg
   `{ authed: boolean }`, or a sibling `injectCanvasRuntimeFor(html, ctx)`), computed at each serve
   site from the request's session — **true only when a valid web session / `admin` is present**.
   Keep the existing pure signature working for callers that don't inject the companion.
2. **Inject a companion launcher when `authed`.** A small floating launcher (corner button) that
   opens the companion (load `/companion` in an overlay/iframe, or the existing companion mount).
   When not authed, inject nothing. The launcher bootstrap must carry **no secrets** and must not
   interfere with the page's own scripts/styles (scope it; respect the canvas page's CSP/sandbox —
   check `createSecurityHeaders` for canvas).
3. **Don't break the public path.** A logged-out visitor to a `/canvas/share/:token` page must get a
   byte-clean page (modulo existing runtime injection) with zero companion code.

## Tests (fail on pre-feature code)
- Authed request to a canvas serve route → output contains the companion launcher bootstrap.
- Anonymous request to the same route → output contains **none** of it.
- `injectCanvasRuntime` default/legacy callers still produce valid output (no companion when no auth
  signal).
- The injected launcher is inert/non-leaking: assert no secret/token material is embedded.

## Out of scope (flag, don't build)
The agent-operates-the-page bridge (separate `feat/canvas-copilot-bridge`); custom-domain serving
(separate prompt — note the cross-domain cookie/auth interaction there, not here); any change to the
companion's own UI; fork UI.

> Sequencing: this is the **foundation** for the canvas co-pilot bridge. Land it first.
