# Prompt: Paw master — CRITICAL: access control silently fails OPEN (anyone can command the agent)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`.**
**This is a security regression — treat it as high priority.** One PR: `fix/access-fail-closed`.

## The bug (verified in prod + code)
On the deployed instance, `/access` shows **0 approved / 0 pending**, yet **any Slack user gets a full
response from the agent with no approval** — the access gate is completely off. Mechanism:
- `security.requireApproval` **defaults to `false`** (`src/config/defaults.ts:66`,
  `src/config/schema.ts:109`).
- The `AccessController` is **only instantiated when `requireApproval` is true**
  (`src/kernel/kernel.ts:293` — `if (config.security.requireApproval) { this.accessController = … }`).
- The inbound gate **skips the access check entirely when `accessController` is null**
  (`src/kernel/inbound-gate.ts:63-69` — `accessController && !isUserApproved(...)`).

**Net: whenever `requireApproval` is false (the default, or after a redeploy that loses the config
override — the same ephemeral-config issue as the DB-wipe), there is NO access control at all and the
agent answers EVERYONE on every external channel (Slack), silently.** The only visible symptom is
`/access` reading 0/0 — with no indication the gate is disabled. For an agent with GitHub write,
Vercel, Supabase, and vault secrets, that's a real exposure.

## Fix — fail CLOSED, make it durable, make it loud

### 1. External channels must fail CLOSED (the core fix)
Misconfiguration or config-loss must NEVER silently expose the agent to unrecognized **external**
users. In `inbound-gate.ts`, an inbound turn that is **not access-exempt** (not internal, not an
authenticated web session) and comes from an **external channel** (e.g. Slack) must be **DENIED when
there is no controller OR the user isn't approved** — i.e. treat "no controller configured" as
**deny external**, not allow:
```
if (!isAccessExempt(msg, isInternal)) {
  if (!accessController || !accessController.isUserApproved(msg.user.id, msg.channel))
    return { ok: false, reason: "access_denied" };
}
```
Authenticated web sessions (`msg.authenticated === true`) and internal channels stay exempt exactly as
today — this does NOT force approval config on the web admin. If a genuinely open external deployment
is ever wanted, gate it behind an **explicit, default-off** opt-in (e.g. `security.allowUnapproved
External: false`) — never the *absence* of config. Decide the exact shape and justify it; the
invariant is: **an unrecognized Slack user with no approval can never command the agent unless the
operator explicitly opted into open access.**

> Note: this means the controller (or the deny path) must run even when `requireApproval` is false.
> Either always construct the controller and let the flags govern enforcement, or have the gate deny
> external turns when the controller is absent. Don't gate the *existence* of any access decision on
> `requireApproval`.

### 2. Durable security posture
`requireApproval` / `ownerUserIds` / `allowedUsers` must survive redeploys. This is the same
ephemeral-config root as the DB-wipe (`docs/prompts/PROMPT-paw-access-durability.md`): if
`PAW_CONFIG_DIR`/`config.json` isn't on the persistent volume, security config reverts to defaults on
redeploy → the agent silently opens up. Ensure the config persists on the volume (mirror the
`store.dbPath`/`PAW_DB_PATH` volume handling), and confirm the #154 Persist-to-config write
(`replaceConfigOverride("security.allowedUsers", …)`) preserves `requireApproval` and the other
`security.*` keys (doesn't drop them).

### 3. Make "access control is OFF" loud (not a silent 0/0)
- **Boot:** log a clear `WARN` when access control is not enforcing while an **external** channel
  (Slack) is enabled — e.g. "⚠ Access control is OFF and Slack is enabled — the agent will respond to
  any user." (Today it logs "Access control active" only when on; add the OFF warning.)
- **/access page:** when the gate isn't enforcing, show a prominent banner — "⚠ Access control is OFF
  — anyone can talk to the agent. Enable `requireApproval` / set owners." — instead of a silent
  "0 approved / 0 pending."

## Tests (must fail on pre-fix code)
- With `requireApproval: false` (no controller) and Slack enabled, an unrecognized **Slack** user is
  **DENIED** (access_denied), not answered. (This is the core regression — it FAILS today.)
- An **authenticated web** turn and **internal** channels (cron/heartbeat/github/api) are still
  exempt (not denied).
- An unrecognized Slack user is denied even with an empty `approved_users` table + no `allowedUsers`.
- An owner in `ownerUserIds` / a user in `allowedUsers` passes with no DB row.
- Boot emits the OFF warning when access isn't enforcing + Slack enabled; `/access` surfaces the OFF
  state.
- The Persist-to-config write preserves `requireApproval` and other `security.*` keys.

## Operator note (Henry, immediate — independent of the PR)
Set `security.requireApproval: true` AND `security.ownerUserIds: ["U03H65TPZ1N"]`, restart. Re-enables
the gate and keeps you recognized. (Won't survive a redeploy until the durability part lands.)

> Security fix → land fast and merge down to the construction-agent fork (same kernel, same exposure).
