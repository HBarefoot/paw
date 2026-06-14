# Paw prompt conventions

Shared rules + known integration seams for every `docs/prompts/PROMPT-*.md` hand-off. Each prompt
says **"Follow `_CONVENTIONS.md`"** instead of restating these. Read this first.

## Authoring principle (for whoever writes the prompt)

Write load-bearing assumptions as **verify-first checkpoints, not assertions.** If an instruction
hinges on a boundary the change crosses — an iframe, a postMessage hop, a class/event inheritance, a
DB table, a config merge — confirm the boundary behaves as assumed (a grep) **before** encoding it,
and phrase it so the agent re-confirms rather than trusts. "Override under `html.dark`" hid a gap;
"the console toggles `.dark` on `<html>` — **confirm the companion actually receives it**; it's a
separate iframe document, so propagate the theme if it doesn't" does not.

## Standing rules (every PR)

- **Single unstacked PR off `main`.** Never commit or push directly to `main` (Railway auto-deploys).
  Fresh branch even for one-line follow-ups. When a prompt lists multiple PRs, do them **in order**:
  open one, stop, wait for review, then start the next. Don't stack.
- **No `Co-Authored-By: Claude`** trailer on commits or PRs.
- **Every fix/feature PR ships a regression test that fails on the pre-change code.** No exceptions.
- **Clean-checkout test hygiene:** scrub `PAW_*` env vars and redirect `PAW_CONFIG_DIR` to a temp dir
  via `tests/helpers/env.ts` for anything reading config / credentials / vault.
- **Gates before "done":** `bun test` green · `tsc` at baseline (zero *net-new* — the repo has a
  known pre-existing `trustedProxy` / Hono `c.html` TS2769 overload class; don't add to it) ·
  `bun run lint` clean on touched lines.
- **Hold the surface budget.** Don't grow kernel surface beyond what the prompt describes. Find work
  outside scope → **STOP and flag it** in the PR body rather than silently expanding.

## Verify these seams before building (known gotchas — each has bitten)

1. **Companion is a separate same-origin iframe** (served at `/companion`). It does **not** inherit
   the console document's `<html>.dark` class or DOM. It bootstraps theme from the shared
   `localStorage["paw-theme"]` (+ `storage` event + `prefers-color-scheme`), and — being same-origin —
   it **can `fetch` `/api/*` directly** (no parent→iframe channel needed). *(proven #115/#116)*
2. **`saveConfigOverrides` deep-MERGES — it cannot delete a key.** A removed key is re-merged from
   disk. Use `replaceConfigOverride` / `deleteConfigOverride` (added in #114) for any removal; only
   use `saveConfigOverrides` for additive writes. *(proven #114)*
3. **Config types live in TWO places.** Adding a config field requires updating **both** the Zod
   schema (`src/config/schema.ts`) **and** the hand-written `PawConfig` interface
   (`src/types/config.ts`), or `tsc` fails. *(PR #61)*
4. **Infra path env vars win, and `store.dbPath` is never persisted.** `PAW_DB_PATH` → `store.dbPath`
   and `PAW_CANVAS_ROOT` → `web.canvas.root` are applied *after* file config so a stale `config.json`
   can't push the DB/canvas off the Railway `/data` volume. The writer must never persist
   `store.dbPath`.
5. **Vanilla console modules are real files, never template-literal strings.** Ops + companion JS/CSS
   live as real `.js`/`.css` under `src/web/public/…`. Template-string inlining is the
   "inline-script-template-trap" (bit three sessions).
6. **A backgrounded iframe freezes CSS entrance animations at their `0%` frame.** Don't author
   keyframes that rest at `opacity:0` / `scale(0)`; rest visible and show/hide via `[hidden]`.
   *(prototype + #116)*
7. **The approval queue is channel-agnostic** (#110/#112). Resolve via `GET /api/approvals/pending`
   + `POST /api/approvals/:id/approve|deny` — the same row resolves everywhere (web modal, Slack
   Block Kit). Don't fork the approval engine; call its routes.
8. **Tool-log is singular.** Reuse the existing `kernel.tools` ToolLog; never add a second `tool_log`
   table (it collides and breaks tests). MCP tools store `plugin = "mcp:<server>"` — don't re-prefix
   to `mcp:mcp:<server>`.

> Fork note (construction-agent only): `gh pr …` resolves the wrong remote (upstream/paw) — use the
> REST API against `HBarefoot/construction-agent`. Domain code lives in new files only; shared files
> get only mount lines + the one marked `// --- ConstructAI domain ---` block.

*Borrow the parts. Win on the canvas moat.*
