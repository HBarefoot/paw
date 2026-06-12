# Paw

A personal AI assistant framework built with Bun. Supports multiple AI providers, a plugin system, MCP servers, memory with vector search, cron scheduling, and a web UI for management.

## Quick Start

```bash
# Install dependencies
bun install

# Interactive setup (configures provider + credentials)
bun run bin/paw.ts init

# Start
bun start

# Development mode (auto-reload)
bun run dev
```

## Features

- **Multi-provider AI** — Claude, OpenAI, Ollama, Gemini. Switch providers via config. Optional vision routing sends image-bearing turns to a configured vision model.
- **Memory system** — Hybrid vector + full-text search. Auto-extracts facts from conversations. Persists across sessions.
- **Skills ecosystem** — Tools grouped into skills that load on demand, reducing token usage. Manage via web UI at `/skills`.
- **Plugin architecture** — Built-in Slack and Web Pilot (Playwright) plugins. Drop-in plugin discovery from `plugins/` directory. A `skill_scaffold` tool generates new (inert, review-then-restart) plugins.
- **Native integrations** — First-class, vault-credentialed integrations that work out of the box: GitHub (App), Strapi, HubSpot, Supabase, WordPress, n8n.
- **MCP support** — Connect external tool servers via stdio, SSE, or HTTP transport (bearer/header auth, JSON-paste import). Manage at `/mcp`.
- **Cron scheduler** — Schedule prompts, tool calls, or events on cron expressions.
- **Live Canvas** — Agent-driven visual workspace with a live preview iframe; plus authed `apps/<space>/` production-app surfaces with per-space CSP. Toggle canvas mode in `/chat`.
- **Chat** — Attachments for all file types (PDF text extraction, inline previews) and browser voice (speech-to-text / text-to-speech).
- **Brand Kit** — A library of brand profiles (one active) that white-labels the agent, canvas output, and the entire console.
- **Credential vault** — Encrypted, web-managed secrets (AES-256-GCM); resolved server-side and never exposed to the model.
- **Agent Ops console** — The `/` dashboard: a live operation feed (Stream + Swarm lenses over the real tool stream) with in-flight tracking and session attribution.
- **Web UI** — Agent Ops dashboard, chat + canvas, memory browser, session history, config editor, brand/vault/GitHub admin, and skill/cron/MCP management.
- **Security** — Class-tiered rate limiting, user allowlist/blocklist, pairing code approval, optional TOTP 2FA, sandboxed tool execution.

## Configuration

Paw loads config from multiple sources (highest priority first):

1. Runtime overrides
2. `~/.paw/config.json` (saved via web UI or CLI)
3. Environment variables
4. Credential store (`bun run bin/paw.ts auth login`)
5. Built-in defaults

### Environment Variables

```bash
# AI Provider (claude, ollama, openai, gemini)
PAW_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...

# Ollama
PAW_OLLAMA_BASE_URL=http://localhost:11434
PAW_OLLAMA_MODEL=llama3.1

# OpenAI
OPENAI_API_KEY=sk-...
PAW_OPENAI_MODEL=gpt-4o

# Gemini
GEMINI_API_KEY=...
PAW_GEMINI_MODEL=gemini-2.0-flash

# Web UI
PAW_WEB_ENABLED=true
PAW_WEB_PORT=3000

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...

# Logging
PAW_LOG_LEVEL=info
```

### Config File

The web UI config page writes to `~/.paw/config.json`. Any key from the schema can be overridden:

```json
{
  "provider": "claude",
  "ai": { "model": "claude-sonnet-4-5-20250929", "maxTokens": 4096 },
  "agent": { "name": "Paw", "systemPrompt": "You are a marketing assistant." },
  "web": { "enabled": true, "port": 3000 },
  "memory": { "enabled": true, "autoExtract": true },
  "skills": {
    "slack": { "alwaysActive": true }
  }
}
```

## Web UI

Start with `PAW_WEB_ENABLED=true` (or set in config). Default: `http://127.0.0.1:3000`

