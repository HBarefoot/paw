# Extending Paw: A How-To Guide for Building Skills

**Tagline:** Add new capabilities to Paw by writing plugins that expose tools to the AI agent.

---

## What You Get

When you build a Paw skill, you create a **plugin** that:
- Exposes typed tools the AI can call autonomously
- Runs in a sandbox with explicit permissions (network, file, memory, etc.)
- Loads at boot and integrates into the agent's tool registry
- Can access secrets via the vault, external APIs, and internal services

---

## Quick Start: Scaffold a Plugin

Use the `skill_scaffold` tool to generate the skeleton:

```
skill_scaffold(
  name: "my-plugin",
  description: "What your plugin does in one sentence",
  permissions: ["net:api.example.com", "memory:read"],
  tools: [
    {
      name: "fetch_data",
      description: "Fetches data from an external API",
      inputFields: [
        { name: "endpoint", type: "string", required: true, description: "API path" }
      ]
    }
  ]
)
```

**Output:** A `plugins/my-plugin/` directory with:
- `manifest.json` — Plugin metadata and permissions
- `index.ts` — Plugin class implementing `ChannelPlugin`
- `tools.ts` — Tool definitions with JSON Schema and stub handlers
- `my-plugin.test.ts` — Test skeleton
- `README.md` — Conventions reminder

> ⚠️ **Plugins load ONLY at boot.** After scaffolding, review the code and **restart Paw** to load it. The scaffolded handlers return `"not implemented"` until you fill them in.

---

## Plugin Structure

```
plugins/my-plugin/
├── manifest.json          # Metadata + permissions
├── index.ts               # Plugin entry point (ChannelPlugin class)
├── tools.ts               # Tool definitions (or tools/ folder for complex plugins)
├── lib/                   # Shared utilities (optional)
├── prompts/               # LLM prompt templates (optional)
└── my-plugin.test.ts      # Tests
```

### manifest.json

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "One-sentence description",
  "permissions": ["net:api.example.com", "memory:read"]
}
```

**Available Permissions:**
| Permission | Grants |
|------------|--------|
| `net:<host>` | Network access to specific host (or `net:*` for all) |
| `browser` | Browser automation (navigate, click, fill) |
| `exec` | Shell command execution |
| `file:read` / `file:write` | Filesystem access |
| `memory:read` / `memory:write` / `memory:forget` | Long-term memory access |
| `cron:create` | Schedule proactive triggers |
| `agent:spawn` / `agent:delegate` | Spawn sub-agents |
| `skill:activate` | Activate other skills |
| `canvas:read` / `canvas:write` | Canvas workspace access |

The sandbox enforces these at **tool-call time**. A tool without `net:*` permission cannot make HTTP requests.

---

### index.ts — Plugin Class

```typescript
import type { ChannelPlugin, PluginContext } from "../../src/types/plugin.js";
import { createTools } from "./tools.js";

export default class MyPlugin implements ChannelPlugin {
  readonly name = "my-plugin";

