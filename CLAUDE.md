# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Security & Action Plan

**See `REVIEW-2026-06-09.md` for the current security review and phased action plan.** It contains the active Critical/High/Medium findings and the Phase 0–5 implementation roadmap with status checkboxes. Update its `## Changelog` section when phases close. Sibling reports: `AUDIT-REPORT.md` (Feb 2026), `OPTIMIZATION-REPORT.md` (Feb 2026).

## What is Paw

Paw is a personal AI assistant framework built with Bun. It supports multiple AI providers (Claude, OpenAI, Ollama, Gemini), a plugin system, MCP servers, memory with vector search, cron scheduling, and a web UI. The entry point is `bin/paw.ts`.

## Commands

```bash
bun install              # Install dependencies
bun start                # Start the kernel (production)
bun run dev              # Start with auto-reload (development)
bun test                 # Run all tests (Bun test runner)
bun test tests/ai/       # Run tests in a specific directory
bun test tests/ai/tools.test.ts  # Run a single test file
bun run lint             # Lint with Biome
bun run format           # Format with Biome
```

## Testing

Every fix-PR ships a regression test that fails on the pre-fix code. No exceptions.

Tests mirror `src/` under `tests/` and must pass from a clean checkout regardless of the developer's environment — scrub `PAW_*` env vars (and redirect `PAW_CONFIG_DIR` to a temp dir) via `tests/helpers/env.ts` for anything that reads config/credentials/the vault.

## Architecture

**Kernel-centric event-driven design.** The Kernel (`src/kernel/kernel.ts`) is the central orchestrator that boots all subsystems: AI providers, plugin loader, event bus, memory store, cron scheduler, web server, and MCP client manager.

**Message flow:** Plugin emits `message:inbound` → Kernel validates (access control, rate limiting) → stores in SQLite → calls AI provider with message history + tools → provider may call tools (sandbox-checked) in a loop → stores response → emits `message:outbound` → plugin delivers to user.

**Key subsystems:**
- `src/ai/` — Provider abstraction (`base-provider.ts` defines the interface). Claude (`provider.ts`), OpenAI, Ollama, Gemini each implement it. `tools.ts` is the ToolRegistry. `skills.ts` manages on-demand tool activation to reduce token usage.
- `src/kernel/` — `bus.ts` (typed EventBus pub/sub), `sandbox.ts` (permission enforcement via plugin manifests), `plugin-loader.ts` (discovers plugins from `plugins/` directory).
- `src/memory/` — Hybrid vector + FTS search. `embeddings.ts` wraps Xenova/all-MiniLM-L6-v2. `auto-extract.ts` pulls facts from conversations. `store.ts` handles recall with configurable vector/FTS weighting.
- `src/store/` — SQLite with WAL mode. `db.ts` runs inline migrations on startup. Raw SQL queries (no ORM), parameterized throughout. Tables: sessions, messages, memories, memories_vec, plugin_kv, cron_jobs, heartbeat_logs, web_sessions, audit_logs, pairing_codes, approved_users.
- `src/web/` — Hono framework with JSX views (`src/web/views/`). REST API + server-rendered pages. Auth middleware supports password + optional TOTP 2FA.
- `src/config/` — Zod schema (`schema.ts`) validates all config. Loader cascade: runtime overrides → `~/.paw/config.json` → env vars (`PAW_*`) → credential store (`~/.paw/credentials.json`) → defaults. **Exception:** deployment-infra path env vars (`PAW_DB_PATH` → `store.dbPath`, `PAW_CANVAS_ROOT` → `web.canvas.root`) are applied *after* the file config so they win over a persisted `config.json` (`resolvedInfraOverrides()` in `loader.ts`) — otherwise a stale `config.json` could push the SQLite DB / canvas off the Railway `/data` volume onto ephemeral storage and wipe data each redeploy. The config writer also never persists `store.dbPath`.
- `src/security/` — Rate limiter, access control (allowlist/blocklist/pairing codes), web session management, TOTP, audit logging.
- `src/tools/` — Built-in tools: `file_read`/`file_write`/`file_list` (sandboxed to workspace), `exec_command` (allowlisted commands), `canvas_write`/`canvas_read`/`canvas_list`.

**Plugins** (`plugins/`) declare permissions in `manifest.json` and register tools. Built-in: Slack (Socket Mode) and Web Pilot (Playwright). The sandbox enforces declared permissions at runtime.

**Skills system:** Tools are grouped into skills by source. Only always-active skills (memory by default) go with every request. Others load on-demand via `activate_skill`, reducing input tokens from ~15-25k to ~1k.

## Tech Stack

- **Runtime:** Bun (with built-in SQLite support)
- **Web:** Hono with JSX
- **Database:** SQLite (WAL mode) + sqlite-vec for vector search
- **AI SDKs:** @anthropic-ai/sdk, raw HTTP for OpenAI/Ollama/Gemini
- **Config validation:** Zod
- **Linter/Formatter:** Biome
- **Tests:** Bun test runner (tests mirror src structure in `tests/`)
- **TypeScript:** Strict mode, ES2022 target, bundler module resolution
