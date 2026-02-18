import { EventBus } from "./bus.js";
import { Sandbox } from "./sandbox.js";
import { discoverPlugins } from "./plugin-loader.js";
import { ClaudeProvider } from "../ai/provider.js";
import { OllamaProvider } from "../ai/ollama-provider.js";
import { OpenAIProvider } from "../ai/openai-provider.js";
import { GeminiProvider } from "../ai/gemini-provider.js";
import { ToolRegistry } from "../ai/tools.js";
import { buildSystemPrompt } from "../ai/system-prompt.js";
import type { AIProvider, ChatMessage } from "../ai/base-provider.js";
import type { ToolDefinition } from "../types/message.js";
import { getDb, closeDb } from "../store/db.js";
import { getOrCreateSession, getSession, updateSessionTitle } from "../store/sessions.js";
import { appendMessage, getSessionMessages } from "../store/messages.js";
import { MemoryStore } from "../memory/store.js";
import { createMemoryTools } from "../memory/tools.js";
import { extractMemories } from "../memory/auto-extract.js";
import { CronScheduler } from "../cron/scheduler.js";
import { HeartbeatChecker } from "../heartbeat/checker.js";
import { AccessController } from "../security/access-control.js";
import { RateLimiter } from "../security/rate-limiter.js";
import { createWebApp } from "../web/app.js";
import { startWebServer } from "../web/server.js";
import { MCPClientManager } from "../mcp/client-manager.js";
import { SkillManager } from "../ai/skills.js";
import { createFileTools } from "../tools/file-tools.js";
import { createExecTools } from "../tools/exec-tools.js";
import { createLogger, setLogLevel } from "../observability/logger.js";
import type { PawConfig } from "../types/config.js";
import type { ChannelPlugin, PluginContext, PluginStore } from "../types/plugin.js";
import type { InboundMessage } from "../types/message.js";
import type { Database } from "bun:sqlite";

export class Kernel {
  private bus: EventBus;
  private sandbox: Sandbox;
  private toolRegistry: ToolRegistry;
  private provider: AIProvider;
  private plugins: ChannelPlugin[] = [];
  private config: PawConfig;
  private db: Database;
  private memoryStore: MemoryStore | null = null;
  private cronScheduler: CronScheduler | null = null;
  private heartbeatChecker: HeartbeatChecker | null = null;
  private accessController: AccessController | null = null;
  private rateLimiter: RateLimiter | null = null;
  private webServer: { stop: () => void } | null = null;
  private mcpClientManager: MCPClientManager;
  private skillManager: SkillManager;
  private logger = createLogger("kernel");

