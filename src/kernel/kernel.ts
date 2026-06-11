import { resolveProjectPath } from "../paths.js";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { EventBus } from "./bus.js";
import { Sandbox } from "./sandbox.js";
import { discoverPlugins } from "./plugin-loader.js";
import { ClaudeProvider } from "../ai/provider.js";
import { OllamaProvider } from "../ai/ollama-provider.js";
import { OpenAIProvider } from "../ai/openai-provider.js";
import { GeminiProvider } from "../ai/gemini-provider.js";
import { ToolRegistry } from "../ai/tools.js";
import { buildSystemPrompt } from "../ai/system-prompt.js";
import type {
	AIProvider,
	ChatMessage,
	StreamChunk,
} from "../ai/base-provider.js";
import type { ToolDefinition } from "../types/message.js";
import { compileBrandBrief, getActiveBrand } from "../store/brands.js";
import { getDb, closeDb } from "../store/db.js";
import { NotificationStore } from "../store/notifications.js";
import { getOrCreateSession, updateSessionTitle } from "../store/sessions.js";
import { appendMessage, getSessionMessages } from "../store/messages.js";
import { MemoryStore } from "../memory/store.js";
import { preloadEmbedder } from "../memory/embeddings.js";
import { createMemoryTools } from "../memory/tools.js";
import {
	extractMemories,
	storeExtractedMemories,
} from "../memory/auto-extract.js";
import { FeedbackStore } from "../feedback/store.js";
import { detectCorrection } from "../feedback/correction-detector.js";
import { ProviderRouter } from "../ai/router.js";
import { CostTracker, estimateTokens } from "../ai/cost-tracker.js";
import { ToolLog } from "../observability/tool-log.js";
import { createProactiveTriggerTools } from "../cron/trigger-tools.js";
import { CronScheduler } from "../cron/scheduler.js";
import { HeartbeatChecker } from "../heartbeat/checker.js";
import { AccessController } from "../security/access-control.js";
import { RateLimiter } from "../security/rate-limiter.js";
import { VaultManager } from "../security/vault.js";
import { createWebApp } from "../web/app.js";
import { startWebServer } from "../web/server.js";
import { MCPClientManager } from "../mcp/client-manager.js";
import { SkillManager } from "../ai/skills.js";
import { createFileTools } from "../tools/file-tools.js";
import { createExecTools } from "../tools/exec-tools.js";
import { createCanvasTools } from "../tools/canvas-tools.js";
import { createActionTools } from "../tools/action-tools.js";
import { readConfigOverrides } from "../config/writer.js";
import { createLogger, setLogLevel } from "../observability/logger.js";
import { AgentRegistry } from "../agents/registry.js";
import { createSpawnAgentTool } from "../agents/spawn-agent-tool.js";
import type { AgentDefinition, AgentRunResult } from "../agents/types.js";
import type { PawConfig } from "../types/config.js";
import type {
	ChannelPlugin,
	PluginContext,
	PluginStore,
} from "../types/plugin.js";
import type { InboundMessage } from "../types/message.js";
import type { Database } from "bun:sqlite";

export class Kernel {
	private bus: EventBus;
	private sandbox: Sandbox;
	private toolRegistry: ToolRegistry;
	private provider: AIProvider;
	private allProviders: Map<string, AIProvider> = new Map();
	private providerRouter: ProviderRouter | null = null;
	private costTracker: CostTracker | null = null;
	private toolLog: ToolLog | null = null;
	private activeAbortControllers: Map<string, AbortController> = new Map();
	private plugins: ChannelPlugin[] = [];
	private config: PawConfig;
	private db: Database;
	private vaultManager!: VaultManager;
	private memoryStore: MemoryStore | null = null;
	private feedbackStore: FeedbackStore | null = null;
	private cronScheduler: CronScheduler | null = null;
	private heartbeatChecker: HeartbeatChecker | null = null;
	private accessController: AccessController | null = null;
	private rateLimiter: RateLimiter | null = null;
	private webServer: { stop: () => void } | null = null;
	private webAppCleanup: (() => void) | null = null;
	private sessionCleanupInterval: ReturnType<typeof setInterval> | null = null;
	private mcpClientManager: MCPClientManager;
	private strapiClient:
		| import("../integrations/strapi/client.js").StrapiClient
		| null = null;
	hubspotClient:
		| import("../integrations/hubspot/client.js").HubSpotClient
		| null = null;
	private githubClient:
		| import("../integrations/github/client.js").GitHubClient
		| null = null;
	private githubApprovalsInstance:
		| import("../integrations/github/approvals.js").GitHubApprovals
		| null = null;
	private notificationStoreInstance!: NotificationStore;
	private githubReactorUnsub: (() => void) | null = null;
	private skillManager: SkillManager;
	private agentRegistry: AgentRegistry;
	private agentDepths = new Map<string, number>();
	private readonly maxAgentDepth = 3;
	private logger = createLogger("kernel");

