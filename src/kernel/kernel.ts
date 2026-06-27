import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { AgentRegistry } from "../agents/registry.js";
import { createSpawnAgentTool } from "../agents/spawn-agent-tool.js";
import type { AgentDefinition, AgentRunResult } from "../agents/types.js";
import type {
	AIProvider,
	ChatMessage,
	ChatResponse,
	StreamChunk,
} from "../ai/base-provider.js";
import { CostTracker, estimateTokens } from "../ai/cost-tracker.js";
import { GeminiProvider } from "../ai/gemini-provider.js";
import {
	HookManager,
	createAuditHook,
	createGuardrailHook,
	createMetricsHook,
} from "../ai/hooks.js";
import { runSchemaDrift } from "../ai/mcp-schema-drift.js";
import { OllamaProvider } from "../ai/ollama-provider.js";
import { OpenAIProvider } from "../ai/openai-provider.js";
import { ClaudeProvider } from "../ai/provider.js";
import { isTransientError } from "../ai/retry.js";
import {
	type FallbackAttempt,
	PROVIDER_FALLBACK_NOTE,
	ProviderRouter,
	VISION_ERROR_NOTE,
	VISION_UNCONFIGURED_NOTE,
	planImageTurn,
	withProviderFallback,
	withVisionFallback,
} from "../ai/router.js";
import { SkillManager } from "../ai/skills.js";
import type { DraftPlaybook } from "../playbooks/manager.js";
import { PlaybookManager } from "../playbooks/manager.js";
import { createPlaybookTools } from "../tools/playbook-tools.js";
import { buildSystemPrompt } from "../ai/system-prompt.js";
import { ToolRegistry } from "../ai/tools.js";
import { readConfigOverrides } from "../config/writer.js";
import { CronScheduler } from "../cron/scheduler.js";
import { createProactiveTriggerTools } from "../cron/trigger-tools.js";
import { detectCorrection } from "../feedback/correction-detector.js";
import { FeedbackStore } from "../feedback/store.js";
import { HeartbeatChecker } from "../heartbeat/checker.js";
import { GitHubApprovals } from "../integrations/github/approvals.js";
import { MCPClientManager } from "../mcp/client-manager.js";
import {
	extractMemories,
	storeExtractedMemories,
} from "../memory/auto-extract.js";
import { preloadEmbedder } from "../memory/embeddings.js";
import { MemoryStore } from "../memory/store.js";
import { createMemoryTools } from "../memory/tools.js";
import { createLogger, setLogLevel } from "../observability/logger.js";
import { ToolLog } from "../observability/tool-log.js";
import { resolveProjectPath } from "../paths.js";
import {
	AccessController,
	unrecognizedUserMessage,
} from "../security/access-control.js";
import { AuditLogger } from "../security/audit-log.js";
import { RateLimiter } from "../security/rate-limiter.js";
import { VaultManager } from "../security/vault.js";
import { compileBrandBrief, getActiveBrand } from "../store/brands.js";
import { closeDb, getDb } from "../store/db.js";
import {
	appendMessage,
	countSessionMessages,
	getSessionMessages,
	pruneOldMessages,
} from "../store/messages.js";
import { NotificationStore } from "../store/notifications.js";
import { sessionTitleFromContent } from "../store/session-title.js";
import { getOrCreateSession, updateSessionTitle } from "../store/sessions.js";
import { createActionTools } from "../tools/action-tools.js";
import {
	type ApplyEditParams,
	applyCanvasEdit,
	createCanvasBridgeTools,
} from "../tools/canvas-bridge-tools.js";
import { createCanvasTools } from "../tools/canvas-tools.js";
import {
	advanceCardOnApproval,
	advanceCardOnCompletion,
	advanceCardOnVerdict,
	failCronCard,
	linkCardOnDelegation,
	listBySession,
	listEscalatable,
	markEscalated,
	parkCardForApproval,
} from "../store/agent-work.js";
import { createTaskTools } from "../tools/task-tools.js";
import { recordRunVerdict, sqliteStamp } from "../observability/run-verdict.js";
import { recordRun } from "../store/runs.js";
import { createCodeTools } from "../tools/code-tools.js";
import { createExecTools } from "../tools/exec-tools.js";
import { createFileTools } from "../tools/file-tools.js";
import type { PawConfig } from "../types/config.js";
import type { ToolDefinition } from "../types/message.js";
import type { InboundMessage } from "../types/message.js";
import type {
	ChannelPlugin,
	PluginContext,
	PluginStore,
} from "../types/plugin.js";
import { createWebApp } from "../web/app.js";
import { startWebServer } from "../web/server.js";
import { EventBus } from "./bus.js";
import { prepareCronCardRun } from "./cron-card-run.js";
import {
	type GateReason,
	accessControlOffWarning,
	evaluateInboundGate,
	gateDenialMessage,
	isAccessExempt,
	isTrustedRelay,
} from "./inbound-gate.js";
import { discoverPlugins } from "./plugin-loader.js";
import { Sandbox } from "./sandbox.js";