  constructor(config: PawConfig) {
    this.config = config;
    setLogLevel(config.log.level);

    this.bus = new EventBus();
    this.toolRegistry = new ToolRegistry();
    this.sandbox = new Sandbox(createLogger("sandbox"));
    this.db = getDb(config.store.dbPath, config.store.customSqlitePath);

    // Security
    if (config.security.requireApproval) {
      this.accessController = new AccessController(this.db, createLogger("security"), {
        allowedUsers: config.security.allowedUsers,
        blockedUsers: config.security.blockedUsers,
        pairingCodeTtlMinutes: config.security.pairingCodeTtlMinutes,
      });
    }
    if (config.security.rateLimiting.enabled) {
      this.rateLimiter = new RateLimiter(config.security.rateLimiting.maxRequestsPerMinute);
    }

    const aiLogger = createLogger("ai");
    this.skillManager = new SkillManager();

    // Connect sandbox to tool registry for permission enforcement
    if (config.security.enforcePermissions) {
      this.toolRegistry.setSandbox(this.sandbox, true);
    }

    if (config.provider === "ollama") {
      this.provider = new OllamaProvider(config.ollama, this.toolRegistry, aiLogger, this.skillManager);
    } else if (config.provider === "openai") {
      this.provider = new OpenAIProvider(config.openai, this.toolRegistry, aiLogger, this.skillManager);
    } else if (config.provider === "gemini") {
      this.provider = new GeminiProvider(config.gemini, this.toolRegistry, aiLogger, this.skillManager);
    } else {
      this.provider = new ClaudeProvider(config.ai, this.toolRegistry, aiLogger, this.skillManager);
    }

    // Initialize memory system
    if (config.memory.enabled) {
      this.memoryStore = new MemoryStore(this.db, {
        vectorWeight: config.memory.vectorWeight,
        ftsWeight: config.memory.ftsWeight,
        embeddingModel: config.memory.embeddingModel,
      });
      this.toolRegistry.register(createMemoryTools(this.memoryStore));
      this.logger.info("Memory system initialized");
    }

    // Register file/exec tools
    if (config.workspace.path) {
      this.toolRegistry.register(createFileTools({
        workspacePath: config.workspace.path,
        maxFileSize: config.workspace.maxFileSize,
        maxOutputLength: config.workspace.maxOutputLength,
      }));
      this.toolRegistry.register(createExecTools({
        workspacePath: config.workspace.path,
        maxOutputLength: config.workspace.maxOutputLength,
        execTimeout: config.workspace.execTimeout,
        allowedCommands: config.workspace.allowedCommands,
      }));
      this.logger.info("File/exec tools registered");
    }

    // Initialize cron scheduler
    if (config.cron.enabled) {
      this.cronScheduler = new CronScheduler(
        this.db, this.bus, this.toolRegistry, createLogger("cron"), config.cron.tickIntervalMs,
      );
      this.cronScheduler.setPromptHandler(async (jobId, prompt) => {
        const sessionId = `cron-${jobId}-${Date.now()}`;
        await this.bus.emit("message:inbound", {
          id: crypto.randomUUID(),
          sessionId,
          channel: "cron",
          content: prompt,
          user: { id: "system", name: "Cron Scheduler" },
          timestamp: new Date().toISOString(),
        });
      });
      this.logger.info("Cron scheduler initialized");
    }

    this.mcpClientManager = new MCPClientManager(createLogger("mcp"));

    this.bus.on("message:inbound", (msg) => this.handleInbound(msg));
  }

  async boot(pluginsDir = "./plugins"): Promise<void> {
    this.logger.info("Booting kernel...", { provider: this.config.provider });

    const loaded = await discoverPlugins(pluginsDir, createLogger("loader"));

    for (const { plugin, manifest } of loaded) {
      this.sandbox.registerManifest(manifest);
      const ctx = this.createPluginContext(plugin.name);

      try {
        await plugin.register(ctx);
        this.plugins.push(plugin);
        this.logger.info("Plugin registered", { name: plugin.name });
      } catch (err) {
        this.logger.error("Plugin registration failed", { name: plugin.name, error: String(err) });
      }
    }

    for (const plugin of this.plugins) {
      try {
        await plugin.start();
        await this.bus.emit("plugin:started", { name: plugin.name });
        this.logger.info("Plugin started", { name: plugin.name });
      } catch (err) {
        this.logger.error("Plugin start failed", { name: plugin.name, error: String(err) });
        await this.bus.emit("plugin:error", { name: plugin.name, error: err as Error });
      }
    }

    // Connect MCP servers
    const mcpEntries = Object.entries(this.config.mcpServers ?? {});
    if (mcpEntries.length > 0) {
      for (const [name, serverConfig] of mcpEntries) {
        await this.mcpClientManager.connectServer(name, serverConfig);
        const tools = await this.mcpClientManager.discoverTools(name);
        if (tools.length > 0) {
          this.registerTools(tools);
          this.logger.info("MCP tools registered", { server: name, count: tools.length });
        }
      }
    }

    // Build skill catalog from all registered tools
    this.skillManager.buildFromRegistry(this.toolRegistry);
    try {
      const { readConfigOverrides } = await import("../config/writer.js");
      const overrides = readConfigOverrides();
      if (overrides.skills) {
        this.skillManager.applyOverrides(overrides.skills as Record<string, { description?: string; alwaysActive?: boolean }>);
      }
    } catch { /* no overrides */ }
    this.toolRegistry.register([this.skillManager.createActivateSkillTool()]);
    this.logger.info("Skills initialized", { skills: this.skillManager.skillNames });

    // Start cron scheduler after plugins
    this.cronScheduler?.start();

    // Start heartbeat after cron
    if (this.config.heartbeat.enabled && this.cronScheduler) {
      this.heartbeatChecker = new HeartbeatChecker({
        bus: this.bus,
        cronScheduler: this.cronScheduler,
        logger: createLogger("heartbeat"),
        config: this.config.heartbeat,
        healthCheckFn: () => this.healthCheck(),
        memoryStore: this.memoryStore,
        dbPath: this.config.store.dbPath,
      });
      this.heartbeatChecker.start();
    }

    // Start web UI
    if (this.config.web.enabled) {
      const webApp = createWebApp(this, this.config);
      this.webServer = startWebServer(webApp, {
        host: this.config.web.host,
        port: this.config.web.port,
      }, createLogger("web"));
      await this.bus.emit("web:started", { host: this.config.web.host, port: this.config.web.port });
    }

    await this.bus.emit("kernel:ready", undefined);
    this.logger.info("Kernel ready", { provider: this.config.provider, plugins: this.plugins.map((p) => p.name) });
  }

