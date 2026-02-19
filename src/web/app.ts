import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { setCookie, getCookie } from "hono/cookie";
import { resolve, relative, extname } from "node:path";
import { existsSync, statSync, readdirSync, watch, mkdirSync, rmSync, realpathSync } from "node:fs";
import { DashboardPage } from "./views/dashboard.js";
import { ConfigPage } from "./views/config-page.js";
import { ChatPage, getChatScript } from "./views/chat.js";
// canvas-page.tsx removed — canvas is now merged into chat
import { CronPage } from "./views/cron-page.js";
import { MemoryPage } from "./views/memory-page.js";
import { SessionsListPage, SessionDetailPage } from "./views/sessions-page.js";
import { MCPPage } from "./views/mcp-page.js";
import { SkillsPage } from "./views/skills-page.js";
import { LoginPage } from "./views/login-page.js";
import { TotpSetupPage } from "./views/totp-setup-page.js";
import { readConfigOverrides, saveConfigOverrides } from "../config/writer.js";
import { listRecentSessions, getSessionWithMessages, deleteSession, updateSessionTitle } from "../store/sessions.js";
import { isValidCron } from "../cron/parser.js";
import { createSecurityHeaders } from "./middleware/security-headers.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { WebAuthManager } from "../security/web-auth.js";
import { RateLimiter } from "../security/rate-limiter.js";
import { buildOtpauthUri } from "../security/totp.js";
import { parseUploadedFiles } from "./file-parser.js";
import type { Kernel } from "../kernel/kernel.js";
import type { PawConfig } from "../types/config.js";
import type { Database } from "bun:sqlite";

// Fields that cannot be modified through the web config form
const BLOCKED_CONFIG_FIELDS = new Set([
  "ai.apiKey",
  "openai.apiKey",
  "gemini.apiKey",
  "slack.botToken",
  "slack.appToken",
  "slack.signingSecret",
  "web.authToken",
]);