	constructor(config: PawConfig) {
		this.config = config;
		setLogLevel(config.log.level);

		this.bus = new EventBus();
		this.toolRegistry = new ToolRegistry();
		this.sandbox = new Sandbox(createLogger("sandbox"));
		// Keep the DB on the persistent volume. When a relocated config home is
		// set (PAW_CONFIG_DIR, e.g. /data/.paw on Railway) but store.dbPath is
		// RELATIVE, it would otherwise resolve under the ephemeral app dir
		// (/app/data/paw.db) and reset every deploy. Co-locate it with config on
		// the volume. Absolute paths are honored unchanged.
		let dbPathSetting = config.store.dbPath;
		const persistentHome = process.env.PAW_CONFIG_DIR;
		if (persistentHome && !isAbsolute(dbPathSetting)) {
			dbPathSetting = join(persistentHome, basename(dbPathSetting));
		}
		const resolvedDbPath = resolveProjectPath(dbPathSetting);
		// Probe BEFORE opening (getDb creates the file): did the DB survive the
		// last deploy? Emitted as a plain-text banner so it shows even in log
		// views that strip structured attributes.
		let dbExisted = "NO — created fresh";
		try {
			if (existsSync(resolvedDbPath)) {
				dbExisted = `yes, ${Math.round(statSync(resolvedDbPath).size / 1024)}kb`;
			}
		} catch {
			/* ignore */
		}
		const resolvedCanvasRoot = resolveProjectPath(config.web.canvas.root);
		this.logger.info(
			`Storage: DB=${resolvedDbPath} (existed=${dbExisted}) | config=${process.env.PAW_CONFIG_DIR ?? "~/.paw"} | canvas=${resolvedCanvasRoot} | brand=${dirname(resolvedCanvasRoot)}/brand`,
		);
		if (!resolvedDbPath.startsWith("/data")) {
			this.logger.warn(
				`⚠️ DB path is not under /data — data will NOT persist across Railway deploys (path=${resolvedDbPath}, PAW_DB_PATH=${process.env.PAW_DB_PATH ?? "unset"})`,
			);
		}
		this.db = getDb(resolvedDbPath, config.store.customSqlitePath);
		// Persistence diagnostic: show exactly where the DB lives (expect
		// /data/paw.db on Railway) and whether prior rows survived a redeploy.
		try {
			const sessions = (
				this.db.query("SELECT COUNT(*) AS n FROM sessions").get() as {
					n: number;
				}
			).n;
			const messages = (
				this.db.query("SELECT COUNT(*) AS n FROM messages").get() as {
					n: number;
				}
			).n;
			this.logger.info("Database ready", {
				path: resolvedDbPath,
				sessions,
				messages,
			});
		} catch {
			this.logger.info("Database ready", { path: resolvedDbPath });
		}

		// Credential vault: decrypt web-managed secrets and overlay them onto the
		// live config BEFORE any subsystem (providers, plugins, MCP, Strapi,
		// HubSpot) reads its credentials. Vault values win over env/credentials
		// (resolution order: vault → env → defaults). Disabled-but-safe when
		// PAW_VAULT_KEY is unset — the app falls back to env/credentials.
		this.vaultManager = new VaultManager(this.db);
		this.vaultManager.overlayConfig(
			this.config as unknown as Record<string, unknown>,
		);
		this.logger.info(
			this.vaultManager.enabled
				? `Vault: enabled (${this.vaultManager.count()} encrypted secret(s))`
				: "Vault: disabled (PAW_VAULT_KEY unset — using env/credentials fallback)",
		);

		// Durable proactive-notification inbox (nav badge + canvas portrait).
		// onAdd fans every notification onto the bus so out-of-band senders
		// (Slack #ai-operations, the avatar) get one central hook.
		this.notificationStoreInstance = new NotificationStore(this.db, (n) => {
			void this.bus.emit("notification:created", n);
		});

		// H-NEW-4: register a built-in "kernel" manifest so the sandbox
		// can enforce permissions on built-in tools. Previously the
		// ToolRegistry skipped the check whenever tool.plugin === "kernel",
		// which meant file_*, exec_command, memory_*, and friends were
		// effectively un-sandboxed. The kernel manifest lists the full
		// surface so existing usage keeps working, but new permissions
		// require an explicit grant.
		this.sandbox.registerManifest({
			name: "kernel",
			version: "0.1.0",
			description: "Paw kernel built-in tools",
			permissions: [
				"file:read",
				"file:write",
				"exec",
				"memory:read",
				"memory:write",
				"memory:forget",
				"cron:create",
				"agent:spawn",
				"agent:delegate",
				"skill:activate",
				"canvas:read",
				"canvas:write",
			],
		});

		// Security
		if (config.security.requireApproval) {
			this.accessController = new AccessController(
				this.db,
				createLogger("security"),
				{
					allowedUsers: config.security.allowedUsers,
					blockedUsers: config.security.blockedUsers,
					pairingCodeTtlMinutes: config.security.pairingCodeTtlMinutes,
				},
			);
		}
		if (config.security.rateLimiting.enabled) {
			this.rateLimiter = new RateLimiter(
				config.security.rateLimiting.maxRequestsPerMinute,
			);
		}

		const aiLogger = createLogger("ai");
		this.skillManager = new SkillManager();
		this.agentRegistry = new AgentRegistry(createLogger("agents"));

		// Connect sandbox to tool registry for permission enforcement
		if (config.security.enforcePermissions) {
			this.toolRegistry.setSandbox(this.sandbox, true);
		}

		// ai.maxToolRoundtrips applies to ALL providers
		const maxRoundtrips = config.ai.maxToolRoundtrips;

		if (config.provider === "ollama") {
			this.provider = new OllamaProvider(
				{
					...config.ollama,
					maxToolRoundtrips: maxRoundtrips,
					// Bound Ollama generation length (it has no server-side cap
					// unless we send num_predict). Prevents a looping model from
					// streaming until OOM.
					maxTokens: config.ai.maxTokens,
				},
				this.toolRegistry,
				aiLogger,
				this.skillManager,
			);
		} else if (config.provider === "openai") {
			this.provider = new OpenAIProvider(
				{ ...config.openai, maxToolRoundtrips: maxRoundtrips },
				this.toolRegistry,
				aiLogger,
				this.skillManager,
			);
		} else if (config.provider === "gemini") {
			this.provider = new GeminiProvider(
				{ ...config.gemini, maxToolRoundtrips: maxRoundtrips },
				this.toolRegistry,
				aiLogger,
				this.skillManager,
			);
		} else {
			this.provider = new ClaudeProvider(
				config.ai,
				this.toolRegistry,
				aiLogger,
				this.skillManager,
			);
		}

		// Store the primary provider in the provider map
		this.allProviders.set(config.provider, this.provider);

		// Initialize all other configured providers for routing
		if (config.routing?.enabled) {
			this.initSecondaryProviders(config, aiLogger);
			this.providerRouter = new ProviderRouter({
				providers: this.allProviders,
				rules: config.routing.rules,
				defaultProvider: this.provider,
				logger: createLogger("router"),
			});
			this.logger.info("Provider router initialized", {
				providers: [...this.allProviders.keys()],
				rules: config.routing.rules.length,
			});
		}

		// Initialize cost tracker
		this.costTracker = new CostTracker(this.db);

		// Initialize tool-execution log. Captures every tool call (inputs,
		// outputs, duration, errors) for observability and audit.
		this.toolLog = new ToolLog(this.db);
		this.toolRegistry.setToolLog(this.toolLog);

		// Initialize memory system
		if (config.memory.enabled) {
			this.memoryStore = new MemoryStore(this.db, {
				vectorWeight: config.memory.vectorWeight,
				ftsWeight: config.memory.ftsWeight,
				embeddingModel: config.memory.embeddingModel,
			});
			this.toolRegistry.register(createMemoryTools(this.memoryStore));
			this.feedbackStore = new FeedbackStore(this.db, this.memoryStore);
			this.logger.info("Memory system initialized");

			// Warm up the embedding pipeline in the background so the first
			// user message doesn't pay model download + init latency.
			void preloadEmbedder(config.memory.embeddingModel).catch((err) => {
				this.logger.warn("Embedding preload failed", { error: String(err) });
			});
		}

		// Register file/exec tools
		if (config.workspace.path) {
			this.toolRegistry.register(
				createFileTools({
					workspacePath: config.workspace.path,
					maxFileSize: config.workspace.maxFileSize,
					maxOutputLength: config.workspace.maxOutputLength,
				}),
			);
			this.toolRegistry.register(
				createExecTools({
					workspacePath: config.workspace.path,
					maxOutputLength: config.workspace.maxOutputLength,
					execTimeout: config.workspace.execTimeout,
					allowedCommands: config.workspace.allowedCommands,
				}),
			);
			this.logger.info("File/exec tools registered");
		}

		// Register canvas tools
		if (config.web.canvas?.enabled) {
			const canvasRoot = resolveProjectPath(config.web.canvas.root);
			mkdirSync(canvasRoot, { recursive: true });
			// Register sandbox manifest so permission checks pass
			this.sandbox.registerManifest({
				name: "canvas",
				version: "1.0.0",
				description: "Live canvas workspace for HTML/CSS/JS preview",
				permissions: ["canvas"],
			});
			this.toolRegistry.register(
				createCanvasTools({ canvasRoot, database: this.database }),
			);
			// Canvas action tools: let the agent wire forms to real backends.
			this.toolRegistry.register(
				createActionTools({ database: this.database }),
			);
			this.logger.info("Canvas tools registered", { canvasRoot });
		}

		// Initialize cron scheduler
		if (config.cron.enabled) {
			this.cronScheduler = new CronScheduler(
				this.db,
				this.bus,
				this.toolRegistry,
				createLogger("cron"),
				config.cron.tickIntervalMs,
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
			this.cronScheduler.setAIProvider(this.provider);
			this.cronScheduler.setWorkspacePath(config.heartbeat.workspacePath);
			this.toolRegistry.register(
				createProactiveTriggerTools(this.cronScheduler),
			);

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
				this.logger.error("Plugin registration failed", {
					name: plugin.name,
					error: String(err),
				});
			}
		}

		// Start all plugins in parallel
		await Promise.allSettled(
			this.plugins.map(async (plugin) => {
				try {
					await plugin.start();
					await this.bus.emit("plugin:started", { name: plugin.name });
					this.logger.info("Plugin started", { name: plugin.name });
				} catch (err) {
					this.logger.error("Plugin start failed", {
						name: plugin.name,
						error: String(err),
					});
					await this.bus.emit("plugin:error", {
						name: plugin.name,
						error: err as Error,
					});
				}
			}),
		);

		// Connect MCP servers in parallel. n8n is a first-class integration whose
		// workflow endpoints are just authenticated MCP servers — merge them in as
		// synthetic entries (NOT persisted into config.mcpServers) so they ride the
		// same connect path + auth. Each becomes `n8n_<name>` → an `mcp__…` skill.
		const mcpServerMap: Record<
			string,
			import("../types/config.js").PawConfig["mcpServers"][string]
		> = { ...(this.config.mcpServers ?? {}) };
		const n8n = this.config.n8n;
		if (n8n?.enabled && n8n.token) {
			for (const ep of n8n.endpoints ?? []) {
				if (!ep?.name || !ep?.url) continue;
				const key = `n8n_${ep.name}`.replace(/[^a-zA-Z0-9_]/g, "_");
				mcpServerMap[key] = {
					transport: n8n.transport,
					url: ep.url,
					authToken: n8n.token,
				};
			}
		}
		const mcpEntries = Object.entries(mcpServerMap);
		if (mcpEntries.length > 0) {
			await Promise.allSettled(
				mcpEntries.map(async ([name, serverConfig]) => {
					await this.mcpClientManager.connectServer(name, serverConfig);
					const tools = await this.mcpClientManager.discoverTools(name);
					if (tools.length > 0) {
						this.registerTools(tools);
						this.logger.info("MCP tools registered", {
							server: name,
							count: tools.length,
						});
					}
				}),
			);
		}

		// Initialize Strapi integration
		if (this.config.strapi.enabled && this.config.strapi.token) {
			try {
				const { StrapiClient } = await import(
					"../integrations/strapi/client.js"
				);
				const { createStrapiTools } = await import(
					"../integrations/strapi/tools.js"
				);
				const client = new StrapiClient(this.config.strapi);
				this.strapiClient = client;
				this.sandbox.registerManifest({
					name: "strapi",
					version: "1.0.0",
					description: "Strapi CMS integration",
					permissions: ["strapi"],
				});
				this.toolRegistry.register(createStrapiTools(client));
				await this.bus.emit("strapi:ready", undefined);
				this.logger.info("Strapi integration initialized");
			} catch (err) {
				this.logger.warn("Strapi init failed — degrading gracefully", {
					error: String(err),
				});
				await this.bus.emit("strapi:error", { error: err as Error });
			}
		}

		// Initialize HubSpot CRM integration (routing target for canvas actions)
		if (this.config.hubspot?.enabled && this.config.hubspot.token) {
			try {
				const { HubSpotClient } = await import(
					"../integrations/hubspot/client.js"
				);
				this.hubspotClient = new HubSpotClient(this.config.hubspot);
				this.sandbox.registerManifest({
					name: "hubspot",
					version: "1.0.0",
					description: "HubSpot CRM integration",
					permissions: ["net:api.hubapi.com"],
				});
				this.logger.info("HubSpot integration initialized");
			} catch (err) {
				this.logger.warn("HubSpot init failed — degrading gracefully", {
					error: String(err),
				});
			}
		}

		// Initialize GitHub integration (App-authenticated; "build, with control")
		const gh = this.config.github;
		if (gh?.enabled && gh.appId && gh.privateKey && gh.installationId) {
			try {
				const { GitHubClient } = await import(
					"../integrations/github/client.js"
				);
				const { createGitHubTools } = await import(
					"../integrations/github/tools.js"
				);
				const { GitHubApprovals } = await import(
					"../integrations/github/approvals.js"
				);
				const { AuditLogger } = await import("../security/audit-log.js");
				const client = new GitHubClient(gh);
				this.githubClient = client;
				this.sandbox.registerManifest({
					name: "github",
					version: "1.0.0",
					description: "GitHub App integration",
					permissions: ["github:read", "github:write", "github:admin"],
				});
				const ghAudit = new AuditLogger(this.db);
				const ghAuditFn = (
					action: string,
					details: Record<string, unknown>,
				) => ghAudit.log(action, null, details);
				const approvals = new GitHubApprovals(this.db, client, ghAuditFn);
				this.githubApprovalsInstance = approvals;
				this.toolRegistry.register(
					createGitHubTools(client, { audit: ghAuditFn, approvals }),
				);
				// Reactor: webhook events → durable notifications (the agent
				// "has something for you"). Phase B adds CI auto-investigation.
				const { startGitHubReactor } = await import(
					"../integrations/github/reactor.js"
				);
				this.githubReactorUnsub = startGitHubReactor({
					bus: this.bus,
					notifications: this.notificationStoreInstance,
					client,
					autoInvestigateCi: gh.autoInvestigateCi,
					logger: this.logger,
				});
				this.logger.info("GitHub integration initialized", {
					repoAllowlist: gh.repoAllowlist.length,
				});
			} catch (err) {
				this.logger.warn("GitHub init failed — degrading gracefully", {
					error: String(err),
				});
			}
		}

		// Build skill catalog from all registered tools
		this.skillManager.buildFromRegistry(this.toolRegistry);
		try {
			const { readConfigOverrides } = await import("../config/writer.js");
			const overrides = readConfigOverrides();
			if (overrides.skills) {
				this.skillManager.applyOverrides(
					overrides.skills as Record<
						string,
						{ description?: string; alwaysActive?: boolean }
					>,
				);
			}
		} catch {
			/* no overrides */
		}
		this.toolRegistry.register([this.skillManager.createActivateSkillTool()]);
		this.logger.info("Skills initialized", {
			skills: this.skillManager.skillNames,
		});

		// Load agent presets from config (templates for spawn_agent)
		const agentEntries = Object.entries(this.config.agents ?? {});
		if (agentEntries.length > 0) {
			this.agentRegistry.loadFromConfig(
				this.config.agents as Record<string, Omit<AgentDefinition, "name">>,
			);
		}
		// Also load from config overrides (so web UI / file edits are picked up)
		try {
			const agentOverrides = readConfigOverrides().agents as
				| Record<string, Omit<AgentDefinition, "name">>
				| undefined;
			if (agentOverrides) {
				this.agentRegistry.loadFromConfig(agentOverrides);
			}
		} catch {
			/* no overrides */
		}

		// Register spawn_agent tool — always available for dynamic agent spawning
		this.toolRegistry.register([
			createSpawnAgentTool({
				agentRegistry: this.agentRegistry,
				skillManager: this.skillManager,
				agentDepths: this.agentDepths,
				maxAgentDepth: this.maxAgentDepth,
				runAgentTurn: (agent, task, parentSessionId) =>
					this.runAgentTurn(agent, task, parentSessionId),
				runAgentTurnStream: (agent, task, parentSessionId) =>
					this.runAgentTurnStream(agent, task, parentSessionId),
			}),
		]);
		// Rebuild skills so spawn_agent appears in the catalog
		this.skillManager.buildFromRegistry(this.toolRegistry);
		this.logger.info("Agent spawning initialized", {
			presets: this.agentRegistry.agentNames,
		});

		// Start cron scheduler after plugins
		this.cronScheduler?.start();

		// Start heartbeat after cron
		if (this.config.heartbeat.enabled && this.cronScheduler) {
			this.heartbeatChecker = new HeartbeatChecker({
				bus: this.bus,
				cronScheduler: this.cronScheduler,
				logger: createLogger("heartbeat"),
				config: {
					...this.config.heartbeat,
					memoryDecayRate: this.config.memory.decayRate,
					memoryDecayThresholdDays: this.config.memory.decayThresholdDays,
				},
				healthCheckFn: () => this.healthCheck(),
				memoryStore: this.memoryStore,
				dbPath: this.config.store.dbPath,
				database: this.db,
			});
			this.heartbeatChecker.start();
		}

		// Start web UI
		if (this.config.web.enabled) {
			const webApp = createWebApp(this, this.config);
			this.webAppCleanup = (webApp as any).__cleanup ?? null;
			this.webServer = startWebServer(
				webApp,
				{
					host: this.config.web.host,
					port: this.config.web.port,
				},
				createLogger("web"),
				this.config.web.tls,
			);

			// Periodic session cleanup (every 15 minutes)
			const authManager = (webApp as any).__authManager;
			if (authManager?.cleanExpiredSessions) {
				this.sessionCleanupInterval = setInterval(
					() => {
						try {
							authManager.cleanExpiredSessions();
						} catch {
							// Ignore cleanup errors
						}
					},
					15 * 60 * 1000,
				);
			}

			await this.bus.emit("web:started", {
				host: this.config.web.host,
				port: this.config.web.port,
			});
		}

		await this.bus.emit("kernel:ready", undefined);
		this.logger.info("Kernel ready", {
			provider: this.config.provider,
			plugins: this.plugins.map((p) => p.name),
		});
	}

