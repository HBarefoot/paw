# n8n-health-probe

Health probes for [n8n](https://n8n.io) workflows, exposed as paw tools.

| Tool | Input | Returns |
|---|---|---|
| `probe_workflow` | `workflow_id`, `window_hours?` (24) | active state, run count, failure rate, last run/status + a verdict |
| `list_inactive_workflows` | `window_hours?` (168) | `{id, name, last_run, reason}[]` for disabled / never-run / stale workflows |
| `recent_failures` | `limit?` (10) | recent failed executions with failing node + error excerpt |

All tools are **read-only**; remote workflow names and error text are passed
through `sanitizePromptText()` before they re-enter the model.

## Configuration

The plugin resolves its n8n connection, in order:

1. **Its own config block** `config["n8n-health-probe"] = { baseUrl, token }`,
   where `baseUrl` is the n8n instance origin (e.g. `https://n8n.example.com`)
   and `token` is an n8n API key. `token` may be `vault://n8n.token` — the
   kernel's vault overlay resolves it before the plugin sees it, so the existing
   n8n secret is reused with no new storage.
2. **Env fallback:** `PAW_N8N_TOKEN` + `PAW_N8N_BASE_URL` (or the origin of the
   first `PAW_N8N_ENDPOINTS` entry).

`ctx.config` is plugin-scoped (paw passes `config["<plugin-name>"]`), so this
plugin cannot read the global `config.n8n` directly — hence its own block / the
`vault://` ref / the env fallback. With no usable `baseUrl`+`token`, every tool
returns a clean "not configured" error (it never throws), so the
`orphan-sweep` cron pointing at `list_inactive_workflows` degrades gracefully.

The n8n REST calls hit `<baseUrl>/api/v1/...` with the `X-N8N-API-KEY` header.

## Permissions

The manifest grants **`n8n-health-probe`** (the plugin's own name), not a
`net:<host>`. That is deliberate: paw's `ToolRegistry.execute()` checks
`sandbox.checkPermission(tool.plugin, inferPermission(tool))`, and tools whose
names don't match a known prefix (`probe_workflow`, `list_inactive_workflows`,
`recent_failures`) infer their permission as `tool.plugin` =
`"n8n-health-probe"`. A `net:<host>` grant would never be consulted for these
names, so the plugin-name self-grant is the permission that actually gates them.
(The original scaffold's placeholder `net:n8n.mcp.example.com` was dead.)

## Loading

Plugins load only at boot. After adding/changing this plugin, restart paw.
