# Paw ← Hermes: Feature Borrow Plan

**Date:** June 13, 2026
**Rule:** Borrow what's cheap and strengthens the core. Verified each gap against the Paw codebase before listing it. Ranked by ROI (value ÷ effort), tiered so you can fire the quick wins immediately.

All gaps below were **confirmed absent in `src/`** (not assumed): no `cache_control`, no general provider fallback (only vision-error degrade in `router.ts`), no conversation compression, no hook layer, no workspace checkpoint/rollback, no OpenAI-compatible endpoint, no credential pools.

---

## Status (updated 2026-06-14)

- **Tier 1 — DONE.** B1 prompt caching (**#107**), B3 provider fallback (**#108**), B2
  `execute_code` (**#109**) are all merged to `main`.
- **Command approval (Hermes parity) — DONE, better fit.** The approval-surfaces work
  (**#110**) effectively delivered the Tier-2 "confirm/deny risky actions" security item, built
  as **per-channel / origin-aware approvals** (Slack Block Kit ↔ web modal, resolving the same
  row everywhere) rather than a single global queue. See `docs/prompts/PROMPT-paw-approval-surfaces.md`.
- **In flight:** B5 plugin/event hooks (the general guardrail/metrics layer); B7 OpenAI-compatible API.
- B4, B6, B8, B9 remain as written below.

---

## TIER 1 — Fire now (quick, high ROI) — ✅ DONE

### B1 — Prompt caching ⭐ THE quickest win — ✅ DONE (#107)
**Hermes:** always-on 1-hour Claude prefix cache (Anthropic / OpenRouter / Portal), zero config.
**Paw today:** none — the full system prompt + tool schemas + history are re-sent and re-billed every turn. Paw's system prompt is large and Slack threads are long, so this is pure waste.
**Win:** large input-token cost + latency reduction on every Claude turn, especially the orchestrator's long system prompt. Effort: **low** (add `cache_control` breakpoints in the Claude provider). Prompt → Appendix A.

### B2 — `execute_code` tool ⭐ fixes observed flailing — ✅ DONE (#109)
**Hermes:** `execute_code` writes a script that calls agent tools programmatically via sandboxed RPC, collapsing multi-step workflows into one LLM turn.
**Paw today:** `exec_command` only — one call at a time, no shell operators, no curl/git. Production logs show dozens of wasted calls chaining `;`/`|` and retrying.
**Win:** fewer inference turns (perf + cost), and it ends the shell-flailing error class. Effort: **medium**. Prompt already in `PAW-vs-HERMES-strategy.md` Appendix A.

### B3 — Fallback providers ⭐ resilience for the Ollama-default stack — ✅ DONE (#108)
**Hermes:** automatic failover to a backup LLM on error, with independent fallback for vision/compression.
**Paw today:** only a *vision* error degrades to default (`router.ts`). The **default provider is Ollama (local, fragile)** — if it hiccups, the turn dies. No general failover.
**Win:** the agent keeps working when the primary errors/times out — directly relevant because your default is a local model. Effort: **medium**. Prompt → Appendix B.

---

## TIER 2 — Near-term (safety & observability)

### B4 — Checkpoints & rollback
**Hermes:** auto-snapshots the working dir before file changes; `/rollback` restores.
**Paw today:** canvas has per-file version history (B1-era) + agent snapshots, but **no general workspace checkpoint/rollback**.
**Win:** safety net when the agent edits real files (the fork's domain code, client sites). Effort: medium. Generalize the canvas-version pattern to a workspace snapshot keyed per task.

### B5 — Plugin/event hooks (guardrails + metrics)
**Hermes:** lifecycle hooks — gateway hooks (logging/alerts/webhooks) and plugin hooks (tool interception, metrics, **guardrails**).
**Paw today:** sandbox permission checks at execute time, but no general pre/post-tool hook layer for guardrails or metrics.
**Win:** a clean place to enforce policy (block/confirm risky tool calls beyond the GitHub approval queue), emit metrics, and feed Agent Ops — without editing the kernel per concern. Foundational. Effort: medium.

### B6 — Credential pools
**Hermes:** multiple keys per provider, auto-rotate on rate-limit/failure.
**Paw today:** single key per provider.
**Win:** resilience + throughput once usage scales (and ConstructAI multi-client). Effort: low-medium. Lower urgency until volume justifies it.

---

## TIER 3 — Strategic (versatility unlocks)

### B7 — OpenAI-compatible API server
**Hermes:** exposes the agent as an OpenAI-format HTTP endpoint; any frontend (Open WebUI, LibreChat…) can drive it.
**Paw today:** Slack + its own web UI only — no programmatic agent endpoint.
**Win:** turns Paw into something **other apps call** — ConstructAI (or a client's app) could invoke the agent programmatically; third-party frontends attach for free. Real versatility/leverage unlock. Effort: medium. Worth scoping deliberately, not rushed.

### B8 — Selective learning loop + agentskills.io
Covered in `PAW-vs-HERMES-strategy.md` (Long-term #2/#3): post-task reflection → memory nudge, skill self-improvement, and emitting the open skill format from `skill_scaffold`. The one genuinely differentiating borrow; do it as a deliberate effort, not a quick win.

### B9 — Context references (`@file`, `@url`, `@gitdiff`)
Inline expansion of files/URLs/diffs into a message. Nice ergonomics for the chat/Command-AI surface; medium value, low urgency.

---

## Suggested firing order

1. **B1 prompt caching** — today; biggest cost/latency cut for least work.
2. **B2 execute_code** — next; kills the shell-flailing error class.
3. **B3 fallback providers** — resilience for the local-default stack.
4. Then B5 hooks → B4 checkpoints (safety layer), B7 API server when you want the versatility unlock, B8 as the strategic differentiator.

Each is a single unstacked PR off `main`, usual gates, no `Co-Authored-By`. B1–B3 are independent (different files) and could even run in parallel.

---

## Appendix A — Prompt: Prompt caching (paw)

> You're in the **paw** repo (`~/repos-and-projects/paw`). Read `CLAUDE.md`. Add Anthropic prompt caching to the Claude provider — Paw re-sends the full system prompt + tool schemas every turn and pays for it; caching the stable prefix is a large, cheap win. One PR, `feat/prompt-caching`.
>
> In `src/ai/provider.ts` (Claude), add `cache_control: { type: "ephemeral" }` breakpoints on the stable prefix: the system prompt block and the tool definitions (the last tool / end of the tools array), and optionally the last stable turn of history. Gate behind a config flag `ai.promptCache` (default ON for Claude; no-op for Ollama/OpenAI/Gemini paths). Emit cache hit/miss token counts into CostTracker so Agent Ops can show savings. Verify the Anthropic SDK version in use supports it; if a beta header is needed, add it. Tests: request payload carries cache_control on the system + tools blocks when enabled; disabled flag → byte-identical to today; non-Claude providers unaffected. Usual gates; no `Co-Authored-By`.

## Appendix B — Prompt: Fallback providers (paw)

> You're in the **paw** repo. Read `CLAUDE.md`. Generalize provider failover beyond the existing vision-only degrade in `src/ai/router.ts`. Paw's default provider is often Ollama (local, can error/timeout) — a primary failure currently kills the turn. One PR, `feat/provider-fallback`.
>
> Add config `ai.fallback`: an ordered list of `{provider, model}` to try when the primary errors (network/timeout/5xx/quota — NOT user-level refusals or tool errors). On primary failure, transparently retry the same turn on the next fallback, preserving history; tag the turn in CostTracker with the provider actually used; surface a one-line note to the user that fallback was used (mirror the existing vision-fallback note pattern). Independent fallback entries allowed for the main chat vs auxiliary tasks (vision/summarization) so they can differ. Never silently drop a message. Tests (mock providers): primary error → fallback succeeds and the reply returns; all fallbacks fail → clean surfaced error, message not lost; user-refusal/tool-error does NOT trigger fallback; cost tagged with the real provider. Usual gates; no `Co-Authored-By`.

---

*Borrow the parts. Win on the canvas moat.*