	/**
	 * Run a scoped agent turn: creates a sub-session, activates agent-specific
	 * skills, builds the agent's system prompt, calls the AI provider, and
	 * returns the result. The parent session is NOT modified.
	 *
	 * Accepts either an agent name (looked up from registry) or an inline
	 * AgentDefinition for dynamic spawning.
	 */
	async runAgentTurn(
		agentOrName: string | AgentDefinition,
		task: string,
		parentSessionId: string,
	): Promise<AgentRunResult> {
		const agent =
			typeof agentOrName === "string"
				? this.agentRegistry.get(agentOrName)
				: agentOrName;
		if (!agent) {
			return {
				text: "",
				sessionId: "",
				ok: false,
				error: `Agent "${agentOrName}" not found`,
			};
		}
		const agentName = agent.name;

		const agentSessionId = `agent-${agentName}-${Date.now()}`;
		const agentDepth = (this.agentDepths.get(parentSessionId) ?? 0) + 1;
		this.agentDepths.set(agentSessionId, agentDepth);

		await this.bus.emit("agent:delegated", {
			agentName,
			parentSessionId,
			agentSessionId,
			task,
		});

		this.logger.info("Agent delegation started", {
			agent: agentName,
			agentSession: agentSessionId,
			parentSession: parentSessionId,
			depth: agentDepth,
		});

		// Create a session for the agent's work
		getOrCreateSession(this.db, agentSessionId, "agent", "system");
		updateSessionTitle(
			this.db,
			agentSessionId,
			`[${agentName}] ${task.slice(0, 80)}`,
		);
		appendMessage(this.db, agentSessionId, "user", task);

		// Activate the agent's declared skills on its session
		for (const skill of agent.skills) {
			this.skillManager.activateSkill(agentSessionId, skill);
		}

		// Build the agent's system prompt with memory context
		let memoryContext: string | undefined;
		const memoryScope = agent.memoryScope || "global";
		if (this.memoryStore) {
			try {
				const memories = await this.memoryStore.recall(task, {
					limit: 3,
					scope: memoryScope,
				});
				if (memories.length > 0) {
					memoryContext = memories
						.map((m) => `- id=${m.id} [${m.metadata.category}] ${m.text}`)
						.join("\n");
				}
			} catch (err) {
				this.logger.warn("Agent memory recall failed", {
					agent: agentName,
					error: String(err),
				});
			}
		}

		const systemPrompt = buildSystemPrompt({
			agentName: agent.name,
			customPrompt: agent.systemPrompt,
			memoryContext,
			skillCatalog: this.skillManager.getCatalogPrompt(),
			agentDepth,
			brandBrief: compileBrandBrief(getActiveBrand(this.database)),
		});

		const messages: ChatMessage[] = [{ role: "user", content: task }];
		const agentProvider = this.getProviderForAgent(agent);

		try {
			const response = await agentProvider.chat(
				messages,
				systemPrompt,
				agentSessionId,
			);
			const replyText = response.text || "";
			appendMessage(this.db, agentSessionId, "assistant", replyText);

			await this.bus.emit("agent:completed", {
				agentName,
				agentSessionId,
				ok: true,
			});

			this.logger.info("Agent delegation completed", {
				agent: agentName,
				agentSession: agentSessionId,
				responseLength: replyText.length,
			});

			// Clean up the agent's skill activations and depth tracking
			this.skillManager.clearSession(agentSessionId);
			this.agentDepths.delete(agentSessionId);

			return {
				text: replyText,
				sessionId: agentSessionId,
				ok: true,
			};
		} catch (err) {
			const error = String(err);
			this.logger.error("Agent delegation failed", {
				agent: agentName,
				agentSession: agentSessionId,
				error,
			});

			await this.bus.emit("agent:completed", {
				agentName,
				agentSessionId,
				ok: false,
				error,
			});

			this.skillManager.clearSession(agentSessionId);
			this.agentDepths.delete(agentSessionId);

			return {
				text: "",
				sessionId: agentSessionId,
				ok: false,
				error,
			};
		}
	}