  private async handleInbound(msg: InboundMessage): Promise<void> {
    this.logger.info("Inbound message", { channel: msg.channel, sessionId: msg.sessionId, user: msg.user.id });

    // Rate limiting
    if (this.rateLimiter) {
      const { allowed, retryAfterMs } = this.rateLimiter.check(msg.user.id);
      if (!allowed) {
        this.logger.warn("Rate limited", { user: msg.user.id, retryAfterMs });
        await this.bus.emit("message:outbound", {
          sessionId: msg.sessionId, channel: msg.channel,
          content: `You're sending messages too fast. Please wait ${Math.ceil((retryAfterMs ?? 0) / 1000)} seconds.`,
          metadata: msg.metadata,
        });
        return;
      }
    }

    // Access control (pairing code system)
    if (this.accessController && !this.accessController.isUserApproved(msg.user.id, msg.channel)) {
      // Check if this message IS a pairing code
      const code = msg.content.trim();
      if (/^\d{6}$/.test(code) && this.accessController.verifyPairingCode(msg.user.id, code)) {
        await this.bus.emit("security:user-approved", { userId: msg.user.id });
        await this.bus.emit("message:outbound", {
          sessionId: msg.sessionId, channel: msg.channel,
          content: "Access granted! You can now chat with me.",
          metadata: msg.metadata,
        });
        return;
      }

      // Generate or retrieve pairing code
      const pairingCode = this.accessController.generatePairingCode(msg.user.id);
      await this.bus.emit("message:outbound", {
        sessionId: msg.sessionId, channel: msg.channel,
        content: `Hi! I don't recognize you yet. Please ask an admin to approve your access, or enter this pairing code: *${pairingCode}*`,
        metadata: msg.metadata,
      });
      return;
    }

    getOrCreateSession(this.db, msg.sessionId, msg.channel, msg.user.id);
    appendMessage(this.db, msg.sessionId, "user", msg.content);

    // Auto-generate session title from first user message
    const session = getSession(this.db, msg.sessionId);
    if (session && !session.title) {
      const title = msg.content.length > 80 ? msg.content.slice(0, 80) + "..." : msg.content;
      updateSessionTitle(this.db, msg.sessionId, title);
    }

    const history = getSessionMessages(this.db, msg.sessionId, this.config.store.messageHistoryLimit);
    const messages: ChatMessage[] = history.map((m) => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.content,
    }));

    // Attach images from the current inbound message to the last user message
    if (msg.attachments && msg.attachments.length > 0 && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "user") {
        lastMsg.attachments = msg.attachments;
      }
    }

    // Recall relevant memories and build system prompt
    let memoryContext: string | undefined;
    if (this.memoryStore) {
      try {
        const [userMemories, globalMemories] = await Promise.all([
          this.memoryStore.recall(msg.content, { limit: 3, scope: msg.user.id }),
          this.memoryStore.recall(msg.content, { limit: 3, scope: "global" }),
        ]);

        const allMemories = [...userMemories, ...globalMemories];
        const seen = new Set<string>();
        const unique = allMemories.filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });

        if (unique.length > 0) {
          memoryContext = unique
            .map((m) => `- [${m.metadata.category}] ${m.text}`)
            .join("\n");
          await this.bus.emit("memory:recalled", { query: msg.content, resultCount: unique.length });
          this.logger.debug("Injected memory context", { count: unique.length });
        }
      } catch (err) {
        this.logger.warn("Memory recall failed", { error: String(err) });
      }
    }

    // Re-read agent config from file so UI changes take effect without restart
    let agentName = this.config.agent.name;
    let agentPrompt = this.config.agent.systemPrompt;
    try {
      const { readConfigOverrides } = await import("../config/writer.js");
      const overrides = readConfigOverrides();
      const agentOverrides = overrides.agent as { name?: string; systemPrompt?: string } | undefined;
      if (agentOverrides?.name) agentName = agentOverrides.name;
      if (agentOverrides?.systemPrompt) agentPrompt = agentOverrides.systemPrompt;
    } catch { /* use boot-time config */ }

    const systemPrompt = buildSystemPrompt({
      agentName,
      customPrompt: agentPrompt || undefined,
      memoryContext,
      skillCatalog: this.skillManager.getCatalogPrompt(),
    });

    this.logger.info("System prompt built", {
      agentName,
      hasCustomPrompt: !!agentPrompt,
      promptLength: systemPrompt.length,
      promptPreview: systemPrompt.substring(0, 150),
    });

    try {
      const response = await this.provider.chat(messages, systemPrompt, msg.sessionId);
      appendMessage(this.db, msg.sessionId, "assistant", response.text);

      await this.bus.emit("message:outbound", {
        sessionId: msg.sessionId,
        channel: msg.channel,
        content: response.text,
        attachments: response.images?.map((img) => ({
          type: "image" as const,
          data: Buffer.from(img.base64, "base64"),
          mimeType: img.media_type,
        })),
        metadata: msg.metadata,
      });

      // Auto-extract memories from conversation
      if (this.memoryStore && this.config.memory.autoExtract) {
        this.autoExtractMemories(msg, response.text).catch((err) => {
          this.logger.warn("Auto-extract failed", { error: String(err) });
        });
      }
    } catch (err) {
      this.logger.error("AI provider error", { error: String(err) });
      const errStr = String(err);
      let userMessage: string;
      if (errStr.includes("429") || errStr.includes("rate_limit")) {
        userMessage = "I'm being rate-limited by the AI provider. Please wait a moment and try again.";
      } else if (errStr.includes("401") || errStr.includes("403") || errStr.includes("authentication")) {
        userMessage = "There's an authentication issue with the AI provider. Please check your API key configuration.";
      } else if (errStr.includes("timeout") || errStr.includes("ETIMEDOUT")) {
        userMessage = "The request timed out. Please try again in a moment.";
      } else {
        userMessage = "Sorry, I encountered an error processing your message. Please try again.";
      }
      await this.bus.emit("message:outbound", {
        sessionId: msg.sessionId,
        channel: msg.channel,
        content: userMessage,
        metadata: msg.metadata,
      });
    }
  }

  private async autoExtractMemories(msg: InboundMessage, response: string): Promise<void> {
    if (!this.memoryStore) return;

    const recentMessages: ChatMessage[] = [
      { role: "user", content: msg.content },
      { role: "assistant", content: response },
    ];

    const extracted = await extractMemories(this.provider, recentMessages);
    for (const text of extracted) {
      const id = await this.memoryStore.store(text, {
        scope: msg.user.id,
        category: "fact",
        source: `session:${msg.sessionId}`,
      });
      await this.bus.emit("memory:stored", { id, text, category: "fact" });
    }

    if (extracted.length > 0) {
      this.logger.info("Auto-extracted memories", { count: extracted.length, sessionId: msg.sessionId });
    }
  }

  private createPluginContext(pluginName: string): PluginContext {
    const logger = createLogger(pluginName);
    const pluginConfig = (this.config as Record<string, unknown>)[pluginName] ?? {};

    const store: PluginStore = {
      get: (key: string) => {
        const row = this.db.query<{ value: string }, [string, string]>(
          "SELECT value FROM plugin_kv WHERE plugin = ? AND key = ?",
        ).get(pluginName, key);
        return row ? JSON.parse(row.value) : undefined;
      },
      set: (key: string, value: unknown) => {
        this.db.run(
          "INSERT OR REPLACE INTO plugin_kv (plugin, key, value) VALUES (?, ?, ?)",
          [pluginName, key, JSON.stringify(value)],
        );
      },
      delete: (key: string) => {
        this.db.run("DELETE FROM plugin_kv WHERE plugin = ? AND key = ?", [pluginName, key]);
      },
    };

    return {
      bus: this.bus,
      registerTools: (tools) => this.toolRegistry.register(tools),
      logger,
      config: pluginConfig as Record<string, unknown>,
      store,
    };
  }

  async shutdown(): Promise<void> {
    this.logger.info("Shutting down...");
    this.webServer?.stop();
    this.heartbeatChecker?.stop();
    this.cronScheduler?.stop();
    await this.mcpClientManager.disconnectAll();
    for (const plugin of this.plugins) {
      try {
        await plugin.stop();
        await this.bus.emit("plugin:stopped", { name: plugin.name });
      } catch (err) {
        this.logger.error("Plugin stop failed", { name: plugin.name, error: String(err) });
      }
    }
    await this.bus.emit("kernel:shutdown", undefined);
    this.bus.removeAllListeners();
    closeDb();
    this.logger.info("Shutdown complete");
  }

  async healthCheck(): Promise<Record<string, { ok: boolean; details?: string }>> {
    const results: Record<string, { ok: boolean; details?: string }> = {};
    for (const plugin of this.plugins) {
      try {
        results[plugin.name] = await plugin.health();
      } catch (err) {
        results[plugin.name] = { ok: false, details: String(err) };
      }
    }
    if (this.memoryStore) {
      const stats = this.memoryStore.getStats();
      results["memory"] = { ok: true, details: `${stats.totalMemories} memories stored` };
    }
    if (this.mcpClientManager.serverCount > 0) {
      results["mcp"] = {
        ok: this.mcpClientManager.connectedCount > 0,
        details: `${this.mcpClientManager.connectedCount}/${this.mcpClientManager.serverCount} servers connected`,
      };
    }
    return results;
  }

  get pluginNames(): string[] {
    return this.plugins.map((p) => p.name);
  }

  get skills(): SkillManager {
    return this.skillManager;
  }

  get eventBus(): EventBus {
    return this.bus;
  }

  get memory(): MemoryStore | null {
    return this.memoryStore;
  }

  get database(): Database {
    return this.db;
  }

  get aiProvider(): AIProvider {
    return this.provider;
  }

  get cron(): CronScheduler | null {
    return this.cronScheduler;
  }

  get mcpManager(): MCPClientManager {
    return this.mcpClientManager;
  }

  registerTools(tools: ToolDefinition[]): void {
    // Auto-register sandbox manifests for MCP plugins so permission checks pass
    const seen = new Set<string>();
    for (const tool of tools) {
      if (tool.plugin.startsWith("mcp:") && !seen.has(tool.plugin)) {
        seen.add(tool.plugin);
        if (!this.sandbox.getManifest(tool.plugin)) {
          this.sandbox.registerManifest({
            name: tool.plugin,
            version: "1.0.0",
            description: `MCP server: ${tool.plugin.slice(4)}`,
            permissions: [tool.plugin],
          });
        }
      }
    }
    this.toolRegistry.register(tools);
  }
}
