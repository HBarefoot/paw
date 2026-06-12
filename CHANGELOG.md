# Changelog

All notable changes to Paw are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Releasing.** Version bumps land via a PR that carries a `CHANGELOG.md` section
> and bumps `package.json`'s `version`. After the PR merges, tag from `main`:
> `git tag vX.Y.Z && git push --tags` — never tag from the feature branch.

## [0.5.0] - 2026-06-12

The first cut that matches the work: everything built since the initial `0.1.0`
framework. Grouped by theme; each entry cites the merged PR(s) it came from.

### Brand Kit & white-label
- Brand library with one active brand that themes the agent, canvas output, and the whole console; `--accent-fg` auto-contrast and brand `muted` as secondary text (#6, #7, #8).
- Full-surface console theming via `/api/brand/theme.css` (render-blocking, light + dark), with a localStorage pre-paint identity swap that also brands the login/TOTP pages (#7, #8).
- Optional brand-driven chat label that renames the chat page title and sidebar nav item (#56), plus a read-back fix so `chatLabel` survives the DB round-trip (#63).

### Credential vault
- Encrypted, web-managed secrets (AES-256-GCM, master key from `PAW_VAULT_KEY`) replacing scattered `PAW_*` env vars and `credentials.json`. Resolution is server-side only — values never reach the model, chat stream, or canvas. Managed at `/vault` (#20).

### GitHub integration
- First-class GitHub **App** integration ("build, with control"): atomic Git Data API commits, refusal to write protected/default branches, never force-pushes; irreversible actions (merge/delete/close/dispatch) gated through a `/github` approvals inbox; HMAC webhook receiver + live activity feed; CI-feedback tools and an inline PR diff viewer. Disabled by default (#22, #23, #24, #25, #26).
- Private-key normalization (PKCS#1/#8, mangled-paste repair) and field fixes (#27, #28); collapsible config + page UI polish (#29, #30); webhook reactivity phases A/B and binary-file commits (#31, #32, #33); durable real notifications (#34).
- Write-path errors made self-explanatory: 403/404s now name the missing App permission instead of an opaque "Resource not accessible"; added approval-gated-safe `github_create_issue` / `github_update_issue` (#64).

### Canvas — app-space platform
- Authed `apps/<space>/` production-app surface on the canvas: `GET /api/app/:space/*` behind session auth, per-space manifest with strict CSP, directory-index resolution, protection-from-wipe, and an opt-in refresh poller (#43).
- Atomic `canvas_write` so files never render half-written (#45); a pinned, non-closable `__home__` canvas Home tab (#52).
- Living-portrait canvas empty-state and workbench that reacts live to the agent (orbiting skills, flowing wires/packets, sub-agent mini-orbs), plus the inline-script template-trap fixes (#14, #15, #16, #17, #18, #19, #35, #36, #37, #38, #39); canvas-reload "stuck writing…" code-block fix and share-header fix (#21, #13).

### Forms & actions
- Canvas form-action `tool` type with `require_auth` tiering, wiring a public form submission to a registered tool with a durable submissions inbox at `/submissions` (#44).
- Form-receiver extracted into a reusable factory with its own app-level test harness (#47).

### Agent Ops console
- The `/` dashboard rebuilt as the **Agent Ops** console: a live operation feed from the `tool_log` plus an in-flight registry, rendered through vanilla-canvas **Stream** and **Swarm** lenses with a scrub timeline (#57, #58, #59, #60).
- `sessionId` threaded through the tool-execution path, fixing the long-null `tool_log.session_id` and powering attribution (#58); `OpsPage` made mountable at any path for white-label forks (#63).
- Supersedes the earlier portrait-constellation dashboard (#40, #41, #42).

### Rate limiting
- Class-tiered per-IP budgets for `/api/*` — action / app-asset / chrome / live — replacing the single shared budget, with content-type-matched 429 bodies so a throttled asset never breaks its MIME type (#51, #55).

### Chat & media
- Attachments for all file types with inline chips/previews, PDF text extraction via `unpdf`, and browser voice STT/TTS (#53, #54).
- Brand-driven chat label (#56).

### AI routing
- Optional vision routing: image-bearing turns are served by a configured vision provider/model with graceful fallbacks; text turns are untouched (#61).
- Runtime MCP schema-drift detection (#48).

### Native integrations pack
- **Supabase** — PostgREST client over the service-role key with a typed filter subset (eq/neq/gt/lt/like/in) and filters-required guards on update/delete (#65).
- **HubSpot** — the canvas-only client promoted to a full CRM skill (contacts, companies, deals, notes, associations) without changing the form-receiver path (#66).
- **WordPress** — REST API + Application Passwords: posts/pages CRUD (draft by default), taxonomies, and sandboxed, size-capped media upload (#67).
- **Skill Creator** — a meta-skill that scaffolds new, inert plugins (manifest + typed stub tools + tests) that load only on the next boot (#68).
- (GitHub write-path errors + issue tools, #64, listed under GitHub integration.)

### MCP & n8n
- MCP entries support bearer `authToken` + custom headers and a JSON-paste import; n8n is a first-class integration whose endpoints merge into the MCP map at boot (#4).
- MCP schema-drift detection and hermetic MCP tests (#48).

### Persistence & deployment
- SQLite DB pinned to the Railway `/data` volume so accounts/brands/sessions/memories survive redeploys; storage diagnostics banner; relative-dbPath co-location; production session persistence (#5, #10, #11, #12).

### Hardening & tests
- Hermetic test suite via `tests/helpers/env.ts` (scrub `PAW_*`, redirect `PAW_CONFIG_DIR`) plus testability seams, and a documented "every fix ships a regression test" policy (#48, #49).
- Core regression pass across cron, skills, memory, and MCP (#49).

### UI/UX
- Violet "control-room" design system and canvas operations hub (#3); full-width content layout (#50); Slack sessions surfaced on `/sessions` (#46).

## [0.1.0] - 2026-02-17

- Initial Paw framework: the kernel and event bus, multi-provider AI (Claude, OpenAI, Ollama, Gemini), hybrid vector + FTS memory with auto-extraction, the on-demand skills system, plugin architecture (Slack, Web Pilot), MCP client support, the cron scheduler, the web UI, and the first live canvas.

[0.5.0]: https://github.com/HBarefoot/paw/compare/v0.1.0...v0.5.0
[0.1.0]: https://github.com/HBarefoot/paw/releases/tag/v0.1.0
