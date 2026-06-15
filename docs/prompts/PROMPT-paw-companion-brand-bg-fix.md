# Prompt: Paw master — stop the companion injecting the brand background (light-mode unreadability)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`.**
One small PR: `fix/companion-brand-bg`.

## The bug (verified live on prod, root-caused)
The companion is unreadable in **light** mode: light-mode dark text renders on a **black** stage. The
`companion/styles.css` theming is correct (`:root --bg:#ffffff`, `html.dark --bg:#050807`) — but it's
being **overridden at runtime**. Verified on prod: the companion `<html>` carries an **inline style**
`--accent: #3fe08f; --bg: #000000;`, and inline styles beat the stylesheet, so `--bg` is forced to
black in **both** modes (the active Barefoot brand's `bg` color is `#000000`).

Source:
- `src/web/app.ts` (`/companion` route, ~line 2104) passes `cfg.bg = pal?.bg` — the **active brand's
  background color** — into the companion config.
- `src/web/public/companion/shell.js:614`: `if (cfg.bg) docEl.style.setProperty("--bg", cfg.bg);`
  applies it as an inline `--bg` on `<html>`, clobbering the theme-aware `:root`/`html.dark` rules.

This is the exact "brand neutrals freeze the theme" mistake already fixed in `src/store/brands.ts`
(brand contributes **accent + fonts only**; the design system owns light/dark neutrals) — just
repeated in the companion.

## Fix
- **Remove `shell.js:614`** (the `--bg` inline injection). Keep line 613 (`--accent`) — the brand
  accent is theme-independent and correct.
- **Drop `bg: pal?.bg` from the `cfg` object** in `app.ts` (~2104) so the now-unused field isn't
  passed. (Grep for any other `cfg.bg` reader first; remove cleanly.)
- Result: `styles.css` owns `--bg` per theme — light ground in light mode, dark ground under
  `html.dark` — and the companion is legible in both. `--accent` (emerald) still applies.

## Tests (fail on pre-fix)
- The companion never sets an inline `--bg` on `<html>`/`docEl` (assert the injection is gone).
- Token-level: with light mode active (no `.dark`), the companion's resolved `--bg` is the light
  value (`#ffffff`), not `#000000`; under `html.dark` it's the dark value — extend the existing
  `companion-theme.test.ts`.
- `--accent` is still injected from the brand.

## Note
This corrects the #146 conclusion that the light-bg was "already fixed, redeploy if black" — the
stylesheet was fixed, but `shell.js:614` re-introduced the black background via the inline brand
injection. Redeploy alone does not fix it; removing the injection does. **Needs a real-browser
eyeball** (companion legible in light + dark) — flag in the PR.