	/**
	 * Streaming variant of runAgentTurn. Yields StreamChunks from the
	 * sub-agent's tool execution, prefixed with the agent name so the
	 * activity timeline can distinguish them. The generator's return
	 * value is the AgentRunResult.
	 */
	async *runAgentTurnStream(
		agentOrName: string | AgentDefinition,
		task: string,
		parentSessionId: string,
	): AsyncGenerator<StreamChunk, AgentRunResult> {
		const agent =
			typeof agentOrName === "string"
				? this.agentRegistry.get(agentOrName)
				: agentOrName;
		if (!agent) {
			return {
				text: "",
				sessionId: "",
				ok: false,
				error: `Agent "${agentOrName}" not found`,
			};
		}
		const agentName = agent.name;

		const agentSessionId = `agent-${agentName}-${Date.now()}`;
		const agentDepth = (this.agentDepths.get(parentSessionId) ?? 0) + 1;
		this.agentDepths.set(agentSessionId, agentDepth);
		const prefix = `[${agentName}] `;

		await this.bus.emit("agent:delegated", {
			agentName,
			parentSessionId,
			agentSessionId,
			task,
		});

		this.logger.info("Agent delegation started (stream)", {
			agent: agentName,
			agentSession: agentSessionId,
			parentSession: parentSessionId,
			depth: agentDepth,
		});

		getOrCreateSession(this.db, agentSessionId, "agent", "system");
		updateSessionTitle(
			this.db,
			agentSessionId,
			`[${agentName}] ${task.slice(0, 80)}`,
		);
		appendMessage(this.db, agentSessionId, "user", task);

		for (const skill of agent.skills) {
			this.skillManager.activateSkill(agentSessionId, skill);
		}

		let memoryContext: string | undefined;
		const memoryScope = agent.memoryScope || "global";
		if (this.memoryStore) {
			try {
				const memories = await this.memoryStore.recall(task, {
					limit: 3,
					scope: memoryScope,
				});
				if (memories.length > 0) {
					memoryContext = memories
						.map((m) => `- id=${m.id} [${m.metadata.category}] ${m.text}`)
						.join("\n");
				}
			} catch (err) {
				this.logger.warn("Agent memory recall failed (stream)", {
					agent: agentName,
					error: String(err),
				});
			}
		}

		const systemPrompt = buildSystemPrompt({
			agentName: agent.name,
			customPrompt: agent.systemPrompt,
			memoryContext,
			skillCatalog: this.skillManager.getCatalogPrompt(),
			agentDepth,
			brandBrief: compileBrandBrief(getActiveBrand(this.database)),
		});

		const messages: ChatMessage[] = [{ role: "user", content: task }];
		const agentProvider = this.getProviderForAgent(agent);

		try {
			let fullText = "";

			if (agentProvider.chatStream) {
				for await (const chunk of agentProvider.chatStream(
					messages,
					systemPrompt,
					agentSessionId,
				)) {
					// Collect text but don't forward text_delta to parent
					// (the parent agent will formulate its own response)
					if (chunk.type === "text_delta" && chunk.text) {
						fullText += chunk.text;
						continue;
					}

					// Skip done — the parent handles its own done
					if (chunk.type === "done") continue;

					// Prefix tool-related chunks with agent name
					if (chunk.type === "tool_start" || chunk.type === "tool_end") {
						yield {
							...chunk,
							toolName: chunk.toolName
								? prefix + chunk.toolName
								: chunk.toolName,
							toolSummary: chunk.toolSummary
								? prefix + chunk.toolSummary
								: chunk.toolSummary,
							toolId: chunk.toolId
								? `${agentName}-${chunk.toolId}`
								: chunk.toolId,
						};
						continue;
					}

					if (chunk.type === "roundtrip_start") {
						yield {
							...chunk,
							// Rewrite as a sub-step indicator
							type: "roundtrip_start",
							roundtrip: chunk.roundtrip,
						};
						continue;
					}

					if (chunk.type === "thinking") {
						yield chunk;
						continue;
					}

					if (chunk.type === "error") {
						yield chunk;
						continue;
					}
				}
			} else {
				// Provider doesn't support streaming — fall back to non-streaming
				const response = await agentProvider.chat(
					messages,
					systemPrompt,
					agentSessionId,
				);
				fullText = response.text || "";
			}

			appendMessage(this.db, agentSessionId, "assistant", fullText);

			await this.bus.emit("agent:completed", {
				agentName,
				agentSessionId,
				ok: true,
			});

			this.logger.info("Agent delegation completed (stream)", {
				agent: agentName,
				agentSession: agentSessionId,
				responseLength: fullText.length,
			});

			this.skillManager.clearSession(agentSessionId);
			this.agentDepths.delete(agentSessionId);

			return {
				text: fullText,
				sessionId: agentSessionId,
				ok: true,
			};
		} catch (err) {
			const error = String(err);
			this.logger.error("Agent delegation failed (stream)", {
				agent: agentName,
				agentSession: agentSessionId,
				error,
			});

			await this.bus.emit("agent:completed", {
				agentName,
				agentSessionId,
				ok: false,
				error,
			});

			this.skillManager.clearSession(agentSessionId);
			this.agentDepths.delete(agentSessionId);

			return {
				text: "",
				sessionId: agentSessionId,
				ok: false,
				error,
			};
		}
	}