  async register(ctx: PluginContext): Promise<void> {
    ctx.registerTools(createTools());
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}
```

**PluginContext provides:**
- `ctx.registerTools(tools)` — Register your tool definitions
- `ctx.logger.{info,warn,error,debug}` — Logging
- `ctx.config` — Plugin configuration (from Paw config or env vars)
- `ctx.store` — Key-value store for plugin state
- `ctx.llm({ system, message })` — Call the LLM (rate-limited, use semaphore for concurrency)

---

### tools.ts — Tool Definitions

Each tool is a `ToolDefinition` with:

```typescript
import type { ToolDefinition, ToolResult } from "../../src/types/message.js";

export function createTools(): ToolDefinition[] {
  return [
    {
      name: "fetch_data",
      description: "Fetches data from an external API",
      plugin: "my-plugin",  // Groups tools under the skill name
      input_schema: {
        type: "object",
        properties: {
          endpoint: { type: "string", description: "API endpoint path" },
          params: { type: "object", description: "Query parameters" }
        },
        required: ["endpoint"]
      },
      handler: async (input): Promise<ToolResult> => {
        // Your implementation here
        return { content: JSON.stringify({ result: "data" }) };
      }
    }
  ];
}
```

**ToolResult format:**
```typescript
{
  content: string;      // Response text (JSON or plain text)
  is_error?: boolean;   // Set true for errors
}
```

**For errors:**
```typescript
return {
  content: "API key not configured. Set MYPLUGIN_API_KEY in config.",
  is_error: true
};
```

---

## Real-World Patterns

### 1. Split Complex Tools into Separate Files

For plugins with 5+ tools, use a `tools/` folder:

```
plugins/icp-discovery/
├── tools/
│   ├── discover-franchises.ts
│   ├── enrich-contacts.ts
│   ├── estimate-revenue.ts
│   └── export-results.ts
├── lib/
│   ├── brave-search.ts
│   ├── hunter.ts
│   └── search-cache.ts
└── index.ts
```

Each tool file exports a handler factory:

```typescript
// tools/discover-franchises.ts
interface Deps {
  searchClient: CachedSearchClient;
  llm: (opts: { system: string; message: string }) => Promise<string>;
}

export function createDiscoverFranchisesHandler(deps: Deps) {
  return async (input: unknown): Promise<ToolResult> => {
    // Implementation using deps
  };
}
```

Then wire them in `index.ts`:

```typescript
const discoverFranchises = createDiscoverFranchisesHandler({ searchClient, llm });

ctx.registerTools([
  {
    name: "discover_franchises",
    description: "...",
    plugin: "icp-discovery",
    input_schema: {...},
    handler: discoverFranchises
  }
]);
```

---

### 2. Handle Missing Configuration Gracefully

Check for required config/env vars and return clean errors:

```typescript
const apiKey = ctx.config.apiKey as string || process.env.MYPLUGIN_API_KEY;
if (!apiKey) {
  return {
    content: "API key not configured. Set MYPLUGIN_API_KEY in config or env.",
    is_error: true
  };
}
```

The `n8n-health-probe` plugin returns `"n8n is not configured"` for all tools when the client is null, allowing the agent to degrade gracefully.

---

### 3. Use the Vault for Secrets

Never hardcode credentials. Use the vault:

```typescript
// In config, reference secrets as:
{
  "myPlugin": {
    "apiKey": "vault://myplugin.api_key"
  }
}
```

The vault resolves these server-side. Add your secret slot to `src/security/vault.ts` under `KNOWN_SECRET_SLOTS`.

---

### 4. Rate Limit LLM Calls

Use a semaphore to avoid overwhelming rate-limited endpoints:

```typescript
import { Semaphore } from "./lib/semaphore";

const llmSemaphore = new Semaphore(2); // Max 2 concurrent calls
const llm: typeof ctx.llm = (opts) => llmSemaphore.run(() => ctx.llm(opts));
```

The `icp-discovery` plugin uses `concurrency=2` to balance throughput vs. Ollama rate limits.

---

### 5. Cache Expensive Lookups

Implement caching for API calls that don't change frequently:

```typescript
// lib/search-cache.ts
export function createCachedSearchClient(config, store) {
  const cache = new Map();
  
  return {
    async search(query: string) {
      if (cache.has(query)) return cache.get(query);
      const result = await fetch(...);
      cache.set(query, result);
      store.set(`cache:${query}`, result); // Persist across restarts
      return result;
    }
  };
}
```

---

## Testing

Tests live alongside the plugin:

```typescript
// my-plugin.test.ts
import { describe, expect, test } from "bun:test";
import { createTools } from "./tools.js";

describe("my-plugin tools", () => {
  test("registers its tools", () => {
    const names = createTools().map((t) => t.name);
    expect(names).toContain("fetch_data");
  });

  test("handler returns expected output", async () => {
    const tool = createTools().find((t) => t.name === "fetch_data");
    const res = await tool?.handler({ endpoint: "/test" });
    expect(res?.content).toContain("expected");
  });
});
```

**Mock external dependencies:**
```typescript
// Mock fetch for HTTP calls
globalThis.fetch = async (url) => {
  if (url.includes("/api/test")) {
    return new Response(JSON.stringify({ data: "mocked" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};
```

Run tests with:
```bash
bun test plugins/my-plugin/my-plugin.test.ts
```

---

## Input Schema Reference

Tool input schemas use **JSON Schema**:

```typescript
input_schema: {
  type: "object",
  properties: {
    // String
    name: { type: "string", description: "User's name" },
    
    // Number
    count: { type: "number", description: "How many items" },
    
    // Boolean
    includeArchived: { type: "boolean", description: "Include archived items" },
    
    // Object
    filters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "inactive"] }
      }
    },
    
    // Array
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Tags to filter by"
    }
  },
  required: ["name"]  // Required fields
}
```

---

## Loading Your Plugin

1. **Scaffold:** `skill_scaffold(...)`
2. **Implement:** Fill in tool handlers in `tools.ts`
3. **Test:** Run `bun test plugins/my-plugin/`
4. **Restart Paw:** Plugins load **only at boot**
5. **Activate:** The AI can now use `activate_skill("my-plugin")` to access your tools

---

## Debugging

**Plugin didn't load?**
- Check `manifest.json` name matches folder name
- Ensure `index.ts` default-exports a class implementing `ChannelPlugin`
- Verify all imports resolve (run `bun build` to check)

**Tool returns "not implemented"?**
- You're running the scaffolded stub. Implement the handler.

**Permission denied?**
- Add the required permission to `manifest.json`
- Restart Paw (permissions are checked at load time)

**Secret not resolved?**
- Add the slot to `src/security/vault.ts` under `KNOWN_SECRET_SLOTS`
- Set the value in your overlay config

---

## Example: A Complete Tool

```typescript
// plugins/weather/tools.ts
import type { ToolDefinition, ToolResult } from "../../src/types/message.js";

