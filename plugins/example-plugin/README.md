# example-plugin

Example plugin demonstrating Paw skill structure and tool patterns

Paw plugin conventions:
- A plugin lives in plugins/<name>/ with a manifest.json and an index.ts.
- manifest.json declares { name, version, description, permissions[] }. Permissions
  are sandbox grants: net:<host>, browser, exec, file:read, file:write,
  memory:read|write|forget, cron:create, agent:spawn, agent:delegate,
  skill:activate, canvas:read|write. The sandbox enforces them at tool-call time.
- index.ts default-exports a ChannelPlugin class (register/start/stop/health).
  register(ctx) calls ctx.registerTools(...) to add tools to the registry.
- Each tool has { name, description, plugin, input_schema (JSON Schema), handler }.
  Tools carrying plugin:'<name>' group into the on-demand '<name>' skill.
- Tests mirror src/ under tests/ and must pass from a clean checkout.
- Secrets go in the vault (src/security/vault.ts KNOWN_SECRET_SLOTS +
  overlayConfig), resolved server-side — never hardcode credentials.
- Plugins load ONLY at boot. A scaffold is inert until you review it and
  restart paw.
