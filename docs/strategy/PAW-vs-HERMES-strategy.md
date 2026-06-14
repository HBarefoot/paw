# Paw vs. Hermes Agent — Strategic Assessment

**Date:** June 13, 2026
**Author:** Strategy review (Claude, for Henry Barefoot)
**Subjects:** Paw (this repo) + ConstructAI (the `construction-agent` fork) vs. [Hermes Agent](https://hermes-agent.nousresearch.com/docs) by Nous Research

---

## TL;DR

These are not competitors — they are different bets, and conflating them leads to the wrong roadmap.

- **Hermes** is a horizontal, open-source (MIT) autonomous-agent platform from a funded research lab. Its bet is breadth + a self-improving learning loop, deployable anywhere, reachable from everywhere.
- **Paw** is a personal kernel that has been productized into a vertical SaaS (**ConstructAI**). Its bet is a unique *web-app-building* capability (canvas / app-spaces + a fenced database backend) wrapped in a white-label kernel.

**The right way to use Hermes is as a parts catalog, not a finish line.** Borrow what's cheap; deepen the moat Hermes doesn't contest. Do **not** enter a breadth race against a research lab.

---

## Side-by-side

| Dimension | Hermes Agent | Paw / ConstructAI |
|---|---|---|
| **Origin** | Nous Research (lab; Hermes/Nomos/Psyche models) | Solo-built kernel, productized into ConstructAI |
| **License / model** | MIT, open-source, community Skills Hub | Private kernel + white-label fork |
| **Core thesis** | Self-improving general agent, runs anywhere | Agent that builds & serves live web apps w/ real backends |
| **Learning loop** | ✅ skill self-improvement during use, memory nudges, Honcho user-modeling | Partial — skill *creation* (scaffold) + hybrid vector/FTS memory + auto-extract; **no** self-improvement or nudge loop |
| **Memory** | FTS5 + LLM summarization, agent-curated | sqlite-vec + FTS5 hybrid, auto-extract |
| **Skills** | Open standard (agentskills.io), portable, self-improving | On-demand activation; `skill_scaffold` generates inert plugins |
| **Tools** | 70+ across 28 toolsets | ~30 built-in + integrations (GitHub, Strapi, HubSpot, Supabase, WordPress) |
| **Code execution** | ✅ `execute_code` — programmatic tool calling, pipelines in one inference | ❌ `exec_command` only, one call at a time, no shell operators |
| **Messaging reach** | 20+ platforms (Telegram, Discord, Slack, WhatsApp, Signal, Teams, …) | Slack + web UI |
| **Deployment** | 6 backends incl. serverless Daytona/Modal (idle≈free) | Single deploy (Railway), Bun + Hono |
| **Providers** | 18+ (Nous Portal, OpenRouter, OpenAI, any endpoint) | Claude/OpenAI/Ollama/Gemini + vision routing |
| **Web app generation** | ❌ browser/search tools only | ✅ **canvas / app-spaces** — build, serve, wire forms, fenced Supabase backend |
| **Productization** | One configurable agent | ✅ White-label kernel → branded vertical product |
| **Visual UX** | CLI / chat observable | ✅ Companion avatar + Agent Ops dashboard |
| **Security** | Command approval, container isolation, auth | Vault, class-tiered rate limiting, MCP schema-drift, sandbox manifests, TOTP, audit log |
| **Tests** | ~25,000 | ~650 |
| **Research tooling** | Trajectory export, RL (Atropos), batch | n/a (not a goal) |

---

## Where Hermes leads (and Paw should mostly NOT chase)

1. **Breadth** — platforms, tools, terminal backends, providers. This is a funded lab's natural advantage. Matching their 20th messaging platform is effort not spent on the moat. **Decline this race deliberately.**
2. **The self-improving learning loop** — skills that improve from use, periodic memory nudges, dialectic user-modeling. Genuine R&D and their headline. *This is the one idea worth borrowing* (see Long-term #2).
3. **Research tooling** — RL training, trajectory export. Irrelevant to Paw's goals; ignore.
4. **Ecosystem & maturity** — MIT community, Skills Hub, ~25k tests. Can't be matched solo; don't try.

## Where Paw genuinely leads (the moat — protect & deepen)

1. **Canvas / app-spaces — the differentiator.** Paw's agent builds, serves, and wires a live web app to a *real, fenced database* (Supabase `canvas` yard → typed provisioning → form-actions → durable inbox). Hermes has browsing and search but nothing in this category. This was just proven end-to-end in production. **This is the defensible core.**
2. **White-label productization.** Paw → ConstructAI is a kernel you brand into vertical products, with disciplined upstream merges keeping kernel fixes flowing down. Paw has a *product-company* shape; Hermes has a *tool* shape.
3. **Companion + Agent Ops UX.** A visual face/body and an operations dashboard aimed at non-developers. Hermes is CLI/chat-observable only. This reaches a market Hermes ignores.
4. **Opinionated single-operator security** — vault, class-tiered limits, MCP schema-drift detection, fenced DDL provisioning. Tighter and more productized than a general toolkit.

---

## Quick wins (cheap borrows, high leverage)

### QW1 — `execute_code` / programmatic tool calling  ⭐ highest leverage
Hermes collapses multi-step tool pipelines into a single inference via code execution. Paw's production logs show the *opposite* failure mode: the agent fumbling `exec_command` one call at a time, chaining `;`/`|` the sandbox forbids, retrying verbatim. A sandboxed code-execution tool (write a script that orchestrates several tool/HTTP/file steps, run once, return the result) would eliminate that flailing and cut latency/cost.
**Effort:** medium. **Prompt:** see Appendix A.

### QW2 — `llms.txt` / `llms-full.txt`
Machine-readable doc index generated on deploy (curated index + full concat). Directly speeds the coding sessions that build Paw and ConstructAI. Near-zero cost.
**Effort:** trivial. **Prompt:** see Appendix B.

### QW3 — Prompt caching + context compression
Anthropic prefix caching + lossy mid-thread summarization for long Slack threads. Real cost/latency win; Paw has neither today.
**Effort:** medium (caching is cheap; compression needs care).

### QW4 — Lightweight skill/memory reflection beat
A scoped slice of Hermes' learning loop: a post-task reflection step that writes a memory nudge when a session hits a novel failure. Paw has *re-learned the same traps repeatedly* (the template-backtick bug bit three sessions). Even a minimal reflect→nudge loop attacks exactly this.
**Effort:** medium. (Foundation for Long-term #2.)

---

## Long-term strategic

1. **Don't compete on breadth. Compete on the web-app-building vertical moat.** Every hour matching Hermes' platform count is an hour not making ConstructAI build client sites-with-databases better than anything else can. The canvas + fenced-backend stack is the thing to widen (more provisioning types, richer form/data flows, multi-page apps, auth'd pages).
2. **Adopt the learning loop selectively.** It's the one Hermes architectural idea that materially improves *Paw's own* weakness — sessions repeating mistakes. Grow QW4 into real skill-refinement + agent-curated memory over time.
3. **agentskills.io standard compatibility.** Have `skill_scaffold` emit the open skill format so Paw skills are portable/shareable. Low cost; preserves ecosystem optionality.
4. **Meta-point:** Hermes validates that the agent-kernel category is real and well-funded. Paw's defensibility is **not** the kernel — it's the canvas moat + the productized vertical (ConstructAI) + the consumer-grade UX. Invest there; treat the kernel as table stakes that Hermes can be mined for parts to maintain.

---

## Appendix A — Prompt: `execute_code` tool (paw)

> You're in the **paw** repo (`~/repos-and-projects/paw`). Read `CLAUDE.md`. Add a sandboxed code-execution tool that lets the agent run a short script orchestrating multiple steps in one call, instead of chaining `exec_command` calls (which forbid shell operators and lack curl/git — see production error logs). One PR, `feat/execute-code-tool`.
>
> Build `execute_code({ language: "bun"|"python", code, timeout_ms })` running in the existing sandbox with the same containment as `exec_command` (workspace-only FS, no network unless already allowed, resource/time caps). The script can call back into Paw's own tools via a thin injected client (or return structured results the agent acts on) — decide the cleanest mechanism and justify it. Hard limits: timeout, output size cap, no escape from the workspace, audit-logged. Update the system prompt's TOOL ENVIRONMENT section to prefer `execute_code` for multi-step work. Tests: a multi-step script returns one result; timeout enforced; FS containment holds; oversize output truncated. Usual gates; no `Co-Authored-By`.

## Appendix B — Prompt: `llms.txt` docs (paw)

> You're in the **paw** repo. Read `CLAUDE.md`. Generate machine-readable doc indexes for coding agents, mirroring Hermes' approach. One PR, `feat/llms-txt-docs`.
>
> Produce `llms.txt` (curated index: every meaningful doc/README + a one-line description, kept small) and `llms-full.txt` (concatenated docs for one-shot ingestion), generated by a script run on build/deploy so they never drift. Source from `README.md`, `CLAUDE.md`, `CONSTRUCT.md` (note it's the fork's), `CHANGELOG.md`, the security review, and `docs/`. Serve both at the web root and `/docs/` paths. Tests: generator produces both files, the curated index lists known docs, files regenerate deterministically. Usual gates; no `Co-Authored-By`.

---

*Use Hermes as a parts catalog. Win on the canvas moat.*
