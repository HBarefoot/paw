# Prompt: Paw — validate the Vercel publish chain against ONE real page

You're in the **paw** repo. This is a **test run, not a build** — the Vercel integration already ships
(#141/#142/#143). Goal: prove the chain *static page → GitHub repo → live Vercel URL* works
**reliably**, and produce the **failure-mode map**. This is the gate before any Vercel Phase 2 work.

## Operator prerequisites (Henry — do these once before handing off)
1. **Vercel account** (free) → create an **API token**: Vercel → Settings → Tokens. (Note your
   `teamId`/slug if the target is under a team, not your personal scope.)
2. **Connect the Vercel↔GitHub app once** in the Vercel dashboard (this is the unavoidable one-time
   step — repo linking via the API fails without it).
3. In paw: store the token in **`/vault`** (`vercel.token` slot), set **`vercel.enabled`** (+ `teamId`
   if needed), restart if required.
4. **Allowlist the target GitHub repo** in paw's GitHub allowlist.
5. **Pick the page.** A throwaway is fine for the first run — a simple one-file landing page.

## The run (agent, paw session)
1. Take/generate a **real static page** (`index.html` + any CSS/JS) — keep it simple.
2. Create a **new GitHub repo** and commit the page (existing GitHub integration).
3. Trigger **`vercel_create_project`** linked to that repo → **approve the queued action** at the
   approval surface (these are gated).
4. Poll **`vercel_deploy_status`** until `READY` → capture the **live URL**.
5. **Open the URL**, confirm the page actually renders (not just "a URL came back").
6. **Idempotency check:** re-run `vercel_create_project` for the same name → confirm it returns/updates
   rather than duplicating.
7. **(Bonus) If `posthog.enabled`:** confirm the published HTML carries the PostHog snippet — that
   validates #148 in the same shot.

## Deliverable — the failure-mode map (this is the point)
Report back, per step: what worked, what errored, and how each failure surfaced —
- build failure · rate limit (429) · partial/half-created state · revoked/expired token (401) ·
  the **Vercel↔GitHub-not-connected** case · domain attach · timeouts · re-run/idempotency behavior.

## Success criteria
A real page is **live at a Vercel URL, reproducibly**, and the failure modes are documented. End with
a clear **go / no-go on reliability**: is this chain boring enough to build Phase 2 on, or does
something need hardening first?

No PR — this is an execution + written report (drop the failure-mode map in a doc or the session
summary). If you hit a code bug along the way, flag it for its own fix PR rather than patching inline.