	private async handleInbound(msg: InboundMessage): Promise<void> {
		this.logger.info("Inbound message", {
			channel: msg.channel,
			sessionId: msg.sessionId,
			user: msg.user.id,
		});

		// Internal system channels (cron, heartbeat) bypass rate limiting and access control
		const INTERNAL_CHANNELS = new Set(["cron", "heartbeat", "github"]);
		const isInternal = INTERNAL_CHANNELS.has(msg.channel);

		// Rate limiting (skip for internal channels)
		if (!isInternal && this.rateLimiter) {
			const { allowed, retryAfterMs } = this.rateLimiter.check(msg.user.id);
			if (!allowed) {
				this.logger.warn("Rate limited", { user: msg.user.id, retryAfterMs });
				await this.bus.emit("message:outbound", {
					sessionId: msg.sessionId,
					channel: msg.channel,
					content: `You're sending messages too fast. Please wait ${Math.ceil((retryAfterMs ?? 0) / 1000)} seconds.`,
					metadata: msg.metadata,
				});
				return;
			}
		}

		// Access control (pairing code system) — skip for internal channels
		if (
			!isInternal &&
			this.accessController &&
			!this.accessController.isUserApproved(msg.user.id, msg.channel)
		) {
			// Check if this message IS a pairing code
			const code = msg.content.trim();
			if (
				/^\d{6}$/.test(code) &&
				this.accessController.verifyPairingCode(msg.user.id, code)
			) {
				await this.bus.emit("security:user-approved", { userId: msg.user.id });
				await this.bus.emit("message:outbound", {
					sessionId: msg.sessionId,
					channel: msg.channel,
					content: "Access granted! You can now chat with me.",
					metadata: msg.metadata,
				});
				return;
			}

			// Generate or retrieve pairing code
			const pairingCode = this.accessController.generatePairingCode(
				msg.user.id,
			);
			await this.bus.emit("message:outbound", {
				sessionId: msg.sessionId,
				channel: msg.channel,
				content: `Hi! I don't recognize you yet. Please ask an admin to approve your access, or enter this pairing code: *${pairingCode}*`,
				metadata: msg.metadata,
			});
			return;
		}

		const session = getOrCreateSession(
			this.db,
			msg.sessionId,
			msg.channel,
			msg.user.id,
		);
		appendMessage(this.db, msg.sessionId, "user", msg.content);

		// Auto-generate session title from first user message
		if (!session.title) {
			const title =
				msg.content.length > 80
					? msg.content.slice(0, 80) + "..."
					: msg.content;
			updateSessionTitle(this.db, msg.sessionId, title);
		}

		const history = getSessionMessages(
			this.db,
			msg.sessionId,
			this.config.store.messageHistoryLimit,
		);
		const messages: ChatMessage[] = history.map((m) => ({
			role: m.role === "user" ? ("user" as const) : ("assistant" as const),
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
		if (this.memoryStore && msg.channel !== "canvas") {
			try {
				// Pre-compute the query embedding once and share it across the
				// two scoped recalls to halve the embedding CPU cost.
				const sharedEmbedding =
					(await this.memoryStore.embed(msg.content)) ?? undefined;
				// Per-admin memory isolation (C-NEW-1): each admin only sees
				// their own memories + global shared. `ownerUserId` is the new
				// FK-style filter; `scope` remains for backward compat.
				const recallOpts = {
					limit: 3,
					ownerUserId: msg.user.id,
					embedding: sharedEmbedding,
				};
				const [userMemories, globalMemories] = await Promise.all([
					this.memoryStore.recall(msg.content, {
						...recallOpts,
						scope: msg.user.id,
					}),
					this.memoryStore.recall(msg.content, {
						...recallOpts,
						scope: "global",
					}),
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
						.map((m) => `- id=${m.id} [${m.metadata.category}] ${m.text}`)
						.join("\n");
					await this.bus.emit("memory:recalled", {
						query: msg.content,
						resultCount: unique.length,
					});
					this.logger.debug("Injected memory context", {
						count: unique.length,
					});
				}
			} catch (err) {
				this.logger.warn("Memory recall failed", { error: String(err) });
			}
		}

		// Detect implicit corrections
		if (this.feedbackStore && messages.length >= 2) {
			const correction = detectCorrection(messages);
			if (correction) {
				const assistantMessages = history.filter((m) => m.role === "assistant");
				const lastAssistant = assistantMessages[assistantMessages.length - 1];
				if (lastAssistant) {
					this.feedbackStore.recordCorrection(
						msg.sessionId,
						lastAssistant.id,
						correction.correctionText,
					);
				}
			}
		}

		let feedbackContext: string | undefined;
		if (this.feedbackStore) {
			try {
				feedbackContext =
					this.feedbackStore.getRecentNegativeFeedback(msg.user.id, 5) ??
					undefined;
			} catch {
				// Non-critical
			}
		}

		// Re-read agent config from file so UI changes take effect without restart
		let agentName = this.config.agent.name;
		let agentPrompt = this.config.agent.systemPrompt;
		try {
			const { readConfigOverrides } = await import("../config/writer.js");
			const overrides = readConfigOverrides();
			const agentOverrides = overrides.agent as
				| { name?: string; systemPrompt?: string }
				| undefined;
			if (agentOverrides?.name) agentName = agentOverrides.name;
			if (agentOverrides?.systemPrompt)
				agentPrompt = agentOverrides.systemPrompt;
		} catch {
			/* use boot-time config */
		}

		const systemPrompt = buildSystemPrompt({
			agentName,
			customPrompt: agentPrompt || undefined,
			memoryContext,
			feedbackContext,
			skillCatalog: this.skillManager.getCatalogPrompt(),
			brandBrief: compileBrandBrief(getActiveBrand(this.database)),
		});

		this.logger.info("System prompt built", {
			agentName,
			hasCustomPrompt: !!agentPrompt,
			promptLength: systemPrompt.length,
		});

		// Pre-activate canvas skill so canvas tools are available from roundtrip 1
		if (msg.channel === "canvas") {
			this.skillManager.activateSkill(msg.sessionId, "canvas");
		}

		// H-NEW-5: register an abort controller so /api/chat/cancel
		// can tear down the in-flight HTTP request, not just the read
		// loop. (Streaming path also does this — see below.)
		const controller = new AbortController();
		this.activeAbortControllers.set(msg.sessionId, controller);

		try {
			const response = await this.provider.chat(
				messages,
				systemPrompt,
				msg.sessionId,
				{ signal: controller.signal },
			);
			// B6.4: don't fabricate "Done — canvas updated." for an empty
			// canvas reply — we can't confirm a canvas_write actually ran here,
			// and asserting success on a no-op is exactly the hallucination we
			// want to avoid. (The streaming canvas path already uses the raw
			// reply text; this keeps both paths honest.)
			const replyText = response.text || "";
			appendMessage(this.db, msg.sessionId, "assistant", replyText);

			// M-NEW-12: record cost in the non-stream path too. If the
			// provider returned usage, use it; otherwise fall back to a
			// rough char-based estimate so cost data is non-zero for
			// non-Claude providers.
			if (this.costTracker) {
				const usageIn = response.usage?.inputTokens;
				const usageOut = response.usage?.outputTokens;
				const inputTokens =
					usageIn ?? estimateTokens(systemPrompt + "\n" + msg.content);
				const outputTokens = usageOut ?? estimateTokens(replyText);
				const model = this.config.ai.model;
				this.costTracker.recordUsage({
					sessionId: msg.sessionId,
					provider: this.provider.name ?? this.config.provider,
					model,
					inputTokens,
					outputTokens,
					estimatedCostUsd: CostTracker.estimateCost(
						model,
						inputTokens,
						outputTokens,
					),
				});
			}

			await this.bus.emit("message:outbound", {
				sessionId: msg.sessionId,
				channel: msg.channel,
				content: replyText,
				attachments: response.images?.map((img) => ({
					type: "image" as const,
					data: Buffer.from(img.base64, "base64"),
					mimeType: img.media_type,
				})),
				metadata: msg.metadata,
			});

			// Auto-extract memories from conversation (skip canvas — code generation has no useful facts)
			if (
				this.memoryStore &&
				this.config.memory.autoExtract &&
				msg.channel !== "canvas" &&
				// H-NEW-9: per-user debounce — skip if the cooldown
				// hasn't elapsed (1 call per 5s per userId).
				this.shouldAutoExtract(msg.user.id)
			) {
				this.autoExtractMemories(msg, replyText).catch((err) => {
					this.logger.warn("Auto-extract failed", { error: String(err) });
				});
			}
		} catch (err) {
			this.logger.error("AI provider error", { error: String(err) });
			const errStr = String(err);
			let userMessage: string;
			if (errStr.includes("429") || errStr.includes("rate_limit")) {
				userMessage =
					"I'm being rate-limited by the AI provider. Please wait a moment and try again.";
			} else if (
				errStr.includes("401") ||
				errStr.includes("403") ||
				errStr.includes("authentication")
			) {
				userMessage =
					"There's an authentication issue with the AI provider. Please check your API key configuration.";
			} else if (
				errStr.includes("timeout") ||
				errStr.includes("ETIMEDOUT") ||
				errStr.includes("TimeoutError") ||
				errStr.includes("AbortError")
			) {
				userMessage =
					"The AI provider took too long to respond. This can happen with complex requests — try breaking it into smaller steps.";
			} else {
				userMessage =
					"Sorry, I encountered an error processing your message. Please try again.";
			}
			// For canvas, append the actual error so the user can diagnose
			if (
				msg.channel === "canvas" &&
				!errStr.includes("429") &&
				!errStr.includes("401")
			) {
				userMessage += ` (${errStr.length > 200 ? errStr.slice(0, 200) + "..." : errStr})`;
			}
			await this.bus.emit("message:outbound", {
				sessionId: msg.sessionId,
				channel: msg.channel,
				content: userMessage,
				metadata: msg.metadata,
			});
		} finally {
			// H-NEW-5: clean up the abort controller. Compare with the
			// stored one so a newer concurrent call isn't clobbered.
			if (this.activeAbortControllers.get(msg.sessionId) === controller) {
				this.activeAbortControllers.delete(msg.sessionId);
			}
		}
	}

	private async prepareChat(msg: InboundMessage): Promise<{
		messages: ChatMessage[];
		systemPrompt: string;
	} | null> {
		// Internal system channels (cron, heartbeat) bypass rate limiting and access control
		const INTERNAL_CHANNELS = new Set(["cron", "heartbeat", "github"]);
		const isInternal = INTERNAL_CHANNELS.has(msg.channel);

		// Rate limiting (skip for internal channels)
		if (!isInternal && this.rateLimiter) {
			const { allowed } = this.rateLimiter.check(msg.user.id);
			if (!allowed) {
				return null;
			}
		}

		// Access control (pairing code system) — skip for internal channels
		if (
			!isInternal &&
			this.accessController &&
			!this.accessController.isUserApproved(msg.user.id, msg.channel)
		) {
			return null;
		}

		const session = getOrCreateSession(
			this.db,
			msg.sessionId,
			msg.channel,
			msg.user.id,
		);
		appendMessage(this.db, msg.sessionId, "user", msg.content);

		if (!session.title) {
			const title =
				msg.content.length > 80
					? msg.content.slice(0, 80) + "..."
					: msg.content;
			updateSessionTitle(this.db, msg.sessionId, title);
		}

		const history = getSessionMessages(
			this.db,
			msg.sessionId,
			this.config.store.messageHistoryLimit,
		);
		const messages: ChatMessage[] = history.map((m) => ({
			role: m.role === "user" ? ("user" as const) : ("assistant" as const),
			content: m.content,
		}));

		if (msg.attachments && msg.attachments.length > 0 && messages.length > 0) {
			const lastMsg = messages[messages.length - 1];
			if (lastMsg.role === "user") {
				lastMsg.attachments = msg.attachments;
			}
		}

		let memoryContext: string | undefined;
		if (this.memoryStore && msg.channel !== "canvas") {
			try {
				const sharedEmbedding =
					(await this.memoryStore.embed(msg.content)) ?? undefined;
				const recallOpts = {
					limit: 3,
					ownerUserId: msg.user.id,
					embedding: sharedEmbedding,
				};
				const [userMemories, globalMemories] = await Promise.all([
					this.memoryStore.recall(msg.content, {
						...recallOpts,
						scope: msg.user.id,
					}),
					this.memoryStore.recall(msg.content, {
						...recallOpts,
						scope: "global",
					}),
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
						.map((m) => `- id=${m.id} [${m.metadata.category}] ${m.text}`)
						.join("\n");
					await this.bus.emit("memory:recalled", {
						query: msg.content,
						resultCount: unique.length,
					});
				}
			} catch (err) {
				this.logger.warn("Memory recall failed", { error: String(err) });
			}
		}

		// Detect implicit corrections and record them
		if (this.feedbackStore && messages.length >= 2) {
			const correction = detectCorrection(messages);
			if (correction) {
				const assistantMessages = history.filter((m) => m.role === "assistant");
				const lastAssistant = assistantMessages[assistantMessages.length - 1];
				if (lastAssistant) {
					this.feedbackStore.recordCorrection(
						msg.sessionId,
						lastAssistant.id,
						correction.correctionText,
					);
					this.logger.info("Implicit correction detected", {
						sessionId: msg.sessionId,
					});
				}
			}
		}

		// Get recent negative feedback for system prompt
		let feedbackContext: string | undefined;
		if (this.feedbackStore) {
			try {
				feedbackContext =
					this.feedbackStore.getRecentNegativeFeedback(msg.user.id, 5) ??
					undefined;
			} catch {
				// Non-critical
			}
		}

		let agentName = this.config.agent.name;
		let agentPrompt = this.config.agent.systemPrompt;
		try {
			const { readConfigOverrides } = await import("../config/writer.js");
			const overrides = readConfigOverrides();
			const agentOverrides = overrides.agent as
				| { name?: string; systemPrompt?: string }
				| undefined;
			if (agentOverrides?.name) agentName = agentOverrides.name;
			if (agentOverrides?.systemPrompt)
				agentPrompt = agentOverrides.systemPrompt;
		} catch {
			/* use boot-time config */
		}

		const systemPrompt = buildSystemPrompt({
			agentName,
			customPrompt: agentPrompt || undefined,
			memoryContext,
			feedbackContext,
			skillCatalog: this.skillManager.getCatalogPrompt(),
			brandBrief: compileBrandBrief(getActiveBrand(this.database)),
		});

		if (msg.channel === "canvas") {
			this.skillManager.activateSkill(msg.sessionId, "canvas");
		}

		return { messages, systemPrompt };
	}

	async *handleInboundStream(msg: InboundMessage): AsyncGenerator<StreamChunk> {
		this.logger.info("Inbound stream message", {
			channel: msg.channel,
			sessionId: msg.sessionId,
			user: msg.user.id,
		});

		const prepared = await this.prepareChat(msg);
		if (!prepared) {
			yield { type: "error", error: "Access denied or rate limited" };
			yield { type: "done" };
			return;
		}

		const { messages, systemPrompt } = prepared;
		let fullText = "";
		let cancelled = false;

		// Register an abort controller so the /api/chat/cancel endpoint can
		// signal this stream. One per session; a new message replaces the
		// previous controller.
		const controller = new AbortController();
		const prev = this.activeAbortControllers.get(msg.sessionId);
		if (prev) prev.abort();
		this.activeAbortControllers.set(msg.sessionId, controller);

		let inputTokensTotal = 0;
		let outputTokensTotal = 0;
		let lastProvider: string | undefined;
		let lastModel: string | undefined;

		try {
			if (this.provider.chatStream) {
				for await (const chunk of this.provider.chatStream(
					messages,
					systemPrompt,
					msg.sessionId,
					{ signal: controller.signal },
				)) {
					if (controller.signal.aborted) {
						cancelled = true;
						break;
					}
					if (chunk.type === "text_delta" && chunk.text) {
						fullText += chunk.text;
					}
					if (chunk.type === "usage" && chunk.usage) {
						inputTokensTotal += chunk.usage.inputTokens ?? 0;
						outputTokensTotal += chunk.usage.outputTokens ?? 0;
						lastProvider = chunk.usage.provider ?? lastProvider;
						lastModel = chunk.usage.model ?? lastModel;
						const estimatedCostUsd = lastModel
							? CostTracker.estimateCost(
									lastModel,
									chunk.usage.inputTokens ?? 0,
									chunk.usage.outputTokens ?? 0,
								)
							: undefined;
						yield {
							...chunk,
							usage: { ...chunk.usage, estimatedCostUsd },
						};
						continue;
					}
					// Skip provider's done — kernel emits its own with messageId
					if (chunk.type === "done") continue;
					yield chunk;
				}
			} else {
				yield { type: "thinking" } as StreamChunk;
				const response = await this.provider.chat(
					messages,
					systemPrompt,
					msg.sessionId,
					{ signal: controller.signal },
				);
				fullText = response.text;
				yield { type: "text_delta", text: response.text };
				if (response.usage) {
					inputTokensTotal += response.usage.inputTokens;
					outputTokensTotal += response.usage.outputTokens;
				}
			}

			if (cancelled) {
				this.logger.info("Stream cancelled by user", {
					sessionId: msg.sessionId,
				});
				yield { type: "error", error: "Generation stopped by user" };
				yield { type: "done" };
				return;
			}

			const replyText = fullText || "";
			const storedMsg = appendMessage(
				this.db,
				msg.sessionId,
				"assistant",
				replyText,
			);

			// Persist usage for the session if anything was recorded.
			if (this.costTracker && (inputTokensTotal > 0 || outputTokensTotal > 0)) {
				try {
					const resolvedProvider =
						lastProvider ?? this.provider.name ?? this.config.provider;
					const resolvedModel = lastModel ?? this.config.ai.model;
					const estimatedCostUsd = CostTracker.estimateCost(
						resolvedModel,
						inputTokensTotal,
						outputTokensTotal,
					);
					this.costTracker.recordUsage({
						sessionId: msg.sessionId,
						provider: resolvedProvider,
						model: resolvedModel,
						inputTokens: inputTokensTotal,
						outputTokens: outputTokensTotal,
						estimatedCostUsd,
					});
				} catch (err) {
					this.logger.warn("Cost tracking failed", { error: String(err) });
				}
			}

			// Yield the message ID so the frontend can attach feedback
			yield { type: "done", messageId: storedMsg.id };

			if (
				this.memoryStore &&
				this.config.memory.autoExtract &&
				msg.channel !== "canvas" &&
				// H-NEW-9: per-user debounce — skip if the cooldown
				// hasn't elapsed (1 call per 5s per userId).
				this.shouldAutoExtract(msg.user.id)
			) {
				this.autoExtractMemories(msg, replyText).catch((err) => {
					this.logger.warn("Auto-extract failed", { error: String(err) });
				});
			}
		} catch (err) {
			this.logger.error("Stream error", { error: String(err) });
			yield { type: "error", error: String(err) };
			yield { type: "done" };
		} finally {
			// Only clear if we still own the entry; a subsequent message may
			// have replaced it.
			if (this.activeAbortControllers.get(msg.sessionId) === controller) {
				this.activeAbortControllers.delete(msg.sessionId);
			}
		}
	}

	// H-NEW-9: per-user debounce for auto-extract. Map: userId -> ms
	// timestamp of the last accepted extract call.
	private lastAutoExtractAt = new Map<string, number>();
	private static readonly AUTO_EXTRACT_COOLDOWN_MS = 5_000;

	/**
	 * Returns true if the cooldown has elapsed for this user. The
	 * check-and-update is intentionally not atomic — Bun is
	 * single-threaded, so this is safe. If multiple extract calls
	 * race, the worst case is one extra LLM call, not unbounded
	 * growth.
	 */
	private shouldAutoExtract(userId: string): boolean {
		const now = Date.now();
		const last = this.lastAutoExtractAt.get(userId) ?? 0;
		if (now - last < Kernel.AUTO_EXTRACT_COOLDOWN_MS) {
			return false;
		}
		this.lastAutoExtractAt.set(userId, now);
		// Periodic cleanup so the map doesn't grow with stale users.
		if (this.lastAutoExtractAt.size > 1000) {
			const cutoff = now - Kernel.AUTO_EXTRACT_COOLDOWN_MS * 100;
			for (const [k, v] of this.lastAutoExtractAt) {
				if (v < cutoff) this.lastAutoExtractAt.delete(k);
			}
		}
		return true;
	}

	private async autoExtractMemories(
		msg: InboundMessage,
		response: string,
	): Promise<void> {
		if (!this.memoryStore) return;

		// H-NEW-9: also bail on tiny messages to avoid wasted LLM
		// roundtrips for acknowledgments.
		if (msg.content.length < 12 || response.length < 12) {
			return;
		}

		const recentMessages: ChatMessage[] = [
			{ role: "user", content: msg.content },
			{ role: "assistant", content: response },
		];

		const extracted = await extractMemories(this.provider, recentMessages);
		if (extracted.length > 0) {
			const storedIds = await storeExtractedMemories(
				this.memoryStore,
				extracted,
				{
					scope: msg.user.id,
					source: `session:${msg.sessionId}`,
					ownerUserId: msg.user.id,
				},
			);
			for (let i = 0; i < storedIds.length; i++) {
				await this.bus.emit("memory:stored", {
					id: storedIds[i],
					text: extracted[i],
					category: "fact",
				});
			}
			this.logger.info("Auto-extracted memories", {
				count: extracted.length,
				sessionId: msg.sessionId,
			});
		}
	}

	private createPluginContext(pluginName: string): PluginContext {
		const logger = createLogger(pluginName);
		// Boot-time config as baseline
		const bootConfig =
			(this.config as Record<string, unknown>)[pluginName] ?? {};
		// Live proxy: reads fresh overrides on each property access so web UI
		// config changes take effect without a restart.
		const pluginConfig = new Proxy(bootConfig as Record<string, unknown>, {
			get(_target, prop, receiver) {
				const overrides = readConfigOverrides();
				const live = (overrides[pluginName] as Record<string, unknown>) ?? {};
				const merged = { ..._target, ...live };
				return Reflect.get(merged, prop, receiver);
			},
			ownKeys(_target) {
				const overrides = readConfigOverrides();
				const live = (overrides[pluginName] as Record<string, unknown>) ?? {};
				return [
					...new Set([...Reflect.ownKeys(_target), ...Reflect.ownKeys(live)]),
				];
			},
			getOwnPropertyDescriptor(_target, prop) {
				const overrides = readConfigOverrides();
				const live = (overrides[pluginName] as Record<string, unknown>) ?? {};
				const merged = { ..._target, ...live };
				if (prop in merged) {
					return {
						configurable: true,
						enumerable: true,
						value: (merged as any)[prop],
					};
				}
				return undefined;
			},
		});

		const store: PluginStore = {
			get: (key: string) => {
				const row = this.db
					.query<{ value: string }, [string, string]>(
						"SELECT value FROM plugin_kv WHERE plugin = ? AND key = ?",
					)
					.get(pluginName, key);
				return row ? JSON.parse(row.value) : undefined;
			},
			set: (key: string, value: unknown) => {
				this.db.run(
					"INSERT OR REPLACE INTO plugin_kv (plugin, key, value) VALUES (?, ?, ?)",
					[pluginName, key, JSON.stringify(value)],
				);
			},
			delete: (key: string) => {
				this.db.run("DELETE FROM plugin_kv WHERE plugin = ? AND key = ?", [
					pluginName,
					key,
				]);
			},
		};

		return {
			bus: this.bus,
			registerTools: (tools) => this.toolRegistry.register(tools),
			logger,
			config: pluginConfig as Record<string, unknown>,
			store,
			llm: async ({ system, message }: { system: string; message: string }) => {
				const response = await this.provider.chat(
					[{ role: "user", content: message }],
					system,
				);
				return response.text;
			},
		};
	}

	private initSecondaryProviders(
		config: PawConfig,
		logger: ReturnType<typeof createLogger>,
	): void {
		const maxRoundtrips = config.ai.maxToolRoundtrips;
		const providerConfigs: Array<{
			name: string;
			factory: () => AIProvider;
			hasKey: boolean;
		}> = [
			{
				name: "claude",
				factory: () =>
					new ClaudeProvider(
						config.ai,
						this.toolRegistry,
						logger,
						this.skillManager,
					),
				hasKey: !!config.ai.apiKey,
			},
			{
				name: "ollama",
				factory: () =>
					new OllamaProvider(
						{ ...config.ollama, maxToolRoundtrips: maxRoundtrips },
						this.toolRegistry,
						logger,
						this.skillManager,
					),
				hasKey: true, // Ollama doesn't always need a key
			},
			{
				name: "openai",
				factory: () =>
					new OpenAIProvider(
						{ ...config.openai, maxToolRoundtrips: maxRoundtrips },
						this.toolRegistry,
						logger,
						this.skillManager,
					),
				hasKey: !!config.openai.apiKey,
			},
			{
				name: "gemini",
				factory: () =>
					new GeminiProvider(
						{ ...config.gemini, maxToolRoundtrips: maxRoundtrips },
						this.toolRegistry,
						logger,
						this.skillManager,
					),
				hasKey: !!config.gemini.apiKey,
			},
		];

		for (const pc of providerConfigs) {
			if (!this.allProviders.has(pc.name) && pc.hasKey) {
				try {
					this.allProviders.set(pc.name, pc.factory());
				} catch (err) {
					this.logger.warn("Failed to init secondary provider", {
						provider: pc.name,
						error: String(err),
					});
				}
			}
		}
	}

	/**
	 * Get the appropriate provider for an agent, respecting
	 * the agent's provider override and routing rules.
	 */
	private getProviderForAgent(agent: AgentDefinition): AIProvider {
		// Explicit provider override on the agent definition takes priority
		if (agent.provider) {
			const specific = this.allProviders.get(agent.provider);
			if (specific) return specific;
			this.logger.warn(
				"Agent requested provider not available, using default",
				{
					agent: agent.name,
					requestedProvider: agent.provider,
				},
			);
		}

		// Use router if available
		if (this.providerRouter) {
			return this.providerRouter.selectProvider({
				agentName: agent.name,
				isSubAgent: true,
			});
		}

		return this.provider;
	}

	async shutdown(): Promise<void> {
		this.logger.info("Shutting down...");
		if (this.sessionCleanupInterval) {
			clearInterval(this.sessionCleanupInterval);
			this.sessionCleanupInterval = null;
		}
		// Stop the rate-limiter's periodic eviction timer (H-NEW-12). The
		// timer holds a strong reference to the limiter (and indirectly
		// to the kernel) so without this the process can't exit cleanly.
		this.rateLimiter?.destroy();
		this.webAppCleanup?.();
		this.webServer?.stop();
		this.heartbeatChecker?.stop();
		this.cronScheduler?.stop();
		await this.mcpClientManager.disconnectAll();
		for (const plugin of this.plugins) {
			try {
				await plugin.stop();
				await this.bus.emit("plugin:stopped", { name: plugin.name });
			} catch (err) {
				this.logger.error("Plugin stop failed", {
					name: plugin.name,
					error: String(err),
				});
			}
		}
		await this.bus.emit("kernel:shutdown", undefined);
		this.bus.removeAllListeners();
		closeDb();
		this.logger.info("Shutdown complete");
	}

	async healthCheck(): Promise<
		Record<string, { ok: boolean; details?: string }>
	> {
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
			results["memory"] = {
				ok: true,
				details: `${stats.totalMemories} memories stored`,
			};
		}
		if (this.mcpClientManager.serverCount > 0) {
			results["mcp"] = {
				ok: this.mcpClientManager.connectedCount > 0,
				details: `${this.mcpClientManager.connectedCount}/${this.mcpClientManager.serverCount} servers connected`,
			};
		}
		if (this.strapiClient) {
			try {
				const ok = await this.strapiClient.healthCheck();
				results["strapi"] = {
					ok,
					details: ok ? "reachable" : "unreachable",
				};
			} catch {
				results["strapi"] = { ok: false, details: "unreachable" };
			}
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

	get feedback(): FeedbackStore | null {
		return this.feedbackStore;
	}

	get costs(): CostTracker | null {
		return this.costTracker;
	}

	get tools(): ToolLog | null {
		return this.toolLog;
	}

	/** Read-only access to the tool registry (H-NEW-2: cron tool validation). */
	get toolRegistryPublic(): ToolRegistry {
		return this.toolRegistry;
	}

	/** Strapi client for routing canvas action submissions (null if disabled). */
	get strapi(): import("../integrations/strapi/client.js").StrapiClient | null {
		return this.strapiClient;
	}

	/** GitHub App client (null if disabled or not configured). */
	get github(): import("../integrations/github/client.js").GitHubClient | null {
		return this.githubClient;
	}

	/** GitHub approval queue for gated actions (null if disabled). */
	get githubApprovals():
		| import("../integrations/github/approvals.js").GitHubApprovals
		| null {
		return this.githubApprovalsInstance;
	}

	/** Durable proactive-notification inbox (nav badge + canvas portrait). */
	get notifications(): NotificationStore {
		return this.notificationStoreInstance;
	}

	cancelSession(sessionId: string): boolean {
		const controller = this.activeAbortControllers.get(sessionId);
		if (controller) {
			controller.abort();
			this.activeAbortControllers.delete(sessionId);
			this.logger.info("Session cancelled", { sessionId });
			return true;
		}
		return false;
	}

	get database(): Database {
		return this.db;
	}

	/** Credential vault — web-managed encrypted secrets (server-side only). */
	get vault(): VaultManager {
		return this.vaultManager;
	}

	get aiProvider(): AIProvider {
		return this.provider;
	}

	get cron(): CronScheduler | null {
		return this.cronScheduler;
	}

	get heartbeat(): HeartbeatChecker | null {
		return this.heartbeatChecker;
	}

	get mcpManager(): MCPClientManager {
		return this.mcpClientManager;
	}

	get agents(): AgentRegistry {
		return this.agentRegistry;
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

		// Drop any tool whose name already exists. MCP-sourced tools can't be
		// allowed to shadow built-ins; built-ins register first, so the first
		// writer wins. We also dedupe among the new batch itself.
		const accepted: ToolDefinition[] = [];
		const batchSeen = new Set<string>();
		for (const tool of tools) {
			if (this.toolRegistry.has(tool.name) || batchSeen.has(tool.name)) {
				this.logger.warn("Tool name collision — skipping", {
					tool: tool.name,
					plugin: tool.plugin,
				});
				continue;
			}
			batchSeen.add(tool.name);
			accepted.push(tool);
		}
		if (accepted.length > 0) {
			this.toolRegistry.register(accepted);
		}
	}
}
