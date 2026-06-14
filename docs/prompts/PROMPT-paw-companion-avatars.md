# Prompt: Paw master — selectable companion avatars

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**
(standing rules + integration seams — note the companion same-origin-iframe seam and the
backgrounded-iframe animation-freeze). Task detail only below.

**Goal:** let users **pick between different companion avatars** (the current gel sphere + at least
one alternative, e.g. a robotic face), with the choice persisted and live-applied. Do the
abstraction **once** so new avatars are cheap; the value is the framework, not the art. Two
sequential PRs off `main`.

## What exists (verified — build the abstraction around this, don't fight it)

The companion is vanilla JS in `src/web/public/companion/`. The avatar is currently a **single
hardcoded gel sphere**, but the behavior is already cleanly separated from the art:

- **`expression.js`** — a **pure, avatar-agnostic** state machine: `resolve(snapshot, machine, now)`
  returns which expression to wear (idle / thinking / working / speaking / reactions), plus
  `note()` and `shouldPop()`. **This is the contract every avatar consumes. Don't touch it.**
- **`shell.js`** — the gel-sphere **renderer**, already factored as the exact pair an avatar needs:
  - `buildFace(...)` (~84) builds one face's DOM (sphere, SVG eyes/mouth, tint/gloss/spark) and
    caches per-instance state on `node._face`. Used for the **main avatar AND each sub-agent**.
  - `stepFace(node, expr, now, opts)` (~162) drives that face every rAF frame (breathing, pop,
    tremor, mouth morph / TTS lip-flap, eye look-toward).
  - `buildAvatar(themeKey)` (~364) mounts the main avatar; the sphere carries `data-avatar`.
- There are already **gel-sphere "theme presets"** (color-stop variants, ~26). **Clarify the
  layering:** an *avatar* is a face **type** (gel sphere vs robot); a *preset* is a color variant
  *within* an avatar. The picker selects the avatar; presets stay a per-avatar detail.
- Theme bootstrap precedent (#115): `/companion` reads the shared `localStorage` before first paint
  and live-syncs via the `storage` event. **Mirror this exact pattern** for avatar selection.

## PR 1 — Avatar-renderer registry + port the gel sphere  ·  `feat/companion-avatar-registry`

Pure refactor, **zero visible change** — this is the safe foundation.

- Define an **avatar-renderer contract**: `{ key, label, build(opts) -> node (with _face), step(node, expr, now, opts) }`.
  This is literally the shape `buildFace`/`stepFace` already have.
- Add a **registry** (`avatarKey -> renderer`) and route `buildAvatar` **and the sub-agent face
  builder** through it, selected by the active avatar key (default = the gel sphere).
- **Port the existing gel sphere** into the registry as the first registered avatar, unchanged. The
  engine, `expression.js`, mouth-sync, look-toward, springs, reduced-motion, `--accent` tinting, and
  light/dark (#115) all keep working **identically**.
- **Tests:** the registry resolves the default key to the gel-sphere renderer; an unknown key falls
  back to the default; with the default selected, the built DOM + `stepFace` behavior is equivalent
  to pre-refactor (snapshot the structure / key state); sub-agent faces use the registry too.

## PR 2 — Picker, persistence, and a second avatar  ·  `feat/companion-avatar-picker`

- **Add one alternative avatar** (e.g. a robotic face) as a registered renderer: its own art +
  a thin adapter mapping the **engine's existing expression states** to its visuals. It must **not**
  re-implement look-toward / mouth-sync / springs — those stay central. It must honor `--accent`,
  pass **light/dark** (#115), and respect **reduced-motion**. Heed the backgrounded-iframe freeze:
  don't author entrance keyframes that rest at `opacity:0`/`scale(0)`.
- **Persistence + live apply:** store the choice in `localStorage` (e.g. `paw-avatar`); `/companion`
  reads it before first paint and live-swaps the renderer on the `storage` event — **same mechanism
  as the #115 theme bootstrap** (no full reload, no flash).
- **Picker UI:** a selector in **Settings → AI Preferences** (and optionally a quick-switch on the
  companion). Selecting writes `paw-avatar`; the open companion swaps live.
- **Brand default (optional, recommended):** an optional `companion.avatar` (or brand) config field
  for the default avatar, so a deployment / ConstructAI tenant can pin one; the per-user
  `localStorage` choice overrides it. If you add a config field, update **both** the Zod schema and
  the `PawConfig` interface (see `_CONVENTIONS.md` seam #3).
- **Tests:** selecting an avatar persists it and swaps the live renderer via the storage event;
  reload restores the choice; switching back and forth doesn't leak DOM/listeners; the new avatar
  passes light/dark + reduced-motion + `--accent`; brand default applies when no `localStorage`
  choice is set and is overridden when one is.

## Decisions (settle in the PR, documented)
- **Per-user vs brand-level:** default to **per-user (`localStorage`) with a brand default** — the
  per-user choice wins.
- **Fixed set vs brand-extensible:** ship a **fixed built-in set** now, but shape the registry so
  brand-supplied avatars are possible later. Do **not** build avatar upload/extensibility in this PR.

## Out of scope (flag, don't build)
Changes to `expression.js` / the engine state machine; brand-supplied/custom-uploaded avatars;
animation/personality reworks beyond wiring states to the new face; fork (ConstructAI) UI.

> Sequencing: independent of the canvas/domain prompts, but it edits `companion/shell.js` +
> `styles.css`. The companion light-theme (#115) and inbox/approvals (#116) PRs are already merged,
> so the path is clear — just keep CSS additions in a marked block.
