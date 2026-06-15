# Prompt: Paw master — companion light-mode background fix + smooth avatar zoom

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**
(note the companion same-origin-iframe seam + the backgrounded-iframe animation-freeze). Two
contained companion fixes, **one PR**: `fix/companion-lightbg-and-zoom`. Both live in
`src/web/public/companion/`.

## Fix A — companion is unreadable in light mode (real bug, gap in #115)

**Verified on prod (`/chat` → Home companion iframe):** in **light** mode the companion iframe is
correctly in light mode (its `localStorage["paw-theme"]="light"`, `<html>` has no `.dark`) and its
**foreground** tokens flip to light-mode values — `--text: #0f1f19` (dark text), pill border
`#3fe08f` (emerald). **But `--bg` stayed `#000000` and the body/stage background stayed black.** So
you get **dark text on a black stage** → unreadable skill pills and a washed-out "Hi — I'm …"
greeting.

**Root cause:** the light-mode override in `companion/styles.css` flips the text/pill/stroke tokens
but **omits `--bg` (and the stage/body background)** — they're left at the dark `#000000` value.

**Fix:** include `--bg` **and the body/stage background** in the companion's light-mode override so
light mode is a **light ground with dark text** (and dark mode stays a dark ground with light text —
unchanged). Use a light value consistent with the design system's light surface (≈ `#f4f7f5` / white)
so it sits naturally inside the light console. Keep `--accent` emerald-driven. Confirm the **avatar
art reads on the light ground** in light mode — the gel sphere was already verified to read on white
(#115), but **check the robot faces (Halo/Visor/Cylon/LCD from #128) on the light ground** and adjust
their glow/shadow alphas per mode if they wash out.

**Verify (and add a token-level test):** in light mode `--bg` resolves to the light value and pill
text / greeting clear **WCAG AA** against it; in dark mode the palette is byte-unchanged from today.

## Fix B — avatar zoom on skill/agent count change isn't smooth

The companion rescales the stage/avatar as the skill + sub-agent count changes (the density tiers +
fit-scale in `shell.js`), and the size change **jumps** instead of animating.

**Fix:** add a smooth CSS transition to the element whose **scale changes on count change** (the
fit/stage wrapper that rescales to fit the dock) — e.g. `transition: transform 220–260ms
ease`.

**Critical — don't break the breathing animation:** the orb's per-frame breathing / pop / tremor
transform is driven by JS each rAF frame in `stepFace` (`f.sphere.style.transform = translate(...)
scale(...)`). **Do NOT put a CSS transition on that per-frame transform** — it would fight the rAF
loop and stutter. Identify the **discrete** layout/fit rescale (the one that only changes when
skills/agents are added/removed) and transition **that** element, not the animated orb. Respect
`prefers-reduced-motion` (snap, no transition).

**Verify:** adding/removing a skill (or a sub-agent appearing/finishing) animates the resize
smoothly; the orb's breathing is unaffected; reduced-motion snaps instantly.

## Out of scope (flag, don't build)
The avatar renderers themselves; the picker; any non-companion page; fork (ConstructAI) UI.

> One PR off `main`. Both changes are small + CSS-centric (Fix B may touch a line of `shell.js` to
> tag the right element). Keep CSS in a clearly-marked block. **Both need a real-browser eyeball** —
> companion legible in light + dark, zoom smooth — call that out in the PR since it can't be verified
> headless.
