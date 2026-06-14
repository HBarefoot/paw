# Prompt: MCP removal fix + remaining Hermes borrows (B4, B8; B6/B9 parked)

You're in the **paw** repo (`~/repos-and-projects/paw`). Read `CLAUDE.md` first, and
`docs/strategy/PAW-HERMES-BORROW-PLAN.md` for the borrow context.

This prompt sequences **three** PRs (then two parked items). Do them **in order**, each as a
**single unstacked PR off `main`**. After each PR: stop, report, and wait for review before
starting the next — do not stack.

## Ground rules

**Follow `docs/prompts/_CONVENTIONS.md`** (standing rules + known integration seams) for every PR
here — branch+PR discipline, no `Co-Authored-By`, regression-test-fails-first, clean-checkout test
hygiene, gates, and the surface-budget rule all live there. This prompt only adds task-specific
detail below.

---

## PR 1 — Fix removed MCP servers coming back  ·  `fix/mcp-server-removal`

### The bug (already root-caused — verify, then fix)

Two compounding defects make removed MCP servers reappear:

**Bug A — delete-by-merge can never delete.**
`DELETE /api/mcp/servers/:name` (`src/web/app.ts` ~line 4410) disconnects the live server, reads
config overrides, `delete mcpServers[name]`, then calls `saveConfigOverrides(existing)`. But
`saveConfigOverrides` (`src/config/writer.ts:61`) does
`deepMergeOverrides(readConfigOverrides(), overrides)` before writing. A deep merge **unions**
keys, so the just-removed key is re-merged back in from the on-disk copy and survives the write.
**Removal is silently undone on persist.** The same trap applies to any code path trying to
*remove* an override key via `saveConfigOverrides` (audit the other callers — `~1179`, `~1756`,
`~3172`, the import-replace at `~4147`).

**Bug B — case-variant duplicates.**
MCP server names are stored verbatim and not normalized, so `HubSpot`, `hubSpot`, and `hubspot`
exist as three distinct keys. Each `Remove` only deletes one casing, so the user must remove the
same server several times — and Bug A then resurrects whichever they did remove.

### What to build

1. **A persistence path that honors removals.** Pick the cleaner of:
   - a new `replaceConfigOverrides(path, value)` (or `deleteConfigOverride(path)`) in
     `src/config/writer.ts` that writes the targeted subtree **wholesale** (replace, not merge),
     **or**
   - a delete sentinel (e.g. `__delete: true`) that `deepMergeOverrides` interprets as "remove
     this key" so existing callers can express deletions.

   Whichever you choose, keep the existing infra-path guards intact (the writer must still never
   persist `store.dbPath`, per the comment at `writer.ts:67`). Wire the MCP delete handler and the
   MCP import-replace handler to use it.

2. **Case-insensitive name handling on add + import.** Normalize MCP server names (decide and
   document the rule — lowercase the key, preserve a display name if needed) and dedupe so a
   re-add of a differently-cased name **updates the existing entry** instead of forking a new one.
   Apply to `POST` add (`~4077`) and the import handler (`~4112`–`4165`).

3. **One-time cleanup** to collapse already-persisted case-duplicate entries (e.g. the
   `HubSpot/hubSpot/hubspot` trio) into a single canonical key on next load or via a small
   migration. Make it idempotent and safe if no dupes exist.

### Tests (must fail on pre-fix code)

- `DELETE` a server → it is **absent** from the persisted `config.json` after `saveConfigOverrides`,
  and a fresh `readConfigOverrides()` does not return it (proves Bug A fixed).
- Simulate reboot (re-read config) → removed server stays gone.
- Adding/importing a server whose name differs only in case **updates** the existing entry; the map
  never holds two case-variants of the same name (proves Bug B fixed).
- Cleanup collapses a pre-seeded `HubSpot/hubSpot/hubspot` trio to one entry; no-op when there are
  no dupes.
- Regression guard for the writer: a `saveConfigOverrides` call expressing a removal actually
  removes the key (whichever mechanism you chose), while unrelated keys are preserved and
  `store.dbPath` is still stripped.

This is a paw kernel/web fix → lands upstream, then merges down to the construction-agent fork.

---

## PR 2 — Workspace checkpoints & rollback (Hermes B4)  ·  `feat/workspace-checkpoints`

Tier-2 safety net. Completes the safety layer now that B5 hooks (#112) landed.

**Today:** canvas has per-file version history + agent snapshots, but there is **no general
workspace checkpoint/rollback** for real file edits (the fork's domain code, client sites).

**Build:** generalize the existing canvas-version pattern into a **workspace snapshot keyed per
task**. Auto-snapshot the working dir before file-mutating tool calls; expose a `/rollback`
(restore last/Nth snapshot for the task). Prefer hooking the new B5 pre-tool hook layer for the
"snapshot before mutation" trigger rather than editing tool internals per concern — that's exactly
the seam B5 created. Keep snapshots scoped per task so one task's rollback can't clobber another's.
Decide and document retention (how many snapshots, when pruned).

**Tests:** snapshot taken before a file-mutating tool call; `/rollback` restores prior bytes
exactly; snapshots are task-scoped (rollback in task A doesn't touch task B); retention/prune
behaves; no snapshot taken for read-only tool calls. Effort: medium.

---

## PR 3 — Selective learning loop + agentskills.io (Hermes B8)  ·  `feat/learning-loop`

Tier-3, the one genuinely differentiating borrow. Treat as a **deliberate effort, not a quick
win** — scope it explicitly before coding, and surface the design for review before building wide.

**Build (per `PAW-HERMES-BORROW-PLAN.md` B8 and the Long-term notes in
`PAW-vs-HERMES-strategy.md`):**
- Post-task reflection → memory nudge (feed durable lessons into the existing memory/auto-extract
  path; don't bolt on a parallel store).
- Skill self-improvement loop.
- Emit the open skill format from `skill_scaffold` (agentskills.io-compatible).

Because this touches memory and skills, **propose the design (data flow, where reflection runs,
what gets persisted, opt-in/cost controls) and pause for sign-off** before implementing. Tests to
be defined with the design; at minimum: reflection runs post-task without blocking the turn,
persisted lessons are retrievable, skill emission produces a valid open-format artifact.

---

## Parked (do NOT build now — listed for context)

- **B6 — Credential pools** (`feat/credential-pools`): multiple keys per provider, auto-rotate on
  rate-limit/failure. Low urgency until volume or ConstructAI multi-client justifies it. Revisit
  only when actually hitting provider limits.
- **B9 — Context references** (`feat/context-refs`): inline `@file` / `@url` / `@gitdiff`
  expansion in the chat/Command-AI surface. Ergonomics polish; medium value, low urgency.

---

## Housekeeping (fold in where natural, or a tiny separate PR)

- Update `docs/strategy/PAW-HERMES-BORROW-PLAN.md` status block: **B5 (#112) and B7 (#113) are now
  merged**, not "in flight." After PR 1/PR 2 land, tick those too.
- Note the smoke-test finding for later: `supabase_create_table` does **not** honor requested
  column types (a requested `int8` id came out `uuid`, and it first rejected `id` as reserved). If
  schema fidelity matters, fix the tool to honor the declared type or surface the coercion
  explicitly — separate PR, not part of this sequence.

*Borrow the parts. Win on the canvas moat.*
