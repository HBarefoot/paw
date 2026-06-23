# Note: run-verdict (#182) Phase-1 tuning items

Two known limitations of the Phase-1 phantom-success detector (`src/observability/run-verdict.ts`),
surfaced during review of #182. Both are **by design for Phase 1** (deterministic, advisory) — captured
so they're not lost. Not urgent; the `/runs` board is a smoke detector, not proof.

## 1. `success_claim_no_write` is binary — misses the "lesser write" case
The flag fires only when a completion claim coincides with **zero** successful mutating tool calls. It
does **not** catch *"claimed a big action but only did a small write."*

Motivating case: a lead cron that **claims** to have created a CRM record but really only ran
`supabase_update` to mark the lead `seen`. Because `supabase_update` matches the mutating stem
(`update`/`mark`), `successfulMutations !== 0`, so the phantom flag never fires — even though the
*claimed* work (the CRM write) never happened.

- Real backstop for the lead pipeline today: the ledger task checks (`task_left_open` /
  `task_done_without_evidence`) — another reason to wrap autonomous work in a task.
- Proper fix is the **LLM-judge / per-tool semantic success** phase (already named out-of-scope for
  Phase 1): "did the *specific entity the claim named* actually get written," not just "did any write
  happen."

## 2. `MUTATING_TOOL_RE` over-matches `post` → `posthog_*`
`MUTATING_TOOL_RE = /(create|update|delete|write|send|post|upsert|insert|merge|mark|move)/i` matches
`post` inside `posthog_*`, which are **read** tools. A run that only called PostHog reads is counted as
having a write, which *suppresses* `success_claim_no_write`. Tighten the stems (anchor, or exclude
`posthog`) so reads don't read as mutations.

Both dials live as the two regexes in `run-verdict.ts`. Revisit when the LLM-judge phase lands, or
sooner if false-negatives show up on real runs.