| Page | Path | Description |
|------|------|-------------|
| Agent Ops | `/` | Live operation feed (Stream + Swarm lenses), in-flight tracking, session attribution |
| Chat | `/chat` | Interactive chat with session persistence; toggle canvas mode for the live visual workspace |
| Memory | `/memory` | Browse, search, and manage stored memories |
| Sessions | `/sessions` | View past conversation sessions |
| Skills | `/skills` | View/toggle/edit skill groups and their tools |
| Cron | `/cron` | Create and manage scheduled jobs |
| MCP | `/mcp` | Connect and manage MCP tool servers |
| Brand | `/brand` | Manage brand profiles and activate white-label theming |
| Vault | `/vault` | Store and rotate encrypted credentials |
| GitHub | `/github` | GitHub App status, PRs, approvals inbox, activity feed |
| Submissions | `/submissions` | Durable inbox of canvas form submissions |
| Config | `/config` | Edit all configuration live |

Optional HTTP basic auth: set `web.password` in config.

## Skills

Tools are automatically grouped into skills based on their source plugin. Only always-active skills (memory by default) are sent with every AI request. Other skills are loaded on demand when the AI calls `activate_skill`.

This reduces input tokens from ~15-25k to ~1k per request.

Manage skills at `/skills` in the web UI: toggle always-active, edit descriptions, view tool lists.

## Canvas

The live canvas (toggle canvas mode in `/chat`) is a split-pane workspace where the AI generates HTML/CSS/JS and the result renders in a live preview iframe.

- **How it works** — Send a prompt (e.g. "Create a landing page for a car dealer"), the AI uses `canvas_write` to create files in `./data/canvas/`, and the preview auto-refreshes.
- **Persistence** — Canvas files survive server restarts. Use the trash icon in the toolbar to clear all files and start fresh.
- **Tools** — `canvas_write`, `canvas_read`, `canvas_list` — sandboxed to the canvas root directory.
- **Config** — `web.canvas.enabled` (default: true), `web.canvas.root` (default: `./data/canvas`).

## Plugins

Built-in plugins live in `plugins/`:

- **slack** — Slack integration via Socket Mode. Posts messages and reactions.
- **web-pilot** — Browser automation with Playwright. Navigate, click, fill forms, screenshot.

Plugins register tools and declare permissions via `manifest.json`. The kernel enforces sandboxed execution.

### MCP Servers

Add external tool servers in config:

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npx",
      "args": ["-y", "@n8n/mcp-server"],
      "transport": "stdio"
    }
  }
}
```

## CLI Commands

```bash
bun run bin/paw.ts init           # Interactive setup
bun run bin/paw.ts start          # Start the kernel
bun run bin/paw.ts auth login     # Configure credentials
bun run bin/paw.ts auth status    # Check auth state
bun run bin/paw.ts config         # Show current config
bun run bin/paw.ts status         # Plugin health check
bun run bin/paw.ts cron list      # List cron jobs
bun run bin/paw.ts cron add       # Add a cron job
bun run bin/paw.ts cron remove    # Remove a cron job
```

## Development

```bash
bun test           # Run tests
bun run dev        # Start with auto-reload
bun run lint       # Check with Biome
bun run format     # Format with Biome
```

## Architecture

```
bin/paw.ts          CLI entry point
src/
  kernel/           Kernel, event bus, sandbox, plugin loader
  ai/               Providers (Claude, OpenAI, Ollama, Gemini), tool registry, skills
  memory/           Vector + FTS memory store, auto-extraction
  store/            SQLite database, sessions, messages
  config/           Schema validation (Zod), config loader/writer
  auth/             Credential storage per provider
  cron/             Cron scheduler with expression parser
  heartbeat/        System health monitoring
  security/         Access control, rate limiting
  mcp/              MCP client manager (stdio, SSE, HTTP)
  web/              Hono web server, JSX views, REST API
  tools/            Built-in file, exec, and canvas tools
  types/            TypeScript interfaces
plugins/
  slack/            Slack channel plugin
  web-pilot/        Playwright browser plugin
tests/              Test suite (Bun test runner)
```

## Requirements

- [Bun](https://bun.sh) v1.0+
- An AI provider API key (Anthropic, OpenAI, or Gemini) or a local Ollama instance