export function createWebApp(kernel: Kernel, config: PawConfig, db?: Database): Hono {
  const app = new Hono();
  const database = db ?? kernel.database;

  // --- Auth Manager ---
  const authManager = new WebAuthManager(database, {
    maxAgeMinutes: config.web.session.maxAgeMinutes,
    idleTimeoutMinutes: config.web.session.idleTimeoutMinutes,
  });

  // --- Login rate limiter (5 attempts/min per IP) ---
  const loginRateLimiter = new RateLimiter(5);

  // --- Middleware Stack ---

  // Request logging
  app.use("*", honoLogger());

  // Security headers
  app.use("*", createSecurityHeaders(config.web.tls.enabled));

  // Body size limit (5MB)
  app.use("*", bodyLimit({ maxSize: 5 * 1024 * 1024 }));

  // CSRF protection — skip for Bearer token API calls
  app.use("*", async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return next();
    }
    // Skip CSRF for GET/HEAD/OPTIONS
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      return next();
    }
    return csrf({ origin: (origin) => origin !== "" })(c, next);
  });

  // Session auth middleware
  app.use("*", createAuthMiddleware({
    authManager,
    bearerToken: config.web.authToken,
  }));

  // --- Auth Routes ---

  app.get("/login", (c) => {
    // If no admins exist, show the setup page
    if (!authManager.hasAdmins()) {
      return c.html(LoginPage({ setupMode: true }));
    }
    return c.html(LoginPage({}));
  });

  app.post("/login", async (c) => {
    const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";

    // Rate limit check
    const { allowed } = loginRateLimiter.check(ip);
    if (!allowed) {
      return c.html(LoginPage({ error: "Too many login attempts. Please wait a minute." }));
    }

    const body = await c.req.parseBody();
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");
    const totpCode = body.totp ? String(body.totp) : undefined;

    if (!username || !password) {
      return c.html(LoginPage({ error: "Username and password are required" }));
    }

    const result = await authManager.login(username, password, totpCode, ip);

    if (result.requireTotp) {
      return c.html(LoginPage({ requireTotp: true, error: "Please enter your authenticator code" }));
    }

    if (!result.success) {
      return c.html(LoginPage({ error: result.error }));
    }

    setCookie(c, "paw_session", result.token!, {
      httpOnly: true,
      secure: config.web.tls.enabled,
      sameSite: "Lax",
      path: "/",
      maxAge: config.web.session.maxAgeMinutes * 60,
    });

    return c.redirect("/");
  });

  // First-time admin setup (only works when no admins exist)
  app.post("/login/setup", async (c) => {
    if (authManager.hasAdmins()) {
      return c.redirect("/login");
    }

    const body = await c.req.parseBody();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    const confirmPassword = String(body.confirm_password ?? "");

    if (!username) {
      return c.html(LoginPage({ setupMode: true, error: "Username is required" }));
    }
    if (password.length < 8) {
      return c.html(LoginPage({ setupMode: true, error: "Password must be at least 8 characters" }));
    }
    if (password !== confirmPassword) {
      return c.html(LoginPage({ setupMode: true, error: "Passwords do not match" }));
    }

    try {
      const adminId = await authManager.createAdmin(username, password);
      const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
      authManager.audit.log("admin.created", adminId, { username, via: "web-setup" }, ip);

      // Auto-login after setup
      const token = authManager.createSession(adminId, ip);
      setCookie(c, "paw_session", token, {
        httpOnly: true,
        secure: config.web.tls.enabled,
        sameSite: "Lax",
        path: "/",
        maxAge: config.web.session.maxAgeMinutes * 60,
      });

      return c.redirect("/login/totp-setup");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.html(LoginPage({ setupMode: true, error: message }));
    }
  });

  app.get("/logout", (c) => {
    const sessionToken = getCookie(c, "paw_session");
    if (sessionToken) {
      const session = authManager.validateSession(sessionToken);
      authManager.logout(sessionToken, session?.user_id);
    }
    setCookie(c, "paw_session", "", {
      httpOnly: true,
      secure: config.web.tls.enabled,
      sameSite: "Lax",
      path: "/",
      maxAge: 0,
    });
    return c.redirect("/login");
  });

  // --- TOTP Setup Routes ---

  app.get("/login/totp-setup", (c) => {
    const session = c.get("session") as { user_id: number } | undefined;
    const admin = c.get("admin") as { id: number; username: string; totp_secret: string | null; totp_verified: number } | undefined;

    if (!session || !admin) {
      return c.redirect("/login");
    }

    // Generate a new secret if none exists or not yet verified
    let secret = admin.totp_secret;
    if (!secret || admin.totp_verified === 0) {
      secret = authManager.setupTotp(admin.id);
    }

    const otpauthUriStr = buildOtpauthUri(secret, "Paw", admin.username);
    return c.html(TotpSetupPage({ secret, otpauthUri: otpauthUriStr }));
  });

  app.post("/login/totp-setup", async (c) => {
    const session = c.get("session") as { user_id: number } | undefined;
    const admin = c.get("admin") as { id: number; username: string; totp_secret: string | null } | undefined;

    if (!session || !admin) {
      return c.redirect("/login");
    }

    const body = await c.req.parseBody();
    const code = String(body.code ?? "");

    if (!code || code.length !== 6) {
      const secret = admin.totp_secret ?? authManager.setupTotp(admin.id);
      const otpauthUriStr = buildOtpauthUri(secret, "Paw", admin.username);
      return c.html(TotpSetupPage({ secret, otpauthUri: otpauthUriStr, error: "Please enter a valid 6-digit code" }));
    }

    const verified = authManager.verifyAndEnableTotp(admin.id, code);
    if (!verified) {
      const secret = admin.totp_secret ?? "";
      const otpauthUriStr = buildOtpauthUri(secret, "Paw", admin.username);
      return c.html(TotpSetupPage({ secret, otpauthUri: otpauthUriStr, error: "Invalid code. Make sure your authenticator app time is synchronized." }));
    }

    return c.redirect("/");
  });

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
        // Block sensitive fields
        if (BLOCKED_CONFIG_FIELDS.has(key)) {
          return c.html(ConfigPage({ config: liveConfig(), error: `Field "${key}" cannot be modified through the web UI` }));
        }

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

      // Audit log config changes
      const session = c.get("session") as { user_id: number } | undefined;
      const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
      authManager.audit.log("config.update", session?.user_id ?? null, { fields: Object.keys(body) }, ip);

      saveConfigOverrides(overrides);
      return c.html(ConfigPage({ config: liveConfig(), saved: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.html(ConfigPage({ config: liveConfig(), error: message }));
    }
  });

  app.get("/chat", (c) => {
    const sessionId = c.req.query("session") || crypto.randomUUID();
    return c.html(ChatPage({ sessionId }));
  });

  app.get("/js/chat.js", (c) => {
    c.header("Content-Type", "application/javascript; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    return c.body(getChatScript());
  });

  // Serve static files from public directory
  app.get("/paw-logo.jpg", async (c) => {
    const logoPath = resolve(import.meta.dir, "public/paw-logo.jpg");
    if (!existsSync(logoPath)) return c.text("Not found", 404);
    const file = Bun.file(logoPath);
    c.header("Content-Type", "image/jpeg");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(await file.arrayBuffer());
  });

  // --- Canvas ---

  const canvasRoot = resolve(config.web.canvas?.root ?? "./data/canvas");

  // In-memory event buffer for canvas polling (replaces SSE which Bun can't sustain)
  const canvasEvents = new Map<string, Array<{ id: number; event: string; data: unknown; ts: number }>>();
  const canvasSessionLastAccess = new Map<string, number>(); // tracks last poll time per session
  let canvasEventSeq = 0;
  const CANVAS_EVENT_TTL = 60_000; // events expire after 60s
  const CANVAS_MAX_EVENTS = 200;
  const CANVAS_SESSION_TTL = 60 * 60_000; // abandon sessions after 1 hour of inactivity

  function pushCanvasEvent(sessionId: string, event: string, data: unknown) {
    if (!canvasEvents.has(sessionId)) canvasEvents.set(sessionId, []);
    const buf = canvasEvents.get(sessionId)!;
    buf.push({ id: ++canvasEventSeq, event, data, ts: Date.now() });
    // Batch prune: find first valid index, splice once
    const cutoff = Date.now() - CANVAS_EVENT_TTL;
    let pruneCount = 0;
    while (pruneCount < buf.length && (buf.length - pruneCount > CANVAS_MAX_EVENTS || buf[pruneCount].ts < cutoff)) {
      pruneCount++;
    }
    if (pruneCount > 0) buf.splice(0, pruneCount);
  }

  // Periodic cleanup of abandoned canvas sessions (every 5 minutes)
  const canvasCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - CANVAS_SESSION_TTL;
    for (const [sid, lastAccess] of canvasSessionLastAccess) {
      if (lastAccess < cutoff) {
        canvasEvents.delete(sid);
        canvasSessionLastAccess.delete(sid);
      }
    }
  }, 5 * 60_000);

  // Also push file-changed events to a global "__files__" channel
  // so the iframe preview reloads can poll it.
  function pushFileChanged(path: string) {
    pushCanvasEvent("__files__", "file-changed", { path });
    // Push to all active sessions too
    for (const sid of canvasEvents.keys()) {
      if (sid !== "__files__") {
        pushCanvasEvent(sid, "file-changed", { path });
      }
    }
  }

  // Watch canvas root for file changes (store watcher for cleanup)
  let canvasWatcher: ReturnType<typeof watch> | null = null;
  try {
    mkdirSync(canvasRoot, { recursive: true });
    canvasWatcher = watch(canvasRoot, { recursive: true }, (_evt, filename) => {
      if (filename) pushFileChanged(String(filename));
    });
  } catch { /* fs.watch may not be available */ }

  // Listen for AI outbound messages bound for canvas sessions
  kernel.eventBus.on("message:outbound", (outbound: { sessionId: string; content: string; channel?: string }) => {
    if (outbound.sessionId?.startsWith("canvas-")) {
      pushCanvasEvent(outbound.sessionId, "message", { content: outbound.content });
    }
  });

  // Canvas page routes removed — canvas is now integrated into the chat page

  app.post("/api/canvas/chat", async (c) => {
    if (!config.web.canvas?.enabled) {
      return c.json({ error: "Canvas is disabled" }, 400);
    }

    const body = await c.req.json<{ sessionId: string; message: string; images?: Array<{ data: string; mimeType: string }>; files?: Array<{ data: string; mimeType: string; name: string }> }>();
    if (!body.message?.trim() && !body.images?.length && !body.files?.length) {
      return c.json({ error: "Message is required" }, 400);
    }

    const sessionId = body.sessionId || "canvas-" + crypto.randomUUID();

    // Ensure event buffer exists for this session
    if (!canvasEvents.has(sessionId)) canvasEvents.set(sessionId, []);

    // Parse file attachments into text content for the AI
    const attachments: Array<{ type: "image" | "text"; data: Buffer; mimeType: string; name?: string }> = [];
    if (body.images) {
      for (const img of body.images) {
        attachments.push({
          type: "image" as const,
          data: Buffer.from(img.data, "base64"),
          mimeType: img.mimeType,
        });
      }
    }
    if (body.files) {
      const fileAttachments = await parseUploadedFiles(body.files);
      attachments.push(...fileAttachments);
    }

    // Build inline file content so the AI can reference it in the instruction text
    const fileContentSections: string[] = [];
    for (const att of attachments) {
      if (att.type === "text" && att.data) {
        const header = att.name ? `[File: ${att.name}]` : "[Attached file]";
        fileContentSections.push(header + "\n" + att.data.toString("utf-8"));
      }
    }

    // Prepend canvas instructions so the AI uses canvas_write
    const canvasInstruction = [
      "[CANVAS MODE] You are working in a live canvas environment.",
      "You MUST use the canvas_write tool to create/update files (HTML, CSS, JS).",
      "Files written with canvas_write appear in a live preview iframe immediately.",
      "Always start by writing an index.html file. Use canvas_read to check existing files.",
      "Do NOT use file_write — only canvas_write works for the live preview.",
      "Write complete, self-contained HTML files with inline CSS and JS when possible.",
      "",
      "User request: " + (body.message?.trim() || "(see attached files)"),
      ...(fileContentSections.length > 0 ? ["", "--- Attached Data ---", ...fileContentSections] : []),
    ].join("\n");

    // Fire-and-forget — response arrives via polling /api/canvas/events
    kernel.eventBus.emit("message:inbound", {
      id: crypto.randomUUID(),
      sessionId,
      channel: "canvas",
      content: canvasInstruction,
      attachments: attachments.length > 0 ? attachments : undefined,
      user: { id: "canvas-user", name: "Canvas User" },
      timestamp: new Date().toISOString(),
      metadata: { canvas: true },
    }).catch(() => {});

    return c.json({ sessionId }, 202);
  });

  // Polling endpoint — replaces SSE which Bun cannot sustain
  app.get("/api/canvas/events", (c) => {
    const sessionId = c.req.query("sessionId") || "__files__";
    const since = parseInt(c.req.query("since") || "0", 10);

    // Track last access for session cleanup
    canvasSessionLastAccess.set(sessionId, Date.now());

    const buf = canvasEvents.get(sessionId) || [];
    const events = buf.filter((e) => e.id > since);

    return c.json({ events });
  });

  app.post("/api/canvas/clear", (c) => {
    if (existsSync(canvasRoot)) {
      rmSync(canvasRoot, { recursive: true, force: true });
      mkdirSync(canvasRoot, { recursive: true });
    }
    // Clear all event buffers
    canvasEvents.clear();
    return c.json({ cleared: true });
  });

  app.get("/api/canvas/files", (c) => {
    if (!existsSync(canvasRoot)) {
      return c.json({ files: [] });
    }

    const files: Array<{ path: string; size: number }> = [];
    function walk(dir: string): void {
      if (files.length >= 200) return;
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".")) continue;
        const full = resolve(dir, item.name);
        if (item.isDirectory()) {
          walk(full);
        } else {
          files.push({ path: relative(canvasRoot, full), size: statSync(full).size });
        }
      }
    }
    walk(canvasRoot);
    return c.json({ files });
  });

  app.get("/api/canvas/preview/*", async (c) => {
    const reqPath = c.req.path.replace("/api/canvas/preview/", "").replace(/^\/+/, "") || "index.html";
    const decoded = decodeURIComponent(reqPath);
    const fullPath = resolve(canvasRoot, decoded);

    // Path traversal check (logical path)
    const rel = relative(canvasRoot, fullPath);
    if (rel.startsWith("..") || fullPath.includes("\0")) {
      return c.text("Forbidden", 403);
    }

    // Symlink check: resolve real path and verify it's within canvas root
    if (existsSync(fullPath)) {
      try {
        const realPath = realpathSync(fullPath);
        const realRel = relative(canvasRoot, realPath);
        if (realRel.startsWith("..")) {
          return c.text("Forbidden", 403);
        }
      } catch {
        return c.text("Forbidden", 403);
      }
    }

    if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) {
      // Return a placeholder page for index.html so the iframe isn't blank
      if (decoded === "index.html") {
        return c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
          body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center;
                 height: 100vh; margin: 0; color: #9ca3af; background: #fafbfc; }
          @media (prefers-color-scheme: dark) { body { background: #111113; color: #71717a; } }
          .placeholder { text-align: center; }
          .placeholder .icon { font-size: 48px; opacity: 0.3; margin-bottom: 12px; }
          .placeholder p { font-size: 15px; }
        </style></head><body><div class="placeholder"><div class="icon">🎨</div>
        <p>Canvas preview will appear here</p></div>
        </body></html>`);
      }
      return c.text("Not found", 404);
    }

    const ext = extname(fullPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".html": "text/html", ".htm": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff": "font/woff", ".woff2": "font/woff2",
      ".ttf": "font/ttf",
    };
    const contentType = mimeMap[ext] || "application/octet-stream";

    const file = Bun.file(fullPath);
    let content = await file.arrayBuffer();

    c.header("Content-Type", contentType);
    c.header("Cache-Control", "no-cache");
    return c.body(content);
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

  app.post("/api/skills/:name/tools/:tool/toggle", async (c) => {
    const skillName = decodeURIComponent(c.req.param("name"));
    const toolName = decodeURIComponent(c.req.param("tool"));
    const { enabled } = await c.req.json<{ enabled: boolean }>();
    const skill = kernel.skills.getSkill(skillName);
    if (!skill) return c.json({ error: "Skill not found" }, 404);
    kernel.skills.setToolEnabled(skillName, toolName, enabled);
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
      const body = await c.req.json<{
        sessionId: string;
        message: string;
        images?: Array<{ data: string; mimeType: string }>;
        files?: Array<{ data: string; mimeType: string; name: string }>;
      }>();
      if (!body.message?.trim()) {
        return c.json({ error: "Message is required" }, 400);
      }

      const sessionId = body.sessionId || crypto.randomUUID();

      // Convert uploaded images to Attachment[]
      const attachments: Array<{ type: "image" | "text"; data: Buffer; mimeType: string; name?: string }> = [];
      if (body.images) {
        for (const img of body.images) {
          attachments.push({
            type: "image" as const,
            data: Buffer.from(img.data, "base64"),
            mimeType: img.mimeType,
          });
        }
      }

      // Parse spreadsheet files into text attachments
      if (body.files) {
        const fileAttachments = await parseUploadedFiles(body.files);
        attachments.push(...fileAttachments);
      }

      // Build base64 data URIs for the user images so the UI can render them
      const userImages = body.images?.map((img: { data: string; mimeType: string }) => `data:${img.mimeType};base64,${img.data}`);

      // Create a promise that resolves when the outbound message arrives
      const responsePromise = new Promise<{ content: string; images?: string[] }>((resolve, reject) => {
        const handler = (outbound: { sessionId: string; content: string; attachments?: Array<{ type: string; data?: Buffer; mimeType?: string }> }) => {
          if (outbound.sessionId === sessionId) {
            clearTimeout(timeout);
            kernel.eventBus.off("message:outbound", handler);
            // Convert image attachments to base64 data URIs for the web UI
            const images = outbound.attachments
              ?.filter((a) => a.type === "image" && a.data && a.mimeType)
              .map((a) => `data:${a.mimeType};base64,${a.data!.toString("base64")}`);
            resolve({ content: outbound.content, images: images?.length ? images : undefined });
          }
        };

        const timeout = setTimeout(() => {
          kernel.eventBus.off("message:outbound", handler); // prevent listener leak
          reject(new Error("Response timeout"));
        }, 120_000);

        kernel.eventBus.on("message:outbound", handler);
      });

      // Emit the inbound message (fire-and-forget so errors flow through the bus)
      kernel.eventBus.emit("message:inbound", {
        id: crypto.randomUUID(),
        sessionId,
        channel: "web",
        content: body.message.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
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

      const result = await responsePromise;
      return c.json({
        sessionId,
        response: result.content,
        images: result.images,
        userImages: userImages?.length ? userImages : undefined,
      });
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

  // Expose authManager for kernel integration
  (app as any).__authManager = authManager;

  // Expose cleanup function for graceful shutdown (close watcher, clear intervals)
  (app as any).__cleanup = () => {
    canvasWatcher?.close();
    clearInterval(canvasCleanupInterval);
    canvasEvents.clear();
    canvasSessionLastAccess.clear();
  };

  return app;
}