export function createTools(): ToolDefinition[] {
  return [
    {
      name: "get_forecast",
      description: "Get weather forecast for a city",
      plugin: "weather",
      input_schema: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name" },
          days: { type: "number", description: "Days to forecast (1-7)", default: 3 }
        },
        required: ["city"]
      },
      handler: async (input): Promise<ToolResult> => {
        const apiKey = process.env.WEATHER_API_KEY;
        if (!apiKey) {
          return {
            content: "WEATHER_API_KEY not configured",
            is_error: true
          };
        }

        const city = encodeURIComponent(input.city as string);
        const days = Math.min(7, Math.max(1, Number(input.days) || 3));
        
        try {
          const res = await fetch(
            `https://api.weather.com/forecast?city=${city}&days=${days}`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
          );
          
          if (!res.ok) {
            return { content: `Weather API error: ${res.status}`, is_error: true };
          }
          
          const data = await res.json();
          return { content: JSON.stringify(data) };
        } catch (err) {
          return {
            content: `Weather fetch failed: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true
          };
        }
      }
    }
  ];
}
```

---

## Reference Plugins

Study these for patterns:

| Plugin | Location | What It Shows |
|--------|----------|---------------|
| `icp-discovery` | `plugins/icp-discovery/` | Complex multi-tool plugin with caching, LLM calls, external APIs |
| `n8n-health-probe` | `plugins/n8n-health-probe/` | Graceful degradation, config handling, comprehensive tests |
| `example-plugin` | `plugins/example-plugin/` | Scaffolded skeleton (starting point) |

---

## Summary Checklist

- [ ] Plugin name is lowercase, dash-separated
- [ ] `manifest.json` declares all required permissions
- [ ] `index.ts` exports default class implementing `ChannelPlugin`
- [ ] Each tool has `plugin` field matching plugin name
- [ ] Input schemas use valid JSON Schema
- [ ] Handlers return `ToolResult` with `content` string
- [ ] Errors set `is_error: true`
- [ ] Secrets use vault, not hardcoded
- [ ] Tests pass from clean checkout
- [ ] Restarted Paw to load the plugin

---

**Next Steps:** Run `skill_scaffold` to create your first plugin, then implement the handlers and tests.