export class Kernel {
	private bus: EventBus;
	private sandbox: Sandbox;
	private toolRegistry: ToolRegistry;
	private provider: AIProvider;
	private allProviders: Map<string, AIProvider> = new Map();
	private providerRouter: ProviderRouter | null = null;
	// Optional vision route: a distinct provider instance built with the vision
	// model (config.ai.vision). Null when vision isn't configured/keyed.
	private visionProvider: AIProvider | null = null;
	private visionModel: string | null = null;
	// Ordered main-chat fallback chain (config.ai.fallback): one provider+model
	// instance per entry, tried in order when the primary errors transiently.
	private fallbackChain: Array<{
		provider: AIProvider;
		model: string;
		name: string;
	}> = [];
	private costTracker: CostTracker | null = null;
	private toolLog: ToolLog | null = null;
	private hookManager: HookManager;
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
	private taskEscalationInterval: ReturnType<typeof setInterval> | null = null;
	private mcpClientManager: MCPClientManager;
	private strapiClient:
		| import("../integrations/strapi/client.js").StrapiClient
		| null = null;
	hubspotClient:
		| import("../integrations/hubspot/client.js").HubSpotClient
		| null = null;
	private supabaseClient:
		| import("../integrations/supabase/client.js").SupabaseClient
		| null = null;
	private supabaseProvisioner:
		| import("../integrations/supabase/provisioner.js").SupabaseProvisioner
		| null = null;
	private githubClient:
		| import("../integrations/github/client.js").GitHubClient
		| null = null;
	private githubApprovalsInstance:
		| import("../integrations/github/approvals.js").GitHubApprovals
		| null = null;
	private vercelClient:
		| import("../integrations/vercel/client.js").VercelClient
		| null = null;
	private posthogClient:
		| import("../integrations/posthog/client.js").PostHogClient
		| null = null;
	private notificationStoreInstance!: NotificationStore;
	private githubReactorUnsub: (() => void) | null = null;
	private skillManager: SkillManager;
	private playbookManager: PlaybookManager;
	private agentRegistry: AgentRegistry;
	private agentDepths = new Map<string, number>();
	/** In-flight (and just-finished) spawned agents, keyed by agentSessionId —
	 * powers the Dashboard ops-scene satellite faces. */
	private activeAgentsMap = new Map<
		string,
		{
			name: string;
			task: string;
			startedAt: number;
			done?: boolean;
			ok?: boolean;
			finishedAt?: number;
		}
	>();
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
				"code:execute",
				"cron:create",
				"agent:spawn",
				"agent:delegate",
				"skill:activate",
				"canvas:read",
				"canvas:write",
				"playbook:read",
				"playbook:write",
				"task:read",
				"task:write",
			],
		});

		// Security. The AccessController is constructed UNCONDITIONALLY — external
		// channels (Slack) always fail CLOSED for unrecognized users. Previously it
		// was gated on `requireApproval`, so the default (false) left the agent
		// answering everyone with no approval. Openness is now governed only by the
		// explicit, default-off `allowUnapprovedExternal`.
		this.accessController = new AccessController(
			this.db,
			createLogger("security"),
			{
				allowedUsers: config.security.allowedUsers,
				blockedUsers: config.security.blockedUsers,
				ownerUserIds: config.security.ownerUserIds,
				pairingCodeTtlMinutes: config.security.pairingCodeTtlMinutes,
			},
		);
		// Boot diagnostic: confirm which ids are recognized without a DB row /
		// pairing handshake. If an expected owner is missing here, the config
		// override didn't load into the running controller.
		this.logger.info("Access control active", {
			ownerUserIds: config.security.ownerUserIds,
			allowedUsers: config.security.allowedUsers,
			blockedUsers: config.security.blockedUsers,
		});
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

		// Optional vision route (image-bearing turns) — a distinct provider
		// instance built with the vision model. Independent of general routing.
		this.visionProvider = this.buildVisionProvider(config, aiLogger);

		// Build the ordered main-chat fallback chain (config.ai.fallback).
		this.fallbackChain = this.buildFallbackChain(config, aiLogger);

		// Initialize the router when general routing OR vision is configured.
		if (config.routing?.enabled || this.visionProvider) {
			if (config.routing?.enabled) {
				this.initSecondaryProviders(config, aiLogger);
			}
			this.providerRouter = new ProviderRouter({
				providers: this.allProviders,
				rules: config.routing?.rules ?? [],
				defaultProvider: this.provider,
				visionProvider: this.visionProvider,
				logger: createLogger("router"),
			});
			this.logger.info("Provider router initialized", {
				providers: [...this.allProviders.keys()],
				rules: config.routing?.rules?.length ?? 0,
				vision: this.visionProvider ? config.ai.vision?.model : null,
			});
		}

		// Initialize cost tracker
		this.costTracker = new CostTracker(this.db);

		// Initialize tool-execution log. Captures every tool call (inputs,
		// outputs, duration, errors) for observability and audit.
		this.toolLog = new ToolLog(this.db);
		this.toolRegistry.setToolLog(this.toolLog);

		// Lifecycle hooks: one extension surface on the tool-execution chokepoint.
		// Built-ins: metrics (per-tool aggregate for the ops feed) + audit
		// (security-relevant tool calls) + an optional config-driven guardrail.
		this.hookManager = new HookManager(createLogger("hooks"));
		this.toolRegistry.setHooks(this.hookManager);
		this.hookManager.register(createMetricsHook(this.hookManager));
		const hookAudit = new AuditLogger(this.db);
		this.hookManager.register(
			createAuditHook((action, details) =>
				hookAudit.log(action, null, details),
			),
		);
		if (
			this.config.hooks.denyTools.length > 0 ||
			this.config.hooks.requireApprovalTools.length > 0
		) {
			this.hookManager.register(
				createGuardrailHook({
					denyTools: this.config.hooks.denyTools,
					requireApprovalTools: this.config.hooks.requireApprovalTools,
				}),
			);
		}

		// Approval queue — constructed ALWAYS (independent of the GitHub
		// integration) so non-GitHub gated actions (canvas edits, hook
		// `require-approval` verdicts) have a home and surface on /api/approvals/*.
		// The GitHub client is attached later via setClient() when configured.
		const approvalsAudit = new AuditLogger(this.db);
		const approvals = new GitHubApprovals(
			this.db,
			undefined,
			(action, details) => approvalsAudit.log(action, null, details),
			this.bus,
		);
		this.githubApprovalsInstance = approvals;
		// Wire the hook layer's require-approval verdict into the queue so a blocked
		// tool call surfaces on the same approval surfaces (#110).
		this.hookManager.setApprovalSink((ctx, reason) =>
			approvals.enqueueExternal({
				summary: `${ctx.toolName} — ${reason}`,
				params: { tool: ctx.toolName, input: ctx.input },
				requestedBy: ctx.sessionId ?? undefined,
				origin: ctx.origin,
			}),
		);
		// Execute-on-approve: when an `external` (hook-gated) approval is approved,
		// re-run the EXACT stored tool — bypassing ONLY the approval verdict (every
		// other sandbox/permission check still applies). The queue calls this back;
		// it never imports the tool registry.
		approvals.setToolExecutor((tool, input, sessionId) =>
			this.executeApprovedTool(tool, input, sessionId),
		);
		// Resolve approvals decided from any channel surface (web modal, Slack
		// buttons). Authorization is done here — plugins can't see the access
		// controller. approve()/reject() emit `approval:resolved`.
		this.bus.on("approval:decision", async (d) => {
			try {
				const authorized =
					!this.accessController ||
					this.accessController.isUserApproved(d.actorUserId, d.actorChannel);
				const decidedBy = `${d.actorChannel}:${d.actorUserId}`;
				if (!authorized) {
					const row = approvals.get(d.id);
					void this.bus.emit("approval:resolved", {
						id: d.id,
						status: "unauthorized",
						decidedBy,
						originChannel: row?.origin_channel ?? null,
						originRef: row?.origin_ref ?? null,
					});
					return;
				}
				if (d.decision === "approve") {
					await approvals.approve(d.id, decidedBy);
				} else {
					approvals.reject(d.id, decidedBy);
				}
			} catch (err) {
				this.logger.warn("approval:decision failed", {
					id: d.id,
					error: String(err),
				});
			}
		});

		// Playbooks — self-authored, reusable markdown procedures (progressive
		// disclosure, one layer up from skills). The catalog (name+description) is
		// appended to the system prompt; bodies load on demand via load_playbook.
		// create/update are approval-gated through the SAME queue as canvas edits and
		// written + hot-added to the live catalog on approve via the executor below,
		// so a playbook authored mid-session is loadable later in that same session.
		// TWO roots: bundled (read-only, in-image/repo) under the workspace root
		// (same root file_read/file_list use) where committed playbooks ship; and a
		// persistent writable root (PAW_PLAYBOOKS_ROOT → workspace.playbooksRoot,
		// e.g. /data/playbooks on Railway) where authored playbooks are written so
		// they survive redeploys. Unset = both collapse to the bundled dir (dev).
		const bundledPlaybooksDir = resolve(config.workspace.path || ".", "playbooks");
		const writablePlaybooksDir = config.workspace.playbooksRoot
			? resolve(config.workspace.playbooksRoot)
			: bundledPlaybooksDir;
		this.playbookManager = new PlaybookManager({
			bundledDir: bundledPlaybooksDir,
			writableDir: writablePlaybooksDir,
			logger: createLogger("playbooks"),
		});
		this.playbookManager.scan();
		this.toolRegistry.register(
			createPlaybookTools({ manager: this.playbookManager, approvals }),
		);
		approvals.registerExecutor("playbook_save", async (row) => {
			const p = row.params as Partial<DraftPlaybook> & { mode?: string };
			const entry = await this.playbookManager.upsert({
				name: String(p.name ?? ""),
				description: String(p.description ?? ""),
				body: String(p.body ?? ""),
			});
			approvalsAudit.log(`playbook.${p.mode ?? "save"}`, null, {
				name: entry.name,
			});
			return { saved: entry.name, mode: p.mode ?? "save" };
		});
		this.logger.info("Playbooks initialized", {
			bundledDir: this.playbookManager.bundledDirectory,
			writableDir: this.playbookManager.directory,
			count: this.playbookManager.names.length,
		});

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
			// execute_code: orchestrate other tools in one turn via a sandboxed child
			// process. Shares the registry + skill manager so bridged calls re-enter
			// the same permission/skill checks the model is bound by.
			this.toolRegistry.register(
				createCodeTools({
					workspacePath: config.workspace.path,
					maxOutputLength: config.workspace.maxOutputLength,
					execTimeout: config.workspace.execTimeout,
					toolRegistry: this.toolRegistry,
					skillManager: this.skillManager,
					logger: this.logger,
				}),
			);
			this.logger.info("File/exec/code tools registered");
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
				createActionTools({
					database: this.database,
					// Lazy: the Supabase client boots later in start(); read at call time.
					getSupabase: () => this.supabaseClient,
				}),
			);
			// Companion-driven edit tools (PR C): list (read) + apply (human-approved,
			// applied on approve via the executor below — same anchor-splice as the
			// inline editor).
			this.toolRegistry.register(
				createCanvasBridgeTools({
					canvasRoot,
					db: this.database,
					approvals,
					audit: (action, details) => approvalsAudit.log(action, null, details),
				}),
			);
			approvals.registerExecutor("canvas_apply_edit", (row) =>
				applyCanvasEdit(row.params as unknown as ApplyEditParams, {
					canvasRoot,
					db: this.database,
					audit: (action, details) => approvalsAudit.log(action, null, details),
				}),
			);
			this.logger.info("Canvas tools registered", { canvasRoot });
		}

		// Objective ledger: the agent's persistent task board (task_* tools).
		// Grouped under the on-demand "tasks" skill. The escalation valve is
		// started in start() (it needs the notifications store + a live timer).
		if (config.tasks.enabled) {
			this.toolRegistry.register(createTaskTools({ database: this.db }));
			this.logger.info("Task tools registered");
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
			this.cronScheduler.setPromptHandler(async (jobId, jobName, prompt) => {
				const sessionId = `cron-${jobId}-${Date.now()}`;
				// Phase 2c — cron-as-cards: surface this autonomous run on the board
				// BEFORE it starts (so it's `working` and findable by an
				// approval:pending), one durable card per job. Phase 2c.1 — also tell
				// the run which card it's on + demand evidence, and pre-activate the
				// `tasks` skill so it can self-report. Fail-open (bare prompt on error).
				const content = this.config.tasks.enabled
					? prepareCronCardRun({
							db: this.db,
							skillManager: this.skillManager,
							jobId,
							jobName,
							sessionId,
							prompt,
							onError: (err) =>
								this.logger.warn("Cron card prepare failed", {
									error: String(err),
								}),
						})
					: prompt;
				await this.bus.emit("message:inbound", {
					id: crypto.randomUUID(),
					sessionId,
					channel: "cron",
					content,
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

		// Track spawned agents so the Dashboard ops-scene can render satellite faces.
		this.bus.on("agent:delegated", (e) => {
			this.activeAgentsMap.set(e.agentSessionId, {
				name: e.agentName,
				task: e.task,
				startedAt: Date.now(),
			});
		});
		this.bus.on("agent:completed", (e) => {
			const a = this.activeAgentsMap.get(e.agentSessionId);
			if (a) {
				a.done = true;
				a.ok = e.ok;
				a.finishedAt = Date.now();
			}
		});

		// Ledger Phase 2a: auto-advance task cards off the agent lifecycle. A card
		// started from the board delegates with parentSessionId = "task-<cardId>";
		// we re-point the card to the real child session on `delegated`, then
		// advance it on `completed`. The evidence gate is sacred: `ok` without
		// evidence goes to `blocked`, never `done`. Fail-open: a subscriber error
		// must never break the run.
		if (this.config.tasks.enabled) {
			const onErr = (err: unknown) =>
				this.logger.warn("Task auto-advance failed", { error: String(err) });
			this.bus.on("agent:delegated", (e) => {
				linkCardOnDelegation(
					this.db,
					e.parentSessionId,
					e.agentSessionId,
					onErr,
				);
			});
			this.bus.on("agent:completed", (e) => {
				advanceCardOnCompletion(
					this.db,
					e.agentSessionId,
					e.ok,
					e.error,
					onErr,
				);
			});
			// Phase 2b — board approval lane. A gated tool mid-run emits
			// `approval:pending`; park the run's card in `needs_approval`. On
			// `approval:resolved` (PR1 execute-on-approve), advance it: executed →
			// done (evidence = the action result), rejected → blocked, failed →
			// failed, unauthorized → stays parked. Fail-open like the reactors above.
			this.bus.on("approval:pending", (e) => {
				parkCardForApproval(this.db, e.requestedBy, e.id, onErr);
			});
			this.bus.on("approval:resolved", (e) => {
				advanceCardOnApproval(this.db, e.id, e.status, e.result, onErr);
			});
			// Phase 2c — a cron run that threw at the scheduler/emit level fails its
			// card. (Success completion is verdict-driven in scoreCompletedRun.)
			this.bus.on("cron:error", (e) => {
				failCronCard(this.db, e.jobId, e.error, onErr);
			});
		}
	}

	async boot(pluginsDir = "./plugins"): Promise<void> {
		this.logger.info("Booting kernel...", { provider: this.config.provider });

		const loaded = await discoverPlugins(pluginsDir, createLogger("loader"));

		// Skill Creator: a meta-skill that scaffolds NEW plugins into pluginsDir.
		// Always available (on-demand skill); generated code is inert until the
		// next boot, so it never hot-loads. Targets the same dir plugins load from.
		{
			const { createSkillCreatorTools } = await import(
				"../tools/skill-creator.js"
			);
			const { AuditLogger } = await import("../security/audit-log.js");
			this.sandbox.registerManifest({
				name: "skill-creator",
				version: "1.0.0",
				description: "Scaffold new paw plugins/skills",
				permissions: ["skill-creator"],
			});
			const scAudit = new AuditLogger(this.db);
			this.toolRegistry.register(
				createSkillCreatorTools({
					pluginsDir,
					audit: (action, details) => scAudit.log(action, null, details),
				}),
			);
		}

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

		// Access-control posture: warn LOUDLY if the gate isn't enforcing while an
		// external channel (Slack) is live — otherwise the agent answers anyone.
		// The external-channel set is only known after plugins load.
		const externalChannelActive = this.plugins.some((p) => p.name === "slack");
		const offWarning = accessControlOffWarning({
			open: this.config.security.allowUnapprovedExternal === true,
			externalChannelActive,
		});
		if (offWarning) {
			this.logger.warn(offWarning);
		} else if (externalChannelActive) {
			this.logger.info("Access control enforcing on external channels", {
				ownerUserIds: this.config.security.ownerUserIds.length,
				allowedUsers: this.config.security.allowedUsers.length,
			});
		}

		// One-time cleanup: collapse pre-existing case-variant MCP server keys
		// (e.g. HubSpot/hubSpot/hubspot) into a single canonical lowercase key and
		// persist it. Idempotent — a no-op when there are no dupes.
		{
			const { dedupeMcpServers } = await import("../mcp/normalize.js");
			const { servers, changed } = dedupeMcpServers(
				this.config.mcpServers ?? {},
			);
			if (changed) {
				const { replaceConfigOverride } = await import("../config/writer.js");
				replaceConfigOverride("mcpServers", servers);
				this.config.mcpServers = servers as typeof this.config.mcpServers;
				this.logger.info("Collapsed case-variant MCP server names", {
					count: Object.keys(servers).length,
				});
			}
		}

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
				const { createHubSpotTools } = await import(
					"../integrations/hubspot/tools.js"
				);
				const { AuditLogger } = await import("../security/audit-log.js");
				const client = new HubSpotClient(this.config.hubspot);
				this.hubspotClient = client;
				this.sandbox.registerManifest({
					name: "hubspot",
					version: "1.0.0",
					description: "HubSpot CRM integration",
					// `hubspot` covers the plugin-inferred tool permission; the net
					// grant remains for the canvas form-receiver path.
					permissions: ["hubspot", "net:api.hubapi.com"],
				});
				const hsAudit = new AuditLogger(this.db);
				this.toolRegistry.register(
					createHubSpotTools(client, {
						audit: (action, details) => hsAudit.log(action, null, details),
					}),
				);
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
				const ghAuditFn = (action: string, details: Record<string, unknown>) =>
					ghAudit.log(action, null, details);
				// Attach the client to the always-on approval queue (constructed in the
				// kernel constructor) + register GitHub tools. The setApprovalSink +
				// approval:decision wiring is done once there, independent of GitHub.
				const approvals = this.githubApprovalsInstance;
				// Publish-time analytics: when PostHog is enabled with a public
				// project key, inject its snippet into committed HTML so the
				// Vercel-published page is instrumented. The GitHub tools stay
				// agnostic — they just get an opaque html transform.
				const ph = this.config.posthog;
				let htmlPublishTransform:
					| ((path: string, content: string) => string)
					| undefined;
				if (ph?.enabled && ph.projectApiKey) {
					const { injectPostHogSnippet } = await import(
						"../integrations/posthog/snippet.js"
					);
					htmlPublishTransform = (path, content) =>
						path.toLowerCase().endsWith(".html")
							? injectPostHogSnippet(content, {
									projectApiKey: ph.projectApiKey,
									host: ph.host,
								})
							: content;
				}
				if (approvals) {
					approvals.setClient(client);
					this.toolRegistry.register(
						createGitHubTools(client, {
							audit: ghAuditFn,
							approvals,
							htmlPublishTransform,
						}),
					);
					// Real git + gh in the exec workspace (clone/branch/commit/push/PR),
					// authed with the auto-rotating App installation token. Gated by the
					// same repo allowlist + approval queue; pushes to protected branches
					// refused, merges queued. Registered under the `github` manifest.
					const { createGitTools } = await import("../tools/git-tools.js");
					this.toolRegistry.register(
						createGitTools({
							client,
							approvals,
							workspacePath: this.config.workspace.path,
							protectedBranches: gh.protectedBranches,
							maxOutputLength: this.config.workspace.maxOutputLength,
							execTimeout: this.config.workspace.execTimeout,
							audit: ghAuditFn,
						}),
					);
				}
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

		// Initialize Vercel integration (deploy-target: provision public assets
		// onto the operator's own Vercel + GitHub repo). Disabled by default.
		const vc = this.config.vercel;
		if (vc?.enabled && vc.token) {
			try {
				const { VercelClient } = await import(
					"../integrations/vercel/client.js"
				);
				const { createVercelTools } = await import(
					"../integrations/vercel/tools.js"
				);
				const { AuditLogger } = await import("../security/audit-log.js");
				const client = new VercelClient(vc);
				this.vercelClient = client;
				this.sandbox.registerManifest({
					name: "vercel",
					version: "1.0.0",
					description: "Vercel deploy-target integration",
					permissions: ["vercel:read", "vercel:write"],
				});
				const vAudit = new AuditLogger(this.db);
				const vAuditFn = (action: string, details: Record<string, unknown>) =>
					vAudit.log(action, null, details);
				// Reuse the always-on approval queue. Register execute-on-approve
				// handlers against the client; the queue audits queued/executed.
				const approvals = this.githubApprovalsInstance;
				if (approvals) {
					approvals.registerExecutor("vercel_create_project", (row) =>
						client.getOrCreateProject({
							name: String(row.params.name),
							repo: row.params.repo as string | undefined,
							framework: row.params.framework as string | null | undefined,
						}),
					);
					approvals.registerExecutor("vercel_add_domain", (row) =>
						client.addDomain(
							String(row.params.project ?? row.params.name),
							String(row.params.name),
						),
					);
				}
				this.toolRegistry.register(
					createVercelTools(client, {
						audit: vAuditFn,
						approvals: approvals ?? undefined,
					}),
				);
				this.logger.info("Vercel integration initialized");
			} catch (err) {
				this.logger.warn("Vercel init failed — degrading gracefully", {
					error: String(err),
				});
			}
		}

		// Initialize PostHog read integration (agent-readable traffic metrics over
		// the HogQL Query API). READ-ONLY — no approval gating. Disabled by default;
		// needs the private personalApiKey (vault) + a projectId.
		const phc = this.config.posthog;
		if (phc?.enabled && phc.personalApiKey && phc.projectId) {
			try {
				const { PostHogClient } = await import(
					"../integrations/posthog/client.js"
				);
				const { createPostHogTools } = await import(
					"../integrations/posthog/tools.js"
				);
				const client = new PostHogClient(phc);
				this.posthogClient = client;
				this.sandbox.registerManifest({
					name: "posthog",
					version: "1.0.0",
					description: "PostHog analytics read integration",
					permissions: ["posthog:read"],
				});
				this.toolRegistry.register(createPostHogTools(client));
				this.logger.info("PostHog integration initialized");
			} catch (err) {
				this.logger.warn("PostHog init failed — degrading gracefully", {
					error: String(err),
				});
			}
		}

		// Initialize Supabase integration (PostgREST over the service-role key)
		if (this.config.supabase?.enabled && this.config.supabase.serviceKey) {
			try {
				const { SupabaseClient } = await import(
					"../integrations/supabase/client.js"
				);
				const { createSupabaseTools } = await import(
					"../integrations/supabase/tools.js"
				);
				const { AuditLogger } = await import("../security/audit-log.js");
				const client = new SupabaseClient(this.config.supabase);
				this.supabaseClient = client;
				this.sandbox.registerManifest({
					name: "supabase",
					version: "1.0.0",
					description: "Supabase (PostgREST) integration",
					permissions: ["supabase"],
				});
				const sbAudit = new AuditLogger(this.db);
				this.toolRegistry.register(
					createSupabaseTools(client, {
						audit: (action, details) => sbAudit.log(action, null, details),
					}),
				);

				// Typed provisioning tools (DDL) — only when the scoped paw_builder
				// DSN is configured. These use a SEPARATE, least-privilege Postgres
				// connection (USAGE+CREATE on schema `canvas` only); the CRUD tools
				// above keep using PostgREST + the service key. The agent never
				// supplies SQL — DDL is generated from validated specs.
				if (this.config.supabase.builderDsn) {
					const { SupabaseProvisioner } = await import(
						"../integrations/supabase/provisioner.js"
					);
					const { createSupabaseProvisioningTools } = await import(
						"../integrations/supabase/provisioning-tools.js"
					);
					this.supabaseProvisioner = new SupabaseProvisioner(
						this.config.supabase.builderDsn,
						{ timeout: this.config.supabase.timeout },
					);
					this.toolRegistry.register(
						createSupabaseProvisioningTools({
							exec: this.supabaseProvisioner,
							audit: (action, details) => sbAudit.log(action, null, details),
						}),
					);
					this.logger.info(
						"Supabase provisioning tools initialized (canvas yard)",
					);
				}

				this.logger.info("Supabase integration initialized");
			} catch (err) {
				this.logger.warn("Supabase init failed — degrading gracefully", {
					error: String(err),
				});
			}
		}

		// Initialize WordPress integration (REST API + Application Passwords)
		const wp = this.config.wordpress;
		if (wp?.enabled && wp.url && wp.username && wp.appPassword) {
			try {
				const { WordPressClient } = await import(
					"../integrations/wordpress/client.js"
				);
				const { createWordPressTools } = await import(
					"../integrations/wordpress/tools.js"
				);
				const { AuditLogger } = await import("../security/audit-log.js");
				const client = new WordPressClient(wp);
				this.sandbox.registerManifest({
					name: "wordpress",
					version: "1.0.0",
					description: "WordPress REST integration",
					// `wordpress` covers the plugin-inferred tool permission; the media
					// tool also reads workspace files.
					permissions: ["wordpress", "file:read"],
				});
				const wpAudit = new AuditLogger(this.db);
				this.toolRegistry.register(
					createWordPressTools(client, {
						audit: (action, details) => wpAudit.log(action, null, details),
						workspace: this.config.workspace.path,
					}),
				);
				this.logger.info("WordPress integration initialized");
			} catch (err) {
				this.logger.warn("WordPress init failed — degrading gracefully", {
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

		// Escalation valve: the "interrupt the owner" path. A dedicated timer
		// (independent of heartbeat/cron, so it runs even when those are off)
		// scans for overdue/blocked tasks and posts a notification once per
		// task, deduped via last_escalated_at.
		if (this.config.tasks.enabled) {
			const intervalMs = this.config.tasks.escalationIntervalMs;
			const dedupeHours = this.config.tasks.escalationDedupeHours;
			this.taskEscalationInterval = setInterval(() => {
				try {
					const now = new Date().toISOString();
					for (const t of listEscalatable(this.db, now, dedupeHours)) {
						const why =
							t.status === "blocked"
								? "Task is blocked."
								: `Task is past its deadline (due ${t.due_at}).`;
						this.notificationStoreInstance.add({
							kind: "tasks",
							level: "warning",
							title: `Task ${t.status === "blocked" ? "blocked" : "overdue"}: ${t.title}`,
							body: why,
							url: `/tasks#${t.id}`,
						});
						markEscalated(this.db, t.id, now);
					}
				} catch (err) {
					this.logger.error("Task escalation check failed", {
						error: String(err),
					});
				}
			}, intervalMs);
		}

		await this.bus.emit("kernel:ready", undefined);
		this.logger.info("Kernel ready", {
			provider: this.config.provider,
			plugins: this.plugins.map((p) => p.name),
		});
	}

	/**
	 * Execute-on-approve runner: re-run an already-approved tool with its exact
	 * stored params, bypassing ONLY the approval verdict (sandbox + all other
	 * checks still apply, and no fresh approval is enqueued — see ToolRegistry
	 * `bypassApproval`). Returns a flat ok/result/error the approvals queue maps
	 * to `executed`/`failed`. Runs under the original requesting session so
	 * sandbox/skill context matches the gated call. Never throws.
	 */
	private async executeApprovedTool(
		tool: string,
		input: Record<string, unknown>,
		sessionId?: string,
	): Promise<{ ok: boolean; result?: unknown; error?: string }> {
		try {
			const res = await this.toolRegistry.execute(tool, input, sessionId, {
				bypassApproval: true,
			});
			if (res.is_error) return { ok: false, error: res.content };
			return { ok: true, result: res.content };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
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
			playbookCatalog: this.playbookManager.getCatalogPrompt(),
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
			playbookCatalog: this.playbookManager.getCatalogPrompt(),
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

	/**
	 * Bound a session's stored-message growth. Called once per inbound turn
	 * (right after the user message is persisted). Gated on a count check so the
	 * DELETE only runs once a session is well past the cap — cheap on the common
	 * path. `messagePruneKeepLast` stays far above `messageHistoryLimit` so recall
	 * and message FTS search over recent history aren't starved.
	 */
	private pruneSessionIfNeeded(sessionId: string): void {
		const keepLast = this.config.store.messagePruneKeepLast;
		if (countSessionMessages(this.db, sessionId) > keepLast * 2) {
			pruneOldMessages(this.db, sessionId, keepLast);
		}
	}

	private async handleInbound(msg: InboundMessage): Promise<void> {
		// Run-window start: scopes the post-run verdict's tool/task lookups to
		// THIS run (logs accumulate across a session's turns).
		const runStartedAt = new Date().toISOString();
		this.logger.info("Inbound message", {
			channel: msg.channel,
			sessionId: msg.sessionId,
			user: msg.user.id,
		});

		// Internal system channels (cron, heartbeat) bypass rate limiting and access control
		const INTERNAL_CHANNELS = new Set(["cron", "heartbeat", "github", "api"]);
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

		// Access control (pairing code system) — FAIL CLOSED for external channels.
		// Skipped for internal channels and authenticated web sessions, and for the
		// explicit `allowUnapprovedExternal` opt-in. A missing controller denies
		// (never silently opens) — but it's always constructed now, so the pairing
		// flow below runs normally.
		// Default-off, owner-channel-scoped trust for an app relay (e.g. "@Claude")
		// that carries only a shared app id. Empty config → false → app stays gated.
		const relayTrusted = isTrustedRelay({
			appId: msg.origin?.appId,
			channelId: msg.metadata?.slackChannel as string | undefined,
			trustedRelayApps: this.config.security.trustedRelayApps,
		});
		if (
			!isAccessExempt(msg, isInternal) &&
			!this.config.security.allowUnapprovedExternal &&
			!relayTrusted
		) {
			const ac = this.accessController;
			if (!ac?.isUserApproved(msg.user.id, msg.channel)) {
				// Check if this message IS a pairing code (verify → grant).
				const code = msg.content.trim();
				if (
					ac &&
					/^\d{6}$/.test(code) &&
					ac.verifyPairingCode(msg.user.id, code)
				) {
					await this.bus.emit("security:user-approved", {
						userId: msg.user.id,
					});
					await this.bus.emit("message:outbound", {
						sessionId: msg.sessionId,
						channel: msg.channel,
						content: "Access granted! You can now chat with me.",
						metadata: msg.metadata,
					});
					return;
				}

				if (ac) {
					// Generate or retrieve a pairing code and prompt for approval.
					const pairingCode = ac.generatePairingCode(msg.user.id);
					// Log the exact id we gated — pairs with the Slack plugin's
					// raw-inbound log to reveal when a relay presents an unexpected id.
					this.logger.warn("Access denied — pairing code issued", {
						channel: msg.channel,
						user: msg.user.id,
					});
					await this.bus.emit("message:outbound", {
						sessionId: msg.sessionId,
						channel: msg.channel,
						content: unrecognizedUserMessage(msg.user.id, pairingCode),
						metadata: msg.metadata,
					});
				} else {
					// Defensive: no controller (should not happen — always constructed).
					// Fail closed with a generic denial rather than answering.
					this.logger.warn("Access denied — no access controller", {
						channel: msg.channel,
						user: msg.user.id,
					});
					await this.bus.emit("message:outbound", {
						sessionId: msg.sessionId,
						channel: msg.channel,
						content: gateDenialMessage("access_denied"),
						metadata: msg.metadata,
					});
				}
				return;
			}
		}

		const session = getOrCreateSession(
			this.db,
			msg.sessionId,
			msg.channel,
			msg.user.id,
		);
		appendMessage(this.db, msg.sessionId, "user", msg.content);
		this.pruneSessionIfNeeded(msg.sessionId);

		// Auto-generate a clean, human session title from the first user message
		// (canvas messages → the user's request, never the [CANVAS MODE] prompt).
		if (!session.title) {
			updateSessionTitle(
				this.db,
				msg.sessionId,
				sessionTitleFromContent(msg.content),
			);
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
			playbookCatalog: this.playbookManager.getCatalogPrompt(),
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
			// Vision routing: image turns go to the vision provider/model when
			// configured; text turns are untouched. On a vision-provider error we
			// degrade to the default and keep the user's message (with a note).
			const route = this.routeInboundTurn(messages);
			// Inner layer (unchanged): the vision route degrades to the default
			// provider if the vision model errors. Outer layer: the configured
			// main-chat fallback chain (config.ai.fallback), tried only on transient
			// errors. The two compose — a vision degrade that still fails flows on
			// into the fallback chain.
			let visionFellBack = false;
			const primaryAttempt: FallbackAttempt<ChatResponse> = {
				providerName: route.provider.name,
				model: route.model,
				run: async () => {
					const { value, usedFallback } = await withVisionFallback({
						isVision: route.isVision,
						primary: () =>
							route.provider.chat(messages, systemPrompt, msg.sessionId, {
								signal: controller.signal,
							}),
						onFallback: () => {
							this.logger.warn(
								"Vision provider failed; falling back to default",
								{},
							);
							return this.provider.chat(messages, systemPrompt, msg.sessionId, {
								signal: controller.signal,
							});
						},
					});
					visionFellBack = usedFallback;
					return value;
				},
			};
			const fallbackAttempts: FallbackAttempt<ChatResponse>[] =
				this.fallbackChain.map((fb) => ({
					providerName: fb.name,
					model: fb.model,
					run: () =>
						fb.provider.chat(messages, systemPrompt, msg.sessionId, {
							signal: controller.signal,
						}),
				}));
			const {
				value: response,
				used,
				usedFallback: providerFellBack,
			} = await withProviderFallback({
				primary: primaryAttempt,
				fallbacks: fallbackAttempts,
				signal: controller.signal,
				logger: this.logger,
			});
			// Resolve which provider/model actually served the turn (for cost tags)
			// and the single note to prepend, in priority order.
			let usedProviderName: string;
			let usedModel: string;
			let note: string | null | undefined;
			if (providerFellBack) {
				usedProviderName = used.providerName;
				usedModel = used.model;
				note = PROVIDER_FALLBACK_NOTE;
			} else if (visionFellBack) {
				usedProviderName = this.provider.name;
				usedModel = this.config.ai.model;
				note = VISION_ERROR_NOTE;
			} else {
				usedProviderName = route.provider.name;
				usedModel = route.model;
				note = route.note;
			}
			// B6.4: don't fabricate "Done — canvas updated." for an empty
			// canvas reply — we can't confirm a canvas_write actually ran here,
			// and asserting success on a no-op is exactly the hallucination we
			// want to avoid. (The streaming canvas path already uses the raw
			// reply text; this keeps both paths honest.)
			let replyText = response.text || "";
			if (note) replyText = `${note}\n\n${replyText}`;
			appendMessage(this.db, msg.sessionId, "assistant", replyText);

			// M-NEW-12: record cost in the non-stream path too. If the
			// provider returned usage, use it; otherwise fall back to a
			// rough char-based estimate so cost data is non-zero for
			// non-Claude providers. Tagged with the provider/model that served
			// the turn (vision model on the vision route, default after fallback).
			if (this.costTracker) {
				const usageIn = response.usage?.inputTokens;
				const usageOut = response.usage?.outputTokens;
				const inputTokens =
					usageIn ?? estimateTokens(systemPrompt + "\n" + msg.content);
				const outputTokens = usageOut ?? estimateTokens(replyText);
				const model = usedModel;
				this.costTracker.recordUsage({
					sessionId: msg.sessionId,
					provider: usedProviderName ?? this.config.provider,
					model,
					inputTokens,
					outputTokens,
					estimatedCostUsd: CostTracker.estimateCost(
						model,
						inputTokens,
						outputTokens,
					),
					cacheCreationInputTokens: response.usage?.cacheCreationInputTokens,
					cacheReadInputTokens: response.usage?.cacheReadInputTokens,
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

			// Score this run for phantom success (fail-open, after outbound).
			this.scoreCompletedRun(msg, replyText, runStartedAt);
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

	private async prepareChat(msg: InboundMessage): Promise<
		| {
				messages: ChatMessage[];
				systemPrompt: string;
		  }
		| { denied: GateReason; retryAfterMs?: number }
	> {
		// Internal system channels (cron, heartbeat) bypass rate limiting and access control
		const INTERNAL_CHANNELS = new Set(["cron", "heartbeat", "github", "api"]);
		const isInternal = INTERNAL_CHANNELS.has(msg.channel);

		// Single gate: rate limiting then access control, with the reason kept
		// distinct so the streaming caller can report which one fired.
		const gate = evaluateInboundGate(msg, {
			isInternal,
			rateLimiter: this.rateLimiter,
			accessController: this.accessController,
			allowUnapprovedExternal: this.config.security.allowUnapprovedExternal,
			relayTrusted: isTrustedRelay({
				appId: msg.origin?.appId,
				channelId: msg.metadata?.slackChannel as string | undefined,
				trustedRelayApps: this.config.security.trustedRelayApps,
			}),
		});
		if (!gate.ok) {
			return gate.reason === "rate_limited"
				? { denied: "rate_limited", retryAfterMs: gate.retryAfterMs }
				: { denied: "access_denied" };
		}

		const session = getOrCreateSession(
			this.db,
			msg.sessionId,
			msg.channel,
			msg.user.id,
		);
		appendMessage(this.db, msg.sessionId, "user", msg.content);
		this.pruneSessionIfNeeded(msg.sessionId);

		if (!session.title) {
			updateSessionTitle(
				this.db,
				msg.sessionId,
				sessionTitleFromContent(msg.content),
			);
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
			playbookCatalog: this.playbookManager.getCatalogPrompt(),
			brandBrief: compileBrandBrief(getActiveBrand(this.database)),
		});

		if (msg.channel === "canvas") {
			this.skillManager.activateSkill(msg.sessionId, "canvas");
		}

		return { messages, systemPrompt };
	}

	async *handleInboundStream(msg: InboundMessage): AsyncGenerator<StreamChunk> {
		// Run-window start: scopes the post-run verdict's tool/task lookups to
		// THIS run (logs accumulate across a session's turns).
		const runStartedAt = new Date().toISOString();
		this.logger.info("Inbound stream message", {
			channel: msg.channel,
			sessionId: msg.sessionId,
			user: msg.user.id,
		});

		const prepared = await this.prepareChat(msg);
		if ("denied" in prepared) {
			// De-conflated: report rate-limiting and access denial distinctly so
			// prod logs/clients can tell which gate fired (the streaming path used
			// to emit a single opaque "Access denied or rate limited").
			this.logger.warn(
				prepared.denied === "rate_limited"
					? "Stream rate limited"
					: "Stream access denied",
				{
					user: msg.user.id,
					channel: msg.channel,
					retryAfterMs: prepared.retryAfterMs,
				},
			);
			yield {
				type: "error",
				error: gateDenialMessage(prepared.denied, prepared.retryAfterMs),
			};
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
		let cacheCreationTotal = 0;
		let cacheReadTotal = 0;
		let lastProvider: string | undefined;
		let lastModel: string | undefined;

		// Vision routing: image turns stream from the vision provider/model when
		// configured. The chunk loop is extracted so it can be retried on the
		// default provider if the vision route errors before producing output.
		const route = this.routeInboundTurn(messages);
		let effectiveModel = route.model;
		let effectiveProviderName: string = route.provider.name;
		let producedModelText = false;
		const streamWith = async function* (
			provider: AIProvider,
		): AsyncGenerator<StreamChunk> {
			if (provider.chatStream) {
				for await (const chunk of provider.chatStream(
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
						producedModelText = true;
					}
					if (chunk.type === "usage" && chunk.usage) {
						inputTokensTotal += chunk.usage.inputTokens ?? 0;
						outputTokensTotal += chunk.usage.outputTokens ?? 0;
						cacheCreationTotal += chunk.usage.cacheCreationInputTokens ?? 0;
						cacheReadTotal += chunk.usage.cacheReadInputTokens ?? 0;
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
				const response = await provider.chat(
					messages,
					systemPrompt,
					msg.sessionId,
					{ signal: controller.signal },
				);
				fullText += response.text;
				producedModelText = true;
				yield { type: "text_delta", text: response.text };
				if (response.usage) {
					inputTokensTotal += response.usage.inputTokens;
					outputTokensTotal += response.usage.outputTokens;
				}
			}
		};

		try {
			if (route.note) {
				yield { type: "text_delta", text: `${route.note}\n\n` };
				fullText += `${route.note}\n\n`;
			}
			// Ordered stream attempts for this turn: the route (vision or default)
			// first, then — only on a vision route — the vision degrade to the
			// default provider, then the configured fallback chain. We can only
			// advance before the first model token (a partial stream can't be
			// un-rendered); the vision degrade fires on any pre-token error, the
			// fallback chain only on transient errors.
			const streamAttempts: Array<{
				name: string;
				model: string;
				provider: AIProvider;
				visionDegrade?: boolean;
			}> = [
				{
					name: route.provider.name,
					model: route.model,
					provider: route.provider,
				},
			];
			if (route.isVision) {
				streamAttempts.push({
					name: this.provider.name,
					model: this.config.ai.model,
					provider: this.provider,
					visionDegrade: true,
				});
			}
			for (const fb of this.fallbackChain) {
				streamAttempts.push({
					name: fb.name,
					model: fb.model,
					provider: fb.provider,
				});
			}

			let attemptIdx = 0;
			while (true) {
				try {
					yield* streamWith(streamAttempts[attemptIdx].provider);
					break;
				} catch (streamErr) {
					const next = streamAttempts[attemptIdx + 1];
					const canAdvance =
						!!next &&
						!producedModelText &&
						!controller.signal.aborted &&
						(next.visionDegrade === true || isTransientError(streamErr));
					if (!canAdvance) throw streamErr;
					const advanceNote = next.visionDegrade
						? VISION_ERROR_NOTE
						: PROVIDER_FALLBACK_NOTE;
					this.logger.warn("Stream attempt failed; advancing", {
						from: `${streamAttempts[attemptIdx].name}:${streamAttempts[attemptIdx].model}`,
						to: `${next.name}:${next.model}`,
						error: String(streamErr),
					});
					yield { type: "text_delta", text: `${advanceNote}\n\n` };
					fullText += `${advanceNote}\n\n`;
					effectiveModel = next.model;
					effectiveProviderName = next.provider.name;
					lastModel = undefined;
					lastProvider = undefined;
					inputTokensTotal = 0;
					outputTokensTotal = 0;
					cacheCreationTotal = 0;
					cacheReadTotal = 0;
					attemptIdx++;
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
						lastProvider ?? effectiveProviderName ?? this.config.provider;
					const resolvedModel = lastModel ?? effectiveModel;
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
						cacheCreationInputTokens: cacheCreationTotal || undefined,
						cacheReadInputTokens: cacheReadTotal || undefined,
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

			// Score this run for phantom success (fail-open, post-`done`).
			this.scoreCompletedRun(msg, replyText, runStartedAt);
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
	 * Score a completed run for phantom success (observability Phase 1).
	 * Cross-references the agent's claim (final assistant text) against this
	 * run's tool log + ledger tasks, records a verdict row, and alerts on a
	 * non-ok verdict. Called from BOTH completion paths (stream + non-stream)
	 * since each run traverses exactly one — so it fires once per run.
	 *
	 * FAIL-OPEN: the whole thing is wrapped so a scoring error can never break
	 * or delay a run that already succeeded for the user. `startedAt` scopes the
	 * tool/task lookups to THIS run (logs accumulate across a session's turns).
	 */
	private scoreCompletedRun(
		msg: InboundMessage,
		claimText: string,
		startedAt: string,
	): void {
		try {
			// `startedAt` is ISO ("…T…Z"); tool_log/agent_work created_at use the
			// SQLite `datetime('now')` shape ("… …", a space, no ms/zone). Compare
			// in the SQLite shape — comparing the raw ISO string would drop EVERY
			// row (a space at index 10 sorts before 'T'), blinding the verdict.
			const startedSql = sqliteStamp(startedAt);
			const entries = (
				this.toolLog?.query({ sessionId: msg.sessionId, limit: 500 }) ?? []
			).filter((e) => e.created_at >= startedSql);
			const tasks = listBySession(this.db, msg.sessionId).filter(
				(t) => t.created_at >= startedSql,
			);
			const verdict = recordRunVerdict({
				input: { claimText, toolEntries: entries, sessionTasks: tasks },
				id: crypto.randomUUID(),
				sessionId: msg.sessionId,
				channel: msg.channel,
				userId: msg.user.id,
				startedAt,
				endedAt: new Date().toISOString(),
				recordRun: (row) => recordRun(this.db, row),
				notify: (n) => this.notificationStoreInstance.add(n),
			});
			// Phase 2c — advance the cron card for this autonomous run by its verdict
			// (ok→done, suspect→blocked, error/null→blocked/failed). Cron only; the
			// approval lane owns a parked card (guarded in advanceCardOnVerdict).
			if (this.config.tasks.enabled && msg.channel === "cron") {
				const summary = verdict
					? `Autonomous run ${verdict.verdict} — ${verdict.toolCalls} tool call(s), ${verdict.toolErrors} error(s)${verdict.flags.length ? ` [${verdict.flags.join(", ")}]` : ""}`
					: "Autonomous run completed without a verdict";
				advanceCardOnVerdict(
					this.db,
					msg.sessionId,
					verdict?.verdict ?? null,
					summary,
					(err) =>
						this.logger.warn("Cron card verdict advance failed", {
							error: String(err),
						}),
				);
			}
		} catch (err) {
			this.logger.warn("Run verdict scoring failed", { error: String(err) });
		}
	}

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
			hooks: this.hookManager,
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
	 * Build the optional vision provider — a distinct instance configured with the
	 * vision model (config.ai.vision), reusing the chosen provider's existing
	 * config + vault/credential key (no new secret storage). Null when unconfigured,
	 * disabled, or the provider has no key. Sets this.visionModel as a side effect.
	 */
	/**
	 * Construct a fresh provider instance for `name`, overridden to `model`,
	 * reusing that provider's existing config + credential key (no new secret
	 * storage). Returns null if the provider needs a key it doesn't have. Shared
	 * by the vision route and the fallback chain so both build instances the same
	 * way — the model lives on the provider at construction, so a different model
	 * always means a distinct instance.
	 */
	private instantiateProvider(
		name: "claude" | "ollama" | "openai" | "gemini",
		model: string,
		config: PawConfig,
		logger: ReturnType<typeof createLogger>,
	): AIProvider | null {
		const maxRoundtrips = config.ai.maxToolRoundtrips;
		switch (name) {
			case "claude":
				if (!config.ai.apiKey) return null;
				return new ClaudeProvider(
					{ ...config.ai, model },
					this.toolRegistry,
					logger,
					this.skillManager,
				);
			case "openai":
				if (!config.openai.apiKey) return null;
				return new OpenAIProvider(
					{ ...config.openai, model, maxToolRoundtrips: maxRoundtrips },
					this.toolRegistry,
					logger,
					this.skillManager,
				);
			case "gemini":
				if (!config.gemini.apiKey) return null;
				return new GeminiProvider(
					{ ...config.gemini, model, maxToolRoundtrips: maxRoundtrips },
					this.toolRegistry,
					logger,
					this.skillManager,
				);
			case "ollama":
				return new OllamaProvider(
					{
						...config.ollama,
						model,
						maxToolRoundtrips: maxRoundtrips,
						maxTokens: config.ai.maxTokens,
					},
					this.toolRegistry,
					logger,
					this.skillManager,
				);
		}
	}

	private buildVisionProvider(
		config: PawConfig,
		logger: ReturnType<typeof createLogger>,
	): AIProvider | null {
		const v = config.ai.vision;
		if (!v || v.enabled === false) return null;
		const model = v.model;
		try {
			const provider = this.instantiateProvider(
				v.provider,
				model,
				config,
				logger,
			);
			if (!provider) {
				this.logger.warn("Vision provider not initialized (no API key)", {
					provider: v.provider,
				});
				return null;
			}
			this.visionModel = model;
			this.logger.info("Vision route enabled", { provider: v.provider, model });
			return provider;
		} catch (err) {
			this.logger.warn("Failed to init vision provider", {
				provider: v.provider,
				error: String(err),
			});
			return null;
		}
	}

	/**
	 * Build the ordered main-chat fallback chain from config.ai.fallback. Each
	 * entry becomes its own provider+model instance (skipped if its provider has
	 * no key). The chain is tried in order when the primary errors transiently
	 * (see withProviderFallback). Empty config ⇒ empty chain ⇒ today's behavior.
	 */
	private buildFallbackChain(
		config: PawConfig,
		logger: ReturnType<typeof createLogger>,
	): Array<{ provider: AIProvider; model: string; name: string }> {
		const chain: Array<{ provider: AIProvider; model: string; name: string }> =
			[];
		for (const entry of config.ai.fallback ?? []) {
			try {
				const provider = this.instantiateProvider(
					entry.provider,
					entry.model,
					config,
					logger,
				);
				if (provider) {
					chain.push({ provider, model: entry.model, name: entry.provider });
				} else {
					this.logger.warn("Fallback provider skipped (no API key)", {
						provider: entry.provider,
					});
				}
			} catch (err) {
				this.logger.warn("Failed to init fallback provider", {
					provider: entry.provider,
					error: String(err),
				});
			}
		}
		if (chain.length > 0) {
			this.logger.info("Provider fallback chain ready", {
				chain: chain.map((c) => `${c.name}:${c.model}`),
			});
		}
		return chain;
	}

	/** True when the latest user turn carries an image attachment. */
	private lastUserHasImage(messages: ChatMessage[]): boolean {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role !== "user") continue;
			return !!messages[i].attachments?.some((a) => a.type === "image");
		}
		return false;
	}

	/**
	 * Whether the default provider can natively see images. Heuristic: Claude /
	 * OpenAI / Gemini can; Ollama is treated as text-only (point ai.vision at a
	 * vision Ollama model to route there and silence the can't-see note).
	 */
	private defaultCanSeeImages(): boolean {
		return ["claude", "openai", "gemini"].includes(this.config.provider);
	}

	/**
	 * Resolve the provider + model + any note for an inbound turn. Image turns go
	 * to the vision provider when configured; otherwise the default route is
	 * untouched (a can't-see note is attached only when an image can't be handled).
	 */
	private routeInboundTurn(messages: ChatMessage[]): {
		provider: AIProvider;
		model: string;
		isVision: boolean;
		note: string | null;
	} {
		const hasImage = this.lastUserHasImage(messages);
		const plan = planImageTurn({
			hasImage,
			visionConfigured: !!this.visionProvider,
			defaultCanSeeImages: this.defaultCanSeeImages(),
		});
		if (plan.useVision && this.providerRouter && this.visionModel) {
			return {
				provider: this.providerRouter.selectForImageTurn(true),
				model: this.visionModel,
				isVision: true,
				note: null,
			};
		}
		return {
			provider: this.provider,
			model: this.config.ai.model,
			isVision: false,
			note: plan.note === "unconfigured" ? VISION_UNCONFIGURED_NOTE : null,
		};
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
		if (this.taskEscalationInterval) {
			clearInterval(this.taskEscalationInterval);
			this.taskEscalationInterval = null;
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
		if (this.supabaseProvisioner) {
			try {
				await this.supabaseProvisioner.close();
			} catch (err) {
				this.logger.error("Supabase provisioner close failed", {
					error: String(err),
				});
			}
		}
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

	get playbooks(): PlaybookManager {
		return this.playbookManager;
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

	/** Snapshot of spawned agents (running + finished within the linger window),
	 * for the Dashboard ops-scene. Lazily prunes entries that have lingered. */
	get activeAgents(): Array<{
		id: string;
		name: string;
		task: string;
		done: boolean;
		ok: boolean;
		ageMs: number;
	}> {
		const now = Date.now();
		const LINGER = 5000;
		const out: Array<{
			id: string;
			name: string;
			task: string;
			done: boolean;
			ok: boolean;
			ageMs: number;
		}> = [];
		for (const [id, a] of this.activeAgentsMap) {
			if (a.done && a.finishedAt && now - a.finishedAt > LINGER) {
				this.activeAgentsMap.delete(id);
				continue;
			}
			out.push({
				id,
				name: a.name,
				task: a.task,
				done: !!a.done,
				ok: a.ok !== false,
				ageMs: now - a.startedAt,
			});
		}
		return out;
	}

	/** Read-only access to the tool registry (H-NEW-2: cron tool validation). */
	get toolRegistryPublic(): ToolRegistry {
		return this.toolRegistry;
	}

	/** Lifecycle hook layer (tool guardrails/metrics; plugins register here). */
	get hooks(): HookManager {
		return this.hookManager;
	}

	/** Strapi client for routing canvas action submissions (null if disabled). */
	get strapi(): import("../integrations/strapi/client.js").StrapiClient | null {
		return this.strapiClient;
	}

	/** Supabase CRUD client for routing 'supabase' canvas actions (null if disabled). */
	get supabase():
		| import("../integrations/supabase/client.js").SupabaseClient
		| null {
		return this.supabaseClient;
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

	/** Vercel deploy-target client (null if disabled or not configured). */
	get vercel(): import("../integrations/vercel/client.js").VercelClient | null {
		return this.vercelClient;
	}

	/** PostHog read client — agent-readable analytics (read-only). */
	get posthog():
		| import("../integrations/posthog/client.js").PostHogClient
		| null {
		return this.posthogClient;
	}

	/** Access control (pairing codes + approved users) — drives the /access page. */
	get access(): AccessController | null {
		return this.accessController;
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

	/** Registered agent names (config-loaded). Used by the task board's Start. */
	get agentNames(): string[] {
		return this.agentRegistry.agentNames;
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

		// Trust boundary: snapshot + diff each MCP server's tool schemas. Grouped
		// here because every (re)discovery path — boot + every reconnect endpoint —
		// funnels through registerTools, so detection rides along with no extra
		// wiring. Uses the full discovered batch (`tools`), not the
		// collision-filtered `accepted`. Never throws (runSchemaDrift wraps it).
		// Caveat: a server returning ZERO tools is skipped by callers' length
		// guard, so a full-server disappearance isn't flagged until it serves a
		// tool again; individual tool removals (server still serving others) are.
		for (const plugin of seen) {
			this.detectMcpSchemaDrift(
				plugin.slice(4), // strip "mcp:"
				tools.filter((t) => t.plugin === plugin),
			);
		}
	}

	/**
	 * Snapshot + diff an MCP server's tool schemas. Drift surfaces as an event +
	 * audit entry + notification. Wrapped (runSchemaDrift) so a detection failure
	 * can never block an MCP connect.
	 */
	private detectMcpSchemaDrift(
		serverName: string,
		tools: ToolDefinition[],
	): void {
		const audit = new AuditLogger(this.db);
		runSchemaDrift(this.db, serverName, tools, {
			notify: (n) =>
				this.notificationStoreInstance?.add({
					kind: "mcp",
					title: n.title,
					body: n.body,
					url: n.url,
					level: n.level,
				}),
			audit: (action, details) => audit.log(action, null, details),
			emit: (event) => void this.bus.emit("mcp:schema-drift", event),
			log: (message, meta) => this.logger.warn(message, meta),
		});
	}
}
