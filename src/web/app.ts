import { Hono } from "hono";
import { DashboardPage } from "./views/dashboard.js";
import { ConfigPage } from "./views/config-page.js";
import { ChatPage, getChatScript } from "./views/chat.js";
import { CronPage } from "./views/cron-page.js";
import { MemoryPage } from "./views/memory-page.js";
import { SessionsListPage, SessionDetailPage } from "./views/sessions-page.js";
import { MCPPage } from "./views/mcp-page.js";
import { SkillsPage } from "./views/skills-page.js";
import { readConfigOverrides, saveConfigOverrides } from "../config/writer.js";
import { listRecentSessions, getSessionWithMessages, deleteSession, updateSessionTitle } from "../store/sessions.js";
import { isValidCron } from "../cron/parser.js";
import type { Kernel } from "../kernel/kernel.js";
import type { PawConfig } from "../types/config.js";

export function createWebApp(kernel: Kernel, config: PawConfig): Hono {
  const app = new Hono();

  // Basic auth middleware (if password is set)
  if (config.web.password) {
    const expectedAuth = btoa(`${config.web.username}:${config.web.password}`);
    app.use("*", async (c, next) => {
      // Skip auth for API calls with token
      if (config.web.authToken && c.req.header("Authorization") === `Bearer ${config.web.authToken}`) {
        return next();
      }

      const auth = c.req.header("Authorization");
      if (auth && auth.startsWith("Basic ")) {
        const provided = auth.slice(6);
        if (provided === expectedAuth) {
          return next();
        }
      }

      c.header("WWW-Authenticate", 'Basic realm="Paw"');
      return c.text("Unauthorized", 401);
    });
  }

  // --- Pages ---

  app.get("/", async (c) => {
    const health = await kernel.healthCheck();
    const memoryStats = kernel.memory?.getStats() ?? null;
    const cronJobs = kernel.cron?.listJobs() ?? [];
    const uptime = process.uptime() * 1000;

    return c.html(
      DashboardPage({
        health,
        memoryStats,
        cronJobs,
        provider: config.provider,
        plugins: kernel.pluginNames,
        uptime,
      }),
    );
  });

  function liveConfig(): PawConfig {
    const overrides = readConfigOverrides();
    return { ...config, ...overrides, agent: { ...config.agent, ...(overrides.agent as Record<string, unknown> ?? {}) } } as PawConfig;
  }

  app.get("/config", (c) => {
    return c.html(ConfigPage({ config: liveConfig() }));
  });

  app.post("/config", async (c) => {
    try {
      const body = await c.req.parseBody();
      const overrides: Record<string, unknown> = {};

      // Parse dotted form field names into nested objects
      for (const [key, value] of Object.entries(body)) {
        const parts = key.split(".");
        let target = overrides;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!target[parts[i]] || typeof target[parts[i]] !== "object") {
            target[parts[i]] = {};
          }
          target = target[parts[i]] as Record<string, unknown>;
        }
        const lastKey = parts[parts.length - 1];
        // Coerce types
        if (value === "true") target[lastKey] = true;
        else if (value === "false") target[lastKey] = false;
        else if (typeof value === "string" && /^\d+$/.test(value)) target[lastKey] = parseInt(value, 10);
        else if (typeof value === "string" && /^\d+\.\d+$/.test(value)) target[lastKey] = parseFloat(value);
        else target[lastKey] = value;
      }

      saveConfigOverrides(overrides);
      return c.html(ConfigPage({ config: liveConfig(), saved: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.html(ConfigPage({ config: liveConfig(), error: message }));
    }
  });

  app.get("/chat", (c) => {
    const sessionId = c.req.query("session") || `web-${Date.now()}`;
    return c.html(ChatPage({ sessionId }));
  });

  app.get("/js/chat.js", (c) => {
    c.header("Content-Type", "application/javascript; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    return c.body(getChatScript());
  });

  // --- Cron Page ---

  app.get("/cron", (c) => {
    const jobs = kernel.cron?.listJobs() ?? [];
    return c.html(CronPage({ jobs }));
  });

  // --- Memory Page ---

  app.get("/memory", async (c) => {
    const q = c.req.query("q") ?? "";
    const category = c.req.query("category") ?? "";
    const stats = kernel.memory?.getStats() ?? null;

    let memories: Array<{
      id: string;
      text: string;
      scope: string;
      category: string;
      source: string | null;
      created_at: string;
    }> = [];

    if (kernel.memory) {
      if (q) {
        const results = await kernel.memory.recall(q, {
          limit: 50,
          ...(category ? {} : {}),
        });
        memories = results.map((r) => ({
          id: r.id,
          text: r.text,
          scope: r.metadata.scope,
          category: r.metadata.category,
          source: r.metadata.source ?? null,
          created_at: r.created_at,
        }));
        // Filter by category client-side if search was used
        if (category) {
          memories = memories.filter((m) => m.category === category);
        }
      } else {
        memories = kernel.memory.list({ limit: 50, category: category || undefined });
      }
    }

    return c.html(MemoryPage({ memories, stats, query: q, category }));
  });

  // --- Sessions Page ---

  app.get("/sessions", (c) => {
    const sessions = listRecentSessions(kernel.database, 50);
    return c.html(SessionsListPage({ sessions }));
  });

  app.get("/sessions/:id", (c) => {
    const id = c.req.param("id");
    const data = getSessionWithMessages(kernel.database, id);
    if (!data) {
      return c.text("Session not found", 404);
    }
    return c.html(SessionDetailPage({ session: data.session, messages: data.messages }));
  });

  // --- Skills Page ---

  app.get("/skills", (c) => {
    const skills = kernel.skills.getAllSkills();
    const totalTools = skills.reduce((sum, s) => sum + s.toolNames.length, 0);
    const success = c.req.query("success") ? "Skill updated successfully." : undefined;
    return c.html(SkillsPage({ skills, totalTools, success }));
  });

  // --- MCP Page ---

  app.get("/mcp", (c) => {
    const servers = kernel.mcpManager.getServerInfo();
    const success = c.req.query("success") ? "MCP server added and connected successfully." : undefined;
    const error = c.req.query("error") ?? undefined;
    return c.html(MCPPage({ servers, success, error }));
  });

  // --- API ---

  // Skills API
  app.get("/api/skills", (c) => {
    return c.json({ skills: kernel.skills.getAllSkills() });
  });

  app.post("/api/skills/:name/toggle", async (c) => {
    const name = decodeURIComponent(c.req.param("name"));
    const body = await c.req.json<{ alwaysActive: boolean }>();
    const skill = kernel.skills.getSkill(name);
    if (!skill) return c.json({ error: "Skill not found" }, 404);
    kernel.skills.setAlwaysActive(name, body.alwaysActive);
    saveConfigOverrides({ skills: kernel.skills.toOverrides() });
    return c.json({ ok: true });
  });

  app.post("/api/skills/:name/description", async (c) => {
    const name = decodeURIComponent(c.req.param("name"));
    const body = await c.req.json<{ description: string }>();
    const skill = kernel.skills.getSkill(name);
    if (!skill) return c.json({ error: "Skill not found" }, 404);
    kernel.skills.setDescription(name, body.description);
    saveConfigOverrides({ skills: kernel.skills.toOverrides() });
    return c.json({ ok: true });
  });

  app.get("/api/status", async (c) => {
    const health = await kernel.healthCheck();
    return c.json({
      ok: Object.values(health).every((h) => h.ok),
      uptime: process.uptime(),
      provider: config.provider,
      plugins: kernel.pluginNames,
      health,
    });
  });

  app.get("/api/memory/stats", (c) => {
    if (!kernel.memory) {
      return c.json({ enabled: false }, 200);
    }
    return c.json({ enabled: true, ...kernel.memory.getStats() });
  });

  app.get("/api/memory/search", async (c) => {
    if (!kernel.memory) {
      return c.json({ error: "Memory system disabled" }, 400);
    }
    const q = c.req.query("q") ?? "";
    const scope = c.req.query("scope");
    const category = c.req.query("category");
    const limit = parseInt(c.req.query("limit") ?? "20", 10);

    if (!q) {
      const memories = kernel.memory.list({ limit, category: category || undefined });
      return c.json({ memories });
    }

    const results = await kernel.memory.recall(q, { limit, scope: scope || undefined });
    return c.json({ memories: results });
  });

  app.delete("/api/memory/:id", (c) => {
    if (!kernel.memory) {
      return c.json({ error: "Memory system disabled" }, 400);
    }
    const id = c.req.param("id");
    const deleted = kernel.memory.forget(id);
    return c.json({ deleted });
  });

  app.post("/api/memory", async (c) => {
    if (!kernel.memory) {
      return c.json({ error: "Memory system disabled" }, 400);
    }

    const contentType = c.req.header("Content-Type") ?? "";
    let text: string;
    let category: string;
    let scope: string;

    if (contentType.includes("application/json")) {
      const body = await c.req.json<{ text: string; category?: string; scope?: string }>();
      text = body.text;
      category = body.category ?? "fact";
      scope = body.scope ?? "global";
    } else {
      const body = await c.req.parseBody();
      text = String(body.text ?? "");
      category = String(body.category ?? "fact");
      scope = String(body.scope ?? "global");
    }

    if (!text.trim()) {
      return c.json({ error: "Text is required" }, 400);
    }

    const id = await kernel.memory.store(text.trim(), {
      scope,
      category: category as "fact" | "preference" | "decision" | "summary",
      source: "web-ui",
    });

    // Redirect back to memory page for form submissions
    if (!contentType.includes("application/json")) {
      return c.redirect("/memory?success=1");
    }
    return c.json({ id });
  });

  app.get("/api/cron/jobs", (c) => {
    const jobs = kernel.cron?.listJobs() ?? [];
    return c.json({ jobs });
  });

  app.post("/api/cron/jobs", async (c) => {
    if (!kernel.cron) {
      return c.json({ error: "Cron system disabled" }, 400);
    }

    const contentType = c.req.header("Content-Type") ?? "";
    let name: string;
    let expression: string;
    let actionType: string;
    let payload: string;

    if (contentType.includes("application/json")) {
      const body = await c.req.json<{ name: string; expression: string; actionType: string; payload: string }>();
      name = body.name;
      expression = body.expression;
      actionType = body.actionType;
      payload = body.payload;
    } else {
      const body = await c.req.parseBody();
      name = String(body.name ?? "");
      expression = String(body.expression ?? "");
      actionType = String(body.actionType ?? "prompt");
      payload = String(body.payload ?? "");
    }

    if (!name.trim() || !expression.trim() || !payload.trim()) {
      const jobs = kernel.cron.listJobs();
      if (!contentType.includes("application/json")) {
        return c.html(CronPage({ jobs, error: "All fields are required" }));
      }
      return c.json({ error: "All fields are required" }, 400);
    }

    if (!isValidCron(expression.trim())) {
      const jobs = kernel.cron.listJobs();
      if (!contentType.includes("application/json")) {
        return c.html(CronPage({ jobs, error: "Invalid cron expression" }));
      }
      return c.json({ error: "Invalid cron expression" }, 400);
    }

    const action: Record<string, unknown> = { type: actionType };
    if (actionType === "prompt") action.prompt = payload;
    else if (actionType === "tool") action.tool = payload;
    else if (actionType === "event") action.event = payload;

    const id = kernel.cron.addJob({
      name: name.trim(),
      expression: expression.trim(),
      action: action as any,
    });

    if (!contentType.includes("application/json")) {
      return c.redirect("/cron");
    }
    return c.json({ id }, 201);
  });

  app.delete("/api/cron/jobs/:id", (c) => {
    if (!kernel.cron) {
      return c.json({ error: "Cron system disabled" }, 400);
    }
    const id = c.req.param("id");
    const removed = kernel.cron.removeJob(id);
    return c.json({ removed });
  });

  app.post("/api/cron/jobs/:id/enable", (c) => {
    if (!kernel.cron) {
      return c.json({ error: "Cron system disabled" }, 400);
    }
    const id = c.req.param("id");
    const enabled = kernel.cron.enableJob(id);
    return c.json({ enabled });
  });

  app.post("/api/cron/jobs/:id/disable", (c) => {
    if (!kernel.cron) {
      return c.json({ error: "Cron system disabled" }, 400);
    }
    const id = c.req.param("id");
    const disabled = kernel.cron.disableJob(id);
    return c.json({ disabled });
  });

  app.post("/api/chat", async (c) => {
    try {
      const body = await c.req.json<{ sessionId: string; message: string }>();
      if (!body.message?.trim()) {
        return c.json({ error: "Message is required" }, 400);
      }

      const sessionId = body.sessionId || `web-${Date.now()}`;

      // Create a promise that resolves when the outbound message arrives
      const responsePromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Response timeout"));
        }, 120_000);

        const handler = (outbound: { sessionId: string; content: string }) => {
          if (outbound.sessionId === sessionId) {
            clearTimeout(timeout);
            kernel.eventBus.off("message:outbound", handler);
            resolve(outbound.content);
          }
        };
        kernel.eventBus.on("message:outbound", handler);
      });

      // Emit the inbound message (fire-and-forget so errors flow through the bus)
      kernel.eventBus.emit("message:inbound", {
        id: crypto.randomUUID(),
        sessionId,
        channel: "web",
        content: body.message.trim(),
        user: { id: "web-user", name: "Web User" },
        timestamp: new Date().toISOString(),
      }).catch((err) => {
        // If handleInbound throws before emitting outbound, resolve the promise with the error
        kernel.eventBus.emit("message:outbound", {
          sessionId,
          channel: "web",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        } as any);
      });

      const response = await responsePromise;
      return c.json({ sessionId, response });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // --- MCP API ---

  app.post("/api/mcp/servers", async (c) => {
    const contentType = c.req.header("Content-Type") ?? "";
    let name: string;
    let transport: string;
    let command: string;
    let args: string;
    let url: string;
    let envStr: string;

    if (contentType.includes("application/json")) {
      const body = await c.req.json<Record<string, string>>();
      name = body.name ?? "";
      transport = body.transport ?? "stdio";
      command = body.command ?? "";
      args = body.args ?? "";
      url = body.url ?? "";
      envStr = body.env ?? "";
    } else {
      const body = await c.req.parseBody();
      name = String(body.name ?? "");
      transport = String(body.transport ?? "stdio");
      command = String(body.command ?? "");
      args = String(body.args ?? "");
      url = String(body.url ?? "");
      envStr = String(body.env ?? "");
    }

    name = name.trim();
    if (!name) {
      if (!contentType.includes("application/json")) {
        return c.redirect("/mcp?error=" + encodeURIComponent("Server name is required"));
      }
      return c.json({ error: "Server name is required" }, 400);
    }

    // Build the server config
    const serverConfig: Record<string, unknown> = { transport };
    if (command.trim()) serverConfig.command = command.trim();
    if (args.trim()) serverConfig.args = args.trim().split(/\s+/);
    if (url.trim()) serverConfig.url = url.trim();

    // Parse env vars (KEY=VALUE per line)
    if (envStr.trim()) {
      const env: Record<string, string> = {};
      for (const line of envStr.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) {
          env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }
      if (Object.keys(env).length > 0) serverConfig.env = env;
    }

    // Persist to config file
    const existing = (await import("../config/writer.js")).readConfigOverrides();
    const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
    mcpServers[name] = serverConfig;
    existing.mcpServers = mcpServers;
    (await import("../config/writer.js")).saveConfigOverrides(existing);

    // Live-connect the server
    try {
      await kernel.mcpManager.connectServer(name, serverConfig as any);
      const tools = await kernel.mcpManager.discoverTools(name);
      if (tools.length > 0) {
        kernel.registerTools(tools);
      }
    } catch (err) {
      // Connection failed but config is saved - user can retry
    }

    if (!contentType.includes("application/json")) {
      return c.redirect("/mcp?success=1");
    }
    return c.json({ ok: true, name }, 201);
  });

  app.delete("/api/mcp/servers/:name", async (c) => {
    const name = c.req.param("name");

    // Disconnect live server
    await kernel.mcpManager.disconnectServer(name);

    // Remove from config file
    const existing = (await import("../config/writer.js")).readConfigOverrides();
    const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
    delete mcpServers[name];
    existing.mcpServers = mcpServers;
    (await import("../config/writer.js")).saveConfigOverrides(existing);

    return c.json({ removed: true });
  });

  app.post("/api/mcp/servers/:name/reconnect", async (c) => {
    const name = c.req.param("name");

    // Read config for this server
    const existing = (await import("../config/writer.js")).readConfigOverrides();
    const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
    const serverConfig = mcpServers[name] as Record<string, unknown> | undefined;

    if (!serverConfig) {
      return c.json({ error: "Server not found in config" }, 404);
    }

    // Disconnect first, then reconnect
    await kernel.mcpManager.disconnectServer(name);
    await kernel.mcpManager.connectServer(name, serverConfig as any);
    const tools = await kernel.mcpManager.discoverTools(name);
    if (tools.length > 0) {
      kernel.registerTools(tools);
    }

    return c.json({ reconnected: true });
  });

  app.get("/api/health", async (c) => {
    const health = await kernel.healthCheck();
    const allOk = Object.values(health).every((h) => h.ok);
    return c.json({ ok: allOk, checks: health }, allOk ? 200 : 503);
  });

  app.get("/api/sessions", (c) => {
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const sessions = listRecentSessions(kernel.database, limit);
    return c.json({ sessions });
  });

  app.delete("/api/sessions/:id", (c) => {
    const id = c.req.param("id");
    const deleted = deleteSession(kernel.database, id);
    if (!deleted) return c.json({ error: "Session not found" }, 404);
    return c.json({ deleted: true });
  });

  app.put("/api/sessions/:id/title", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ title: string }>();
    if (!body.title?.trim()) return c.json({ error: "Title is required" }, 400);
    const updated = updateSessionTitle(kernel.database, id, body.title.trim());
    if (!updated) return c.json({ error: "Session not found" }, 404);
    return c.json({ updated: true });
  });

  app.get("/api/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    const data = getSessionWithMessages(kernel.database, id);
    if (!data) return c.json({ error: "Session not found" }, 404);
    return c.json({ session: data.session, messages: data.messages });
  });

  return app;
}
