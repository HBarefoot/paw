# Prompt: Paw master — finish the Slack pairing fix (stable codes + owner recognition)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**.

The `/access` admin-approval page (`feat/access-approvals-page`, defect #2) is already built — it
gives an operator a one-click way to approve a pending user. This prompt finishes the **other two**
pairing defects that page doesn't address. **Rebase this on top of `feat/access-approvals-page` once
it merges** (or branch from the updated `main`). One PR: `fix/pairing-stable-codes-owner`.

## Defect 1 — pairing code regenerates every message (the real bug)
`generatePairingCode(userId)` (`src/security/access-control.ts:68`) always does
`INSERT OR REPLACE INTO pairing_codes (...)` with a **fresh random code** — there's no
retrieve-existing branch. So every unrecognized message mints a new code and **invalidates the
previous one** (Henry saw `973309` then `318658` for two messages). The kernel comment at
`kernel.ts` ~1426 even says "Generate **or retrieve**" — make it actually retrieve.

**Fix:** in `generatePairingCode`, first `SELECT code, expires_at FROM pairing_codes WHERE user_id = ?`;
if a row exists **and is not expired**, return that existing code (don't regenerate). Only mint +
`INSERT OR REPLACE` when there's no row or it's expired. Stable within the TTL (`pairingTtlMinutes`,
default 10).

**Tests (fail on pre-fix):** calling `generatePairingCode` twice for the same user within the TTL
returns the **same** code; after expiry it returns a **new** one; `verifyPairingCode` still approves
on the current code; an expired code is rejected/cleared as today.

## Defect 3 — the owner is treated as a stranger in Slack
The operator's Slack identity isn't auto-approved anywhere (the only `owner` reference in
`access-control.ts`/`schema.ts` is the GitHub repo allowlist), so the owner gets pairing-gated in
their own workspace. Web admins are already exempt (since #129); the owner's Slack identity needs the
same recognition.

**Fix:** add an operator-set **owner allowlist** — a config field (e.g. `security.ownerUserIds` or
`slack.ownerUserIds`, channel-qualified, your call — justify the placement) of identities that are
**always approved**. Honor it in `AccessController.isUserApproved` (and/or auto-insert into
`approved_users` at init) so a listed owner is never pairing-gated. Update **both** the Zod schema
(`src/config/schema.ts`) and the `PawConfig` interface (`src/types/config.ts`) — `_CONVENTIONS.md`
seam #3. The `/access` page remains the manual fallback for anyone not pre-listed.

**Tests (fail on pre-fix):** a user id in the owner allowlist is approved by `isUserApproved` with no
`approved_users` row and never triggers pairing; a non-listed user still goes through pairing; empty
allowlist = today's behavior (no regression).

## Out of scope (flag, don't build)
- The `github.*` audit-label wart on Vercel/canvas gated actions (the approval queue is GitHub-named
  but now multi-purpose) — separate cleanup PR.
- Any rework of the pairing security model itself (self-entry vs admin-approve) — the two fixes
  above are the whole job here.

> One PR off `main` (after the `/access` branch lands): `fix/pairing-stable-codes-owner`. Both fixes
> are small and contained — don't grow the surface.
