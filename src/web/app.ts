import type { Database } from "bun:sqlite";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { logger as honoLogger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import type { StreamChunk } from "../ai/base-provider.js";
import {
	type StoredCredentials,
	loadCredentials as loadStoredCredentials,
	saveCredentials,
} from "../auth/credential-store.js";
import {
	readConfigOverrides,
	replaceConfigOverride,
	saveConfigOverrides,
} from "../config/writer.js";
import { isValidCron } from "../cron/parser.js";
import { resolveCronAction } from "../cron/scheduler.js";
import { approvalLabel } from "../integrations/github/approvals.js";
import type { Kernel } from "../kernel/kernel.js";
import {
	dedupeMcpServers,
	normalizeMcpName,
	removeMcpServer,
	upsertMcpServer,
} from "../mcp/normalize.js";
import { createLogger } from "../observability/logger.js";
import { resolveProjectPath } from "../paths.js";
import { RateLimiter } from "../security/rate-limiter.js";
import { buildOtpauthUri } from "../security/totp.js";
import { KNOWN_SECRET_SLOTS, type VaultScope } from "../security/vault.js";
import { WebAuthManager } from "../security/web-auth.js";
import {
	type BrandDefinition,
	activateBrand,
	compileBrandBrief,
	createBrand,
	deleteBrand,
	getActiveBrand,
	getBrand,
	getBrandPalette,
	getBrandUi,
	listBrands,
	renderBrandAppThemeCss,
	renderBrandTokensCss,
	updateBrand,
} from "../store/brands.js";
import { getSessionMessages, searchMessages } from "../store/messages.js";
import {
	createPrompt,
	deletePrompt,
	getPrompt,
	listPrompts,
	recordPromptUse,
	updatePrompt,
} from "../store/prompts.js";
import {
	countAllSessions,
	deleteSession,
	deleteSessionOwnedBy,
	forkSessionAtMessage,
	forkSessionOwnedBy,
	getSessionOwnedBy,
	getSessionWithMessages,
	listRecentSessions,
	listRecentSessionsForUser,
	updateSessionTitle,
	updateSessionTitleOwnedBy,
} from "../store/sessions.js";
import type { PawConfig } from "../types/config.js";
import { APP_NAMESPACE, clearCanvasPreservingApps } from "./app-spaces.js";
import { ASSET_VERSION } from "./asset-version.js";
import {
	canvasContentType,
	canvasFileFromUrlPath,
	injectCanvasRuntime,
	shouldServeCompanion,
} from "./canvas-serve.js";
import { CANVAS_TEMPLATES } from "./canvas-templates.js";
import { type ExportFormat, exportSession } from "./exporters.js";
import { parseUploadedFiles } from "./file-parser.js";
import { generateLlmsDocs } from "./llms-docs.js";
import { metricsSnapshot, recordRequest } from "./metrics.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createSecurityHeaders } from "./middleware/security-headers.js";
import {
	ACTION_LIMIT_PER_MIN,
	APP_ASSET_LIMIT_PER_MIN,
	CHROME_LIMIT_PER_MIN,
	LIVE_LIMIT_PER_MIN,
	type RateClass,
	chrome429ContentType,
	resolveRateClass,
} from "./rate-limit-policy.js";
import { createCanvasEditRoutes } from "./routes/canvas-edit.js";
import { createFormReceiver } from "./routes/forms.js";
import { createOpenAiApi } from "./routes/openai-api.js";
import { buildOpsFeed } from "./routes/ops-feed.js";
import { AccessPage, recognizedIds } from "./views/access-page.js";
import { AuditPage, type AuditRow } from "./views/audit-page.js";
import { ChatPage, getChatScript } from "./views/chat.js";
// canvas-page.tsx removed — canvas is now merged into chat
import { CronPage } from "./views/cron-page.js";
import { GitHubPage } from "./views/github-page.js";
import { HeartbeatPage } from "./views/heartbeat-page.js";
import { LoginPage } from "./views/login-page.js";
import { MCPPage } from "./views/mcp-page.js";
import { MemoryPage } from "./views/memory-page.js";
import { NotificationsPage } from "./views/notifications-page.js";
import { OpsPage } from "./views/ops-page.js";
import { PromptsPage } from "./views/prompts-page.js";
import { type SearchHit, SearchPage } from "./views/search-page.js";
import { SessionDetailPage, SessionsListPage } from "./views/sessions-page.js";
import { SettingsPage } from "./views/settings-page.js";
import { SkillsPage } from "./views/skills-page.js";
import {
	type CanvasAction,
	type CanvasSubmission,
	SubmissionsPage,
} from "./views/submissions-page.js";
import { type ToolLogRow, ToolsPage } from "./views/tools-page.js";
import { TotpSetupPage } from "./views/totp-setup-page.js";
import { VaultPage, type VaultSlotStatus } from "./views/vault-page.js";
import { VercelPage } from "./views/vercel-page.js";
import { WebhooksPage } from "./views/webhooks-page.js";

// Fields that cannot be modified through the web config form
const BLOCKED_CONFIG_FIELDS = new Set([
	"ai.apiKey",
	"openai.apiKey",
	"gemini.apiKey",
	"slack.botToken",
	"slack.appToken",
	"slack.signingSecret",
	"web.authToken",
	// PostHog personal API key is vault-only (slot `posthog.personalApiKey`); the
	// /settings UI renders no input for it, but block it so it can never be written
	// to plaintext config via a hand-crafted form POST.
	"posthog.personalApiKey",
]);

type SecretStatusRow = {
	id: string;
	label: string;
	set: boolean;
	fromEnv?: boolean;
};

/**
 * Derive the per-request `userId` for ownership scoping of sessions,
 * memories, and webhooks. The web UI has multiple admin accounts, so we
 * can't use a single shared identifier — that would let any admin read
 * or delete any other admin's data (C-NEW-1). Format: `web-{adminId}`.
 * Returns `null` when no admin is on the request (bearer token, public
 * route) so callers can decide whether to allow the request.
 */
function getRequestUserId(c: Context): string | null {
	const admin = c.get("admin") as { id: number } | undefined;
	return admin ? `web-${admin.id}` : null;
}

/**
 * Build the read-only list of API-key / token statuses shown in the
 * config page. Secrets are reported as Set/Missing and sourced-from so
 * the UI can offer a Rotate action — raw values never leave the server.
 */
function computeSecretStatuses(): SecretStatusRow[] {
	/** biome-ignore lint/correctness/noUnusedVariables: imported lazily */
	const creds = loadStoredCredentials();
	const rows: SecretStatusRow[] = [];
	const envSet = (v: string | undefined): boolean =>
		typeof v === "string" && v.length > 0;

	rows.push({
		id: "anthropic",
		label: "Anthropic API key",
		set:
			(creds.anthropic?.method === "api_key" && !!creds.anthropic.apiKey) ||
			envSet(process.env.ANTHROPIC_API_KEY),
		fromEnv: !creds.anthropic?.apiKey && envSet(process.env.ANTHROPIC_API_KEY),
	});
	rows.push({
		id: "openai",
		label: "OpenAI API key",
		set: !!creds.openai?.apiKey || envSet(process.env.OPENAI_API_KEY),
		fromEnv: !creds.openai?.apiKey && envSet(process.env.OPENAI_API_KEY),
	});
	rows.push({
		id: "gemini",
		label: "Gemini API key",
		set: !!creds.gemini?.apiKey || envSet(process.env.GEMINI_API_KEY),
		fromEnv: !creds.gemini?.apiKey && envSet(process.env.GEMINI_API_KEY),
	});
	rows.push({
		id: "ollama",
		label: "Ollama API key",
		set: !!creds.ollama?.apiKey || envSet(process.env.PAW_OLLAMA_API_KEY),
		fromEnv: !creds.ollama?.apiKey && envSet(process.env.PAW_OLLAMA_API_KEY),
	});
	rows.push({
		id: "slack.bot",
		label: "Slack bot token",
		set: !!creds.slack?.botToken || envSet(process.env.SLACK_BOT_TOKEN),
		fromEnv: !creds.slack?.botToken && envSet(process.env.SLACK_BOT_TOKEN),
	});
	rows.push({
		id: "slack.app",
		label: "Slack app token",
		set: !!creds.slack?.appToken || envSet(process.env.SLACK_APP_TOKEN),
		fromEnv: !creds.slack?.appToken && envSet(process.env.SLACK_APP_TOKEN),
	});
	rows.push({
		id: "slack.signing",
		label: "Slack signing secret",
		set:
			!!creds.slack?.signingSecret || envSet(process.env.SLACK_SIGNING_SECRET),
		fromEnv:
			!creds.slack?.signingSecret && envSet(process.env.SLACK_SIGNING_SECRET),
	});
	return rows;
}

function readTotals(db: import("bun:sqlite").Database): {
	sessions: number;
	messages: number;
} {
	try {
		const sessions =
			db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sessions").get()
				?.n ?? 0;
		const messages =
			db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM messages").get()
				?.n ?? 0;
		return { sessions, messages };
	} catch {
		return { sessions: 0, messages: 0 };
	}
}

export interface SceneNode {
	key: string;
	label: string;
	kind: "skill" | "service";
}

function prettifyName(s: string): string {
	return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/** The skill / MCP / service node set for the Dashboard agent-ops scene — the
 * same source the canvas portrait uses (app.ts portrait `rawNodes`). */
function agentSceneNodes(kernel: Kernel): SceneNode[] {
	const nodes: SceneNode[] = [];
	const seen = new Set<string>();
	const add = (n: SceneNode) => {
		const k = n.key.toLowerCase();
		if (seen.has(k)) return;
		seen.add(k);
		nodes.push(n);
	};
	try {
		for (const name of kernel.skills.skillNames ?? [])
			add({ key: name, label: prettifyName(name), kind: "skill" });
		for (const s of kernel.mcpManager
			.getServerInfo()
			.filter((s) => s.connected))
			add({
				key: `mcp:${s.name}`,
				label: prettifyName(s.name),
				kind: "service",
			});
		if (kernel.strapi) add({ key: "strapi", label: "Strapi", kind: "service" });
	} catch {
		/* fresh DB / not-ready subsystems → render what we have */
	}
	return nodes.slice(0, 14);
}

/** Map a tool-log row to a scene node key (mirrors the portrait's enrichChunk):
 * skill grouping first, then plugin-based mcp/strapi fallback. */
function skillKeyForToolRow(
	kernel: Kernel,
	row: { tool_name: string; plugin: string | null },
): string | null {
	const clean = row.tool_name.replace(/^\[[^\]]+\]\s*/, "");
	try {
		const skill = kernel.skills.skillNameForTool(clean);
		if (skill) return skill;
	} catch {
		/* ignore */
	}
	if (row.plugin === "strapi") return "strapi";
	// MCP tools already store plugin as "mcp:<server>" (client-manager.ts), which
	// is exactly the scene-node key — don't double-prefix it to "mcp:mcp:<server>"
	// (that misses the lane and dumps the op into core).
	if (row.plugin)
		return row.plugin.startsWith("mcp:") ? row.plugin : `mcp:${row.plugin}`;
	return null;
}

/**
 * Condense a GitHub webhook payload into a short feed item for the /github UI.
 * Returns null for events we don't surface (keeps the feed signal-dense).
 */
function summarizeGithubWebhook(
	eventType: string,
	payload: Record<string, unknown>,
): Record<string, unknown> | null {
	const repo = (payload.repository as { full_name?: string } | undefined)
		?.full_name;
	switch (eventType) {
		case "pull_request": {
			const pr = payload.pull_request as
				| { number?: number; title?: string; html_url?: string }
				| undefined;
			return {
				repo,
				summary: `PR #${pr?.number} ${String(payload.action)}: ${pr?.title ?? ""}`,
				url: pr?.html_url,
			};
		}
		case "check_run":
		case "check_suite": {
			const cr = payload[eventType] as
				| { status?: string; conclusion?: string; name?: string }
				| undefined;
			return {
				repo,
				summary: `${eventType} ${cr?.name ?? ""}: ${cr?.status ?? ""}${
					cr?.conclusion ? ` (${cr.conclusion})` : ""
				}`,
			};
		}
		case "workflow_run": {
			const wr = payload.workflow_run as
				| {
						name?: string;
						status?: string;
						conclusion?: string;
						html_url?: string;
				  }
				| undefined;
			return {
				repo,
				summary: `workflow "${wr?.name ?? ""}" ${wr?.status ?? ""}${
					wr?.conclusion ? ` (${wr.conclusion})` : ""
				}`,
				url: wr?.html_url,
			};
		}
		case "push": {
			return {
				repo,
				summary: `push to ${String(payload.ref ?? "").replace("refs/heads/", "")}`,
			};
		}
		default:
			return null;
	}
}

export function createWebApp(
	kernel: Kernel,
	config: PawConfig,
	db?: Database,
): Hono {
	const app = new Hono();
	const database = db ?? kernel.database;
	// Per-boot asset version → cache-busts the companion static modules so each
	// deploy serves fresh JS/CSS (they ship Cache-Control max-age). Without this,
	// a stale cached shell.js renders the old UI against the new bootstrap cfg.
	// (ASSET_VERSION is imported from ./asset-version.js so Layout uses the same value.)

	// --- Auth Manager ---
	const authManager = new WebAuthManager(database, {
		maxAgeMinutes: config.web.session.maxAgeMinutes,
		idleTimeoutMinutes: config.web.session.idleTimeoutMinutes,
	});

	// A served canvas page injects the in-context companion ONLY for an
	// authenticated admin. On PUBLIC canvas routes (preview/share) the auth
	// middleware short-circuits without validating the session cookie, so check
	// it here directly; on the authed app-space route the middleware already set
	// `admin`. Anonymous visitors get a byte-clean page (no companion code).
	const isCanvasCompanionVisitor = (c: Context): boolean =>
		shouldServeCompanion({
			admin: c.get("admin"),
			sessionToken: getCookie(c, "paw_session") ?? null,
			validateSession: (token) => authManager.validateSession(token),
		});

	// --- Login rate limiter (5 attempts/min per IP) ---
	const loginRateLimiter = new RateLimiter(5);
	// --- Global API rate limiters, one per traffic class (see
	// rate-limit-policy.ts). Strict "action" budget for real API calls;
	// generous, independent budgets for app-space assets, per-render brand
	// chrome, and interval/live reads so they can't starve actions. ---
	const rateLimiters: Record<RateClass, RateLimiter> = {
		action: new RateLimiter(ACTION_LIMIT_PER_MIN),
		"app-asset": new RateLimiter(APP_ASSET_LIMIT_PER_MIN),
		chrome: new RateLimiter(CHROME_LIMIT_PER_MIN),
		live: new RateLimiter(LIVE_LIMIT_PER_MIN),
	};

	// Trusted proxy config — only trust X-Forwarded-For when set
	const trustedProxy = config.web.trustedProxy ?? false;

	/** Extract client IP, respecting trustedProxy config */
	function getClientIp(c: Context): string {
		if (trustedProxy) {
			const forwarded = c.req.header("x-forwarded-for");
			if (forwarded) return forwarded.split(",")[0].trim();
			const realIp = c.req.header("x-real-ip");
			if (realIp) return realIp;
		}
		return (c.env as any)?.remoteAddress ?? "unknown";
	}

	// Build allowed origins for CSRF validation
	const allowedOrigins = new Set<string>();
	allowedOrigins.add(`http://${config.web.host}:${config.web.port}`);
	allowedOrigins.add(`https://${config.web.host}:${config.web.port}`);
	if (config.web.host === "0.0.0.0" || config.web.host === "127.0.0.1") {
		allowedOrigins.add(`http://localhost:${config.web.port}`);
		allowedOrigins.add(`https://localhost:${config.web.port}`);
	}

	// Canvas workspace root — resolved early because the security-headers
	// middleware (below) reads per-space CSP overrides from app manifests under it.
	const canvasRoot = resolveProjectPath(
		config.web.canvas?.root ?? "./data/canvas",
	);

	// --- Middleware Stack ---

	// Request logging
	app.use("*", honoLogger());

	// Real request-rate counter for the Heartbeat console (req/s). Cheap; pushes
	// a timestamp into a rolling 60s window. No-op beyond that.
	app.use("*", (c, next) => {
		recordRequest();
		return next();
	});

	// Security headers
	app.use("*", createSecurityHeaders(config.web.tls.enabled, { canvasRoot }));

	// Body size limit (5MB)
	app.use("*", bodyLimit({ maxSize: 5 * 1024 * 1024 }));

	// CSRF protection — skip for Bearer token API calls and incoming webhooks
	app.use("*", async (c, next) => {
		const authHeader = c.req.header("Authorization");
		if (authHeader?.startsWith("Bearer ")) {
			return next();
		}
		// Skip CSRF for GET/HEAD/OPTIONS
		if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
			return next();
		}
		// Skip CSRF for incoming webhook endpoints (external services)
		if (c.req.path.startsWith("/api/webhooks/incoming/")) {
			return next();
		}
		// Skip CSRF for the GitHub App webhook (verified by HMAC signature instead).
		if (c.req.path === "/api/github/webhook") {
			return next();
		}
		// Skip CSRF for public canvas form receivers — these are submitted by
		// sandboxed canvas pages (Origin: null) and bound to a typed action that
		// only ever routes to its declared destination. Abuse is bounded by the
		// per-action rate limit + honeypot + field allowlist on the handler.
		if (c.req.path.startsWith("/api/forms/")) {
			return next();
		}
		return csrf({ origin: (origin) => allowedOrigins.has(origin) })(c, next);
	});

	// --- Webhook Receiver (before auth — external services don't have sessions) ---
	app.post("/api/webhooks/incoming/:slug", async (c) => {
		const slug = c.req.param("slug");
		const webhook = database
			.prepare("SELECT * FROM webhooks WHERE slug = ?")
			.get(slug) as {
			id: string;
			name: string;
			slug: string;
			secret: string | null;
			event_type: string;
			active: number;
		} | null;

		if (!webhook || !webhook.active) {
			return c.json({ error: "Webhook not found" }, 404);
		}

		let body: unknown = null;
		try {
			body = await c.req.json();
		} catch {
			try {
				body = await c.req.text();
			} catch {
				body = null;
			}
		}

		// HMAC signature verification (if secret is set)
		if (webhook.secret) {
			const sigHeader =
				c.req.header("x-paw-signature") ?? c.req.header("x-hub-signature-256");
			if (!sigHeader) {
				database.run(
					"INSERT INTO webhook_logs (webhook_id, status, headers_json, body_json, error) VALUES (?, 'error', ?, ?, ?)",
					[
						webhook.id,
						JSON.stringify(Object.fromEntries(c.req.raw.headers)),
						JSON.stringify(body),
						"Missing signature header",
					],
				);
				return c.json({ error: "Missing signature" }, 401);
			}

			const rawBody = typeof body === "string" ? body : JSON.stringify(body);
			const key = await crypto.subtle.importKey(
				"raw",
				new TextEncoder().encode(webhook.secret),
				{ name: "HMAC", hash: "SHA-256" },
				false,
				["sign"],
			);
			const sig = await crypto.subtle.sign(
				"HMAC",
				key,
				new TextEncoder().encode(rawBody),
			);
			const expected =
				"sha256=" +
				Array.from(new Uint8Array(sig))
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");

			const provided = sigHeader.startsWith("sha256=")
				? sigHeader
				: `sha256=${sigHeader}`;
			if (expected !== provided) {
				database.run(
					"INSERT INTO webhook_logs (webhook_id, status, headers_json, body_json, error) VALUES (?, 'error', ?, ?, ?)",
					[
						webhook.id,
						JSON.stringify(Object.fromEntries(c.req.raw.headers)),
						JSON.stringify(body),
						"Invalid signature",
					],
				);
				return c.json({ error: "Invalid signature" }, 401);
			}
		}

		// Log the delivery
		database.run(
			"INSERT INTO webhook_logs (webhook_id, status, headers_json, body_json) VALUES (?, 'ok', ?, ?)",
			[
				webhook.id,
				JSON.stringify(Object.fromEntries(c.req.raw.headers)),
				JSON.stringify(body),
			],
		);

		// Update trigger count and timestamp
		database.run(
			"UPDATE webhooks SET trigger_count = trigger_count + 1, last_triggered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
			[webhook.id],
		);

		// Fire event async (don't block the response)
		const headers: Record<string, string> = {};
		c.req.raw.headers.forEach((v, k) => {
			headers[k] = v;
		});

		kernel.eventBus
			.emit(webhook.event_type as "webhook:inbound", {
				webhookId: webhook.id,
				webhookName: webhook.name,
				slug: webhook.slug,
				headers,
				body,
				timestamp: new Date().toISOString(),
			})
			.catch((err) => {
				kernel.eventBus
					.emit("webhook:error", {
						webhookId: webhook.id,
						slug: webhook.slug,
						error: err instanceof Error ? err.message : String(err),
					})
					.catch(() => {});
			});

		return c.json({ ok: true });
	});

	// --- Public canvas form receiver (before auth — canvas pages are the public
	// face) --- Extracted into src/web/routes/forms.ts so it has app-level tests;
	// mounted here BEFORE the session-auth middleware so it stays public (the
	// require_auth gate is per-action, via isAuthenticated below).
	app.route(
		"/",
		createFormReceiver({
			db: kernel.database,
			toolRegistry: kernel.toolRegistryPublic,
			strapi: kernel.strapi,
			hubspotClient: kernel.hubspotClient,
			supabase: kernel.supabase,
			getClientIp,
			isAuthenticated: (c) => {
				const sessionToken = getCookie(c, "paw_session");
				if (sessionToken && authManager.validateSession(sessionToken))
					return true;
				const authHeader = c.req.header("Authorization");
				return (
					!!config.web.authToken &&
					authHeader === `Bearer ${config.web.authToken}`
				);
			},
		}),
	);

	// OpenAI-compatible API (B7). Mounted BEFORE the session-auth middleware so it
	// stays cookie-auth-free — it does its own bearer check (vault api.bearerToken)
	// and is disabled when no key is set. Rate-limited (action class) per IP.
	app.route(
		"/",
		createOpenAiApi({
			runTurn: (msg) => kernel.handleInboundStream(msg),
			getBearer: () =>
				kernel.vault.get("api.bearerToken") || liveConfig().api.bearerToken,
			rateLimit: (ip) => rateLimiters.action.check(ip),
			getClientIp,
			listModels: () => {
				const primary = currentModel();
				const vision = liveConfig().ai.vision?.model;
				return vision && vision !== primary ? [primary, vision] : [primary];
			},
		}),
	);

	// Session auth middleware
	app.use(
		"*",
		createAuthMiddleware({
			authManager,
			bearerToken: config.web.authToken,
		}),
	);

	// Global API rate limiting, per traffic class (see rate-limit-policy.ts):
	// the strict "action" budget is unchanged; chrome/live/app-asset reads get
	// their own generous budgets so they can't starve it.
	app.use("/api/*", async (c, next) => {
		const ip = getClientIp(c);
		const cls = resolveRateClass(c.req.method, c.req.path);
		const { allowed, retryAfterMs } = rateLimiters[cls].check(ip);
		if (!allowed) {
			const retryAfter = String(Math.ceil((retryAfterMs ?? 60000) / 1000));
			c.header("Retry-After", retryAfter);
			if (cls === "chrome") {
				// Match the asset's content-type so a limited <link>/fetch degrades
				// to "unthemed" instead of throwing a MIME console error.
				const ct = chrome429ContentType(c.req.path);
				if (ct) c.header("Content-Type", ct);
				return c.body(c.req.path === "/api/brand/ui" ? "{}" : "", 429);
			}
			return c.json({ error: "Too many requests" }, 429);
		}
		return next();
	});

	// --- Auth Routes ---

	app.get("/login", (c) => {
		// If no admins exist, show the setup page
		if (!authManager.hasAdmins()) {
			return c.html(LoginPage({ setupMode: true }));
		}
		return c.html(LoginPage({}));
	});

	app.post("/login", async (c) => {
		const ip = getClientIp(c);

		// Rate limit check
		const { allowed } = loginRateLimiter.check(ip);
		if (!allowed) {
			return c.html(
				LoginPage({ error: "Too many login attempts. Please wait a minute." }),
			);
		}

		const body = await c.req.parseBody();
		const username = String(body.username ?? "");
		const password = String(body.password ?? "");
		const totpCode = body.totp ? String(body.totp) : undefined;

		if (!username || !password) {
			return c.html(LoginPage({ error: "Username and password are required" }));
		}

		// Destroy any existing session tied to the incoming cookie before
		// authenticating. This prevents session-fixation: an attacker who
		// pre-set the victim's cookie to a known value can no longer have
		// it promoted to an authenticated session.
		const existingToken = getCookie(c, "paw_session");
		if (existingToken) {
			try {
				authManager.logout(existingToken);
			} catch {
				// Best-effort cleanup; do not block login on this.
			}
		}

		const result = await authManager.login(username, password, totpCode, ip);

		if (result.requireTotp) {
			return c.html(
				LoginPage({
					requireTotp: true,
					error: "Please enter your authenticator code",
				}),
			);
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
			return c.html(
				LoginPage({ setupMode: true, error: "Username is required" }),
			);
		}
		if (password.length < 8) {
			return c.html(
				LoginPage({
					setupMode: true,
					error: "Password must be at least 8 characters",
				}),
			);
		}
		if (password !== confirmPassword) {
			return c.html(
				LoginPage({ setupMode: true, error: "Passwords do not match" }),
			);
		}

		try {
			const adminId = await authManager.createAdmin(username, password);
			const ip = getClientIp(c);
			authManager.audit.log(
				"admin.created",
				adminId,
				{ username, via: "web-setup" },
				ip,
			);

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
		const admin = c.get("admin") as
			| {
					id: number;
					username: string;
					totp_secret: string | null;
					totp_verified: number;
			  }
			| undefined;

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
		const admin = c.get("admin") as
			| { id: number; username: string; totp_secret: string | null }
			| undefined;

		if (!session || !admin) {
			return c.redirect("/login");
		}

		const body = await c.req.parseBody();
		const code = String(body.code ?? "");

		if (!code || code.length !== 6) {
			const secret = admin.totp_secret ?? authManager.setupTotp(admin.id);
			const otpauthUriStr = buildOtpauthUri(secret, "Paw", admin.username);
			return c.html(
				TotpSetupPage({
					secret,
					otpauthUri: otpauthUriStr,
					error: "Please enter a valid 6-digit code",
				}),
			);
		}

		const verified = authManager.verifyAndEnableTotp(admin.id, code);
		if (!verified) {
			const secret = admin.totp_secret ?? "";
			const otpauthUriStr = buildOtpauthUri(secret, "Paw", admin.username);
			return c.html(
				TotpSetupPage({
					secret,
					otpauthUri: otpauthUriStr,
					error:
						"Invalid code. Make sure your authenticator app time is synchronized.",
				}),
			);
		}

		return c.redirect("/");
	});

	// --- Pages ---

	// Resolve the active model id (latest turn → configured provider model).
	function currentModel(): string {
		const latest = kernel.database
			.query<{ model: string }, []>(
				"SELECT model FROM usage_log ORDER BY id DESC LIMIT 1",
			)
			.get();
		return (
			latest?.model ??
			(config.provider === "ollama"
				? config.ollama.model
				: config.provider === "openai"
					? config.openai.model
					: config.provider === "gemini"
						? config.gemini.model
						: config.ai.model)
		);
	}

	// Dashboard — the Agent Ops console (real operation stream rendered through
	// canvas lenses). The page shell is OpsPage; all visual logic lives in the
	// static modules under /ops/static/* reading /api/ops/feed.
	app.get("/", (c) => {
		const brand = getActiveBrand(kernel.database);
		const colors = brand?.data.colors ?? {};
		return c.html(
			OpsPage({
				accent: colors.accent || colors.primary || "",
				model: currentModel(),
				uptimeMs: process.uptime() * 1000,
				assetVersion: ASSET_VERSION,
			}),
		);
	});

	// Live feed for the Dashboard agent-ops scene. Returns tool calls newer than
	// ?since=<id> (enriched with a scene-node key), recent turns, and whether the
	// agent is actively working — polled by the canvas every ~2s.
	app.get("/api/agent-ops", (c) => {
		const since = Number.parseInt(c.req.query("since") ?? "0", 10) || 0;
		const rows = kernel.tools?.query({ limit: 40 }) ?? [];
		const fresh = rows.filter((r) => r.id > since);
		const tools = fresh
			.slice(0, 30)
			.reverse()
			.map((r) => ({
				id: r.id,
				tool: r.tool_name.replace(/^\[[^\]]+\]\s*/, ""),
				skill: skillKeyForToolRow(kernel, r),
				ok: r.is_error === 0,
				ts: r.created_at,
			}));
		let working = false;
		let model = "";
		const turns: Array<{ model: string; tokens: number; ts: string }> = [];
		try {
			const recent = kernel.database
				.query<{ model: string; tokens: number; created_at: string }, [number]>(
					"SELECT model, (input_tokens + output_tokens) AS tokens, created_at FROM usage_log ORDER BY id DESC LIMIT ?",
				)
				.all(5);
			for (const t of recent)
				turns.push({ model: t.model, tokens: t.tokens, ts: t.created_at });
			model = recent[0]?.model ?? "";
			const newest = [rows[0]?.created_at, recent[0]?.created_at]
				.filter(Boolean)
				.sort()
				.pop();
			if (newest) {
				const age = Date.now() - Date.parse(`${newest.replace(" ", "T")}Z`);
				working = Number.isFinite(age) && age < 12_000;
			}
		} catch {
			/* best-effort */
		}
		const newestId = rows.length ? rows[0].id : since;
		const agents = kernel.activeAgents;
		return c.json({
			now: Date.now(),
			cursor: newestId,
			working: working || agents.some((a) => !a.done),
			model,
			tools,
			turns,
			agents,
		});
	});

	// Agent Ops live feed — real operation stream behind the dashboard canvas
	// lenses (Swarm/Stream/…). Logic lives in routes/ops-feed.ts (unit-tested);
	// this only adapts the kernel into its deps. Polled ~2s → `live` rate class.
	app.get("/api/ops/feed", (c) => {
		const since = Number.parseInt(c.req.query("since") ?? "0", 10) || 0;
		// Actionable approvals only (stale rows are auto-expired here) so the
		// companion's "waiting" face is honest and self-clearing.
		const approvalRows = kernel.githubApprovals
			? kernel.githubApprovals.actionable(liveConfig().approvals.ttlHours)
			: [];
		// Real session cost + token totals from usage_log (since this process
		// booted, matching the dashboard's "session uptime"). Zeros when no usage.
		const bootSince = new Date(Date.now() - process.uptime() * 1000)
			.toISOString()
			.slice(0, 19)
			.replace("T", " ");
		const c2 = kernel.costs?.getTotalCost({ since: bootSince });
		const usage = {
			costUsd: c2?.estimatedCostUsd ?? 0,
			tokIn: c2?.totalInputTokens ?? 0,
			tokOut: c2?.totalOutputTokens ?? 0,
		};
		return c.json(
			buildOpsFeed(
				{
					toolLog: kernel.tools,
					inFlight: kernel.toolRegistryPublic?.getInFlight?.() ?? [],
					nodes: agentSceneNodes(kernel),
					rowKey: (row) => skillKeyForToolRow(kernel, row),
					agents: kernel.activeAgents,
					model: currentModel(),
					now: Date.now(),
					pendingApprovals: approvalRows.length,
					pendingApprovalsLabel: approvalLabel(approvalRows),
					toolMetrics: kernel.hooks.metrics(),
					usage,
				},
				since,
			),
		);
	});

	app.post("/api/credentials/:service", async (c) => {
		const service = c.req.param("service");
		const body = await c.req
			.json<{ value?: string }>()
			.catch(() => ({}) as { value?: string });
		const value = (body.value ?? "").trim();
		if (!value) return c.json({ error: "value is required" }, 400);
		if (value.length < 8)
			return c.json({ error: "value looks too short to be a secret" }, 400);

		const creds = loadStoredCredentials();
		const updated: StoredCredentials = { ...creds };

		switch (service) {
			case "anthropic":
				updated.anthropic = {
					...(updated.anthropic ?? { method: "api_key" }),
					method: "api_key",
					apiKey: value,
				};
				break;
			case "openai":
				updated.openai = { ...(updated.openai ?? {}), apiKey: value };
				break;
			case "gemini":
				updated.gemini = { ...(updated.gemini ?? {}), apiKey: value };
				break;
			case "ollama":
				updated.ollama = {
					baseUrl: updated.ollama?.baseUrl ?? "http://localhost:11434",
					model: updated.ollama?.model ?? "llama3.1",
					...updated.ollama,
					apiKey: value,
				};
				break;
			case "slack.bot":
				updated.slack = {
					botToken: value,
					appToken: updated.slack?.appToken ?? "",
					signingSecret: updated.slack?.signingSecret ?? "",
				};
				break;
			case "slack.app":
				updated.slack = {
					botToken: updated.slack?.botToken ?? "",
					appToken: value,
					signingSecret: updated.slack?.signingSecret ?? "",
				};
				break;
			case "slack.signing":
				updated.slack = {
					botToken: updated.slack?.botToken ?? "",
					appToken: updated.slack?.appToken ?? "",
					signingSecret: value,
				};
				break;
			default:
				return c.json({ error: "Unknown service" }, 400);
		}

		saveCredentials(updated);

		const session = c.get("session") as { user_id: number } | undefined;
		const ip = getClientIp(c);
		authManager.audit.log(
			"credentials.rotate",
			session?.user_id ?? null,
			{ service },
			ip,
		);

		return c.json({ rotated: true, service, restartRequired: true });
	});

	// ===== Credential vault (encrypted, web-managed secrets) =====
	// All routes are auth-guarded (registered after the auth middleware).
	// Secret VALUES are never returned by any of these — list is metadata only,
	// and there is no read endpoint (the model/canvas must never see secrets).
	function buildVaultSlots(): VaultSlotStatus[] {
		return KNOWN_SECRET_SLOTS.map((s) => ({
			name: s.name,
			scope: s.scope,
			label: s.label,
			inVault: kernel.vault.enabled && kernel.vault.has(s.name),
		}));
	}

	app.get("/vault", (c) => {
		return c.html(
			VaultPage({
				enabled: kernel.vault.enabled,
				secrets: kernel.vault.enabled ? kernel.vault.list() : [],
				slots: buildVaultSlots(),
			}),
		);
	});

	app.get("/api/vault", (c) => {
		return c.json({
			enabled: kernel.vault.enabled,
			secrets: kernel.vault.enabled ? kernel.vault.list() : [],
		});
	});

	app.post("/api/vault", async (c) => {
		if (!kernel.vault.enabled)
			return c.json({ error: "Vault is disabled (PAW_VAULT_KEY unset)" }, 400);
		const body = await c.req
			.json<{ name?: string; value?: string; scope?: string }>()
			.catch(() => ({}) as { name?: string; value?: string; scope?: string });
		const name = (body.name ?? "").trim();
		const value = body.value ?? "";
		const scope = (body.scope ?? "custom") as VaultScope;
		if (!name) return c.json({ error: "name is required" }, 400);
		if (!value) return c.json({ error: "value is required" }, 400);

		const session = c.get("session") as { user_id: number } | undefined;
		const ip = getClientIp(c);
		try {
			kernel.vault.set(name, value, scope, String(session?.user_id ?? "web"));
		} catch (e) {
			return c.json({ error: (e as Error).message }, 400);
		}
		authManager.audit.log(
			"vault.set",
			session?.user_id ?? null,
			{ name, scope },
			ip,
		);
		return c.json({ saved: true, name, restartRequired: true });
	});

	// --- Access control: pairing approvals + approved users ---
	app.get("/access", (c) => {
		const ac = kernel.access;
		return c.html(
			AccessPage({
				enabled: !!ac,
				pending: ac ? ac.listPendingPairings() : [],
				approved: ac ? ac.listApprovedUsers() : [],
				// recognizedIds is defensive: liveConfig().security can be a partial
				// object (shallow override merge), so allowedUsers/ownerUserIds may be
				// undefined — spreading them directly previously 500'd this page.
				persistedIds: ac ? recognizedIds(liveConfig().security) : [],
				// Owner ids render an "Owner" badge and drive the Make-owner toggle.
				ownerIds: ac ? (liveConfig().security?.ownerUserIds ?? []) : [],
				// OFF banner: access control isn't enforcing on external channels.
				open: liveConfig().security?.allowUnapprovedExternal === true,
			}),
		);
	});

	app.post("/api/access/approve", async (c) => {
		const ac = kernel.access;
		if (!ac) return c.json({ error: "Access control is not active" }, 400);
		const body = await c.req
			.json<{ userId?: string }>()
			.catch(() => ({}) as { userId?: string });
		const userId = (body.userId ?? "").trim();
		if (!userId) return c.json({ error: "userId is required" }, 400);
		const session = c.get("session") as { user_id: number } | undefined;
		ac.approveUser(userId, `web:${session?.user_id ?? "admin"}`, "all");
		authManager.audit.log(
			"access.approve",
			session?.user_id ?? null,
			{ userId },
			getClientIp(c),
		);
		// Let the user know in Slack (reuses the message:outbound → Slack DM path;
		// Slack accepts a user id as the channel). The code-verify path DMs on its
		// own, so this is the ONLY DM for page-driven approvals — no listener.
		kernel.eventBus.emit("security:user-approved", { userId });
		kernel.eventBus.emit("message:outbound", {
			sessionId: `slack-${userId}`,
			channel: "slack",
			content: "Access granted! You can now chat with me. ✅",
			metadata: { slackChannel: userId },
		} as never);
		return c.json({ ok: true });
	});

	// Persist an approved user to config (security.allowedUsers) so they're
	// recognized even if the DB is reset on a redeploy. Also writes the DB row
	// (live now); config is the durable layer. isUserApproved checks allowedUsers
	// before the DB, so this survives an ephemeral-DB deploy.
	app.post("/api/access/persist", async (c) => {
		const ac = kernel.access;
		if (!ac) return c.json({ error: "Access control is not active" }, 400);
		const body = await c.req
			.json<{ userId?: string }>()
			.catch(() => ({}) as { userId?: string });
		const userId = (body.userId ?? "").trim();
		if (!userId) return c.json({ error: "userId is required" }, 400);
		ac.approveUser(userId, "web:persist", "all");
		const current = liveConfig().security.allowedUsers ?? [];
		const next = current.includes(userId) ? current : [...current, userId];
		replaceConfigOverride("security.allowedUsers", next);
		// Apply to the running AccessController immediately — config alone only
		// took effect after a restart (lists are seeded once at boot).
		ac.setAccessLists({ allowedUsers: next });
		// Actor is null here (single-admin deployment) to avoid the file's known
		// c.get("session") TS2769 overload class; the action + userId are audited.
		authManager.audit.log("access.persist", null, { userId }, getClientIp(c));
		return c.json({ ok: true });
	});

	// Mark/unmark a Slack id as an OWNER (security.ownerUserIds). Owners are
	// recognized channel-agnostically with no approved_users row and no pairing
	// handshake — the durable, DB-independent "always me" path. Live + persisted.
	app.post("/api/access/owner", async (c) => {
		const ac = kernel.access;
		if (!ac) return c.json({ error: "Access control is not active" }, 400);
		const body = await c.req
			.json<{ userId?: string; owner?: boolean }>()
			.catch(() => ({}) as { userId?: string; owner?: boolean });
		const userId = (body.userId ?? "").trim();
		if (!userId) return c.json({ error: "userId is required" }, 400);
		const makeOwner = body.owner !== false; // default true
		const current = liveConfig().security.ownerUserIds ?? [];
		const next = makeOwner
			? current.includes(userId)
				? current
				: [...current, userId]
			: current.filter((id) => id !== userId);
		replaceConfigOverride("security.ownerUserIds", next);
		ac.setAccessLists({ ownerUserIds: next });
		// An owner is recognized without a pairing handshake — drop any stale code
		// so they stop showing as an "expired pending" row.
		if (makeOwner) ac.clearPairing(userId);
		authManager.audit.log(
			"access.owner",
			null,
			{ userId, owner: makeOwner },
			getClientIp(c),
		);
		return c.json({ ok: true });
	});

	app.post("/api/access/revoke", async (c) => {
		const ac = kernel.access;
		if (!ac) return c.json({ error: "Access control is not active" }, 400);
		const body = await c.req
			.json<{ userId?: string }>()
			.catch(() => ({}) as { userId?: string });
		const userId = (body.userId ?? "").trim();
		if (!userId) return c.json({ error: "userId is required" }, 400);
		const session = c.get("session") as { user_id: number } | undefined;
		ac.revokeUser(userId);
		authManager.audit.log(
			"access.revoke",
			session?.user_id ?? null,
			{ userId },
			getClientIp(c),
		);
		return c.json({ ok: true });
	});

	app.delete("/api/vault/:name", (c) => {
		if (!kernel.vault.enabled)
			return c.json({ error: "Vault is disabled (PAW_VAULT_KEY unset)" }, 400);
		const name = c.req.param("name");
		kernel.vault.delete(name);
		const session = c.get("session") as { user_id: number } | undefined;
		authManager.audit.log(
			"vault.delete",
			session?.user_id ?? null,
			{ name },
			getClientIp(c),
		);
		return c.json({ deleted: true, name });
	});

	// --- GitHub integration ---
	app.get("/github", async (c) => {
		const gh = liveConfig().github;
		const status = kernel.github ? await kernel.github.getStatus() : null;
		const approvals = kernel.githubApprovals;
		return c.html(
			GitHubPage({
				enabled: gh.enabled,
				appId: gh.appId,
				installationId: gh.installationId,
				baseUrl: gh.baseUrl,
				repoAllowlist: gh.repoAllowlist,
				privateKeyInVault: kernel.vault.enabled
					? kernel.vault.has("github.appPrivateKey")
					: false,
				webhookSecretInVault: kernel.vault.enabled
					? kernel.vault.has("github.webhookSecret")
					: false,
				vaultEnabled: kernel.vault.enabled,
				status,
				pending: approvals ? approvals.listPending() : [],
				recent: approvals ? approvals.listRecent(10) : [],
			}),
		);
	});

	app.get("/api/github/status", async (c) => {
		if (!kernel.github) return c.json({ configured: false, ok: false });
		return c.json(await kernel.github.getStatus());
	});

	app.post("/api/github/settings", async (c) => {
		type GitHubSettingsBody = {
			enabled?: boolean;
			appId?: string;
			installationId?: string;
			baseUrl?: string;
			repoAllowlist?: string[];
		};
		const body = await c.req
			.json<GitHubSettingsBody>()
			.catch(() => ({}) as GitHubSettingsBody);
		const overrides = readConfigOverrides();
		const gh = (overrides.github ?? {}) as Record<string, unknown>;
		if (body.enabled !== undefined) gh.enabled = Boolean(body.enabled);
		if (body.appId !== undefined) gh.appId = String(body.appId).trim();
		if (body.installationId !== undefined)
			gh.installationId = String(body.installationId).trim();
		if (body.baseUrl !== undefined)
			gh.baseUrl = String(body.baseUrl).trim() || "https://api.github.com";
		if (Array.isArray(body.repoAllowlist))
			gh.repoAllowlist = body.repoAllowlist
				.map((r) => String(r).trim())
				.filter(Boolean);
		overrides.github = gh;
		saveConfigOverrides(overrides);
		const session = c.get("session") as { user_id: number } | undefined;
		authManager.audit.log(
			"github.settings",
			session?.user_id ?? null,
			{
				enabled: gh.enabled,
				repoCount: (gh.repoAllowlist as string[])?.length,
			},
			getClientIp(c),
		);
		return c.json({ saved: true, restartRequired: true });
	});

	// --- Vercel deploy-target integration ---
	app.get("/vercel", async (c) => {
		const vc = liveConfig().vercel;
		const initialized = kernel.vercel !== null;
		const status = kernel.vercel ? await kernel.vercel.getStatus() : null;
		const projects =
			status?.ok && kernel.vercel
				? await kernel.vercel.listProjects().catch(() => [])
				: [];
		return c.html(
			VercelPage({
				enabled: vc.enabled,
				teamId: vc.teamId,
				tokenInVault: kernel.vault.enabled
					? kernel.vault.has("vercel.token")
					: false,
				vaultEnabled: kernel.vault.enabled,
				initialized,
				status,
				projects,
			}),
		);
	});

	app.get("/api/vercel/status", async (c) => {
		if (!kernel.vercel) return c.json({ configured: false, ok: false });
		return c.json(await kernel.vercel.getStatus());
	});

	app.get("/api/posthog/status", async (c) => {
		if (!kernel.posthog) return c.json({ configured: false, ok: false });
		return c.json(await kernel.posthog.getStatus());
	});

	app.post("/api/vercel/settings", async (c) => {
		type VercelSettingsBody = { enabled?: boolean; teamId?: string };
		const body = await c.req
			.json<VercelSettingsBody>()
			.catch(() => ({}) as VercelSettingsBody);
		const overrides = readConfigOverrides();
		const v = (overrides.vercel ?? {}) as Record<string, unknown>;
		// Only enabled + teamId are settable here; the token is vault-only.
		if (body.enabled !== undefined) v.enabled = Boolean(body.enabled);
		if (body.teamId !== undefined) v.teamId = String(body.teamId).trim();
		overrides.vercel = v;
		saveConfigOverrides(overrides);
		const session = c.get("session") as { user_id: number } | undefined;
		authManager.audit.log(
			"vercel.settings",
			session?.user_id ?? null,
			{ enabled: v.enabled, teamId: v.teamId },
			getClientIp(c),
		);
		return c.json({ saved: true, restartRequired: true });
	});

	// Save the GitHub App private key straight to the vault, normalized at save
	// time (repairs newline-stripped / PKCS#1 pastes → clean PKCS#8). A dedicated
	// multi-line field avoids the single-line vault input that flattens the PEM.
	app.post("/api/github/private-key", async (c) => {
		if (!kernel.vault.enabled)
			return c.json({ error: "Vault is disabled (PAW_VAULT_KEY unset)" }, 400);
		const body = await c.req
			.json<{ key?: string }>()
			.catch(() => ({}) as { key?: string });
		const raw = (body.key ?? "").trim();
		if (!raw) return c.json({ error: "key is required" }, 400);
		const { normalizePrivateKey, isValidPrivateKey } = await import(
			"../integrations/github/private-key.js"
		);
		if (!isValidPrivateKey(raw)) {
			return c.json(
				{
					error:
						"That doesn't parse as an RSA private key. Paste the full contents of the .pem file from GitHub, including the BEGIN/END lines.",
				},
				400,
			);
		}
		const session = c.get("session") as { user_id: number } | undefined;
		kernel.vault.set(
			"github.appPrivateKey",
			normalizePrivateKey(raw),
			"github",
			String(session?.user_id ?? "web"),
		);
		authManager.audit.log(
			"github.private_key.set",
			session?.user_id ?? null,
			{},
			getClientIp(c),
		);
		return c.json({ saved: true, restartRequired: true });
	});

	// --- GitHub control plane (Phase 3): approvals inbox + live event feed ---

	// In-memory event feed for the /github UI (admin-only single pane). Fed by
	// webhooks + approval decisions; the page polls /api/github/events.
	const githubEvents: Array<{
		id: number;
		event: string;
		data: unknown;
		ts: number;
	}> = [];
	let githubEventSeq = 0;
	const GITHUB_EVENT_TTL = 300_000; // 5 min
	const GITHUB_MAX_EVENTS = 200;
	function pushGithubEvent(event: string, data: unknown) {
		githubEvents.push({ id: ++githubEventSeq, event, data, ts: Date.now() });
		const cutoff = Date.now() - GITHUB_EVENT_TTL;
		while (
			githubEvents.length > 0 &&
			(githubEvents.length > GITHUB_MAX_EVENTS || githubEvents[0].ts < cutoff)
		) {
			githubEvents.shift();
		}
	}
	// Dedupe webhook deliveries by X-GitHub-Delivery (bounded set).
	const seenGithubDeliveries = new Set<string>();

	app.get("/api/github/pending", (c) => {
		const q = kernel.githubApprovals;
		if (!q) return c.json({ pending: [], recent: [] });
		return c.json({ pending: q.listPending(), recent: q.listRecent(20) });
	});

	app.post("/api/github/pending/:id/approve", async (c) => {
		const q = kernel.githubApprovals;
		if (!q) return c.json({ error: "GitHub approvals unavailable" }, 400);
		const id = c.req.param("id");
		const session = c.get("session") as { user_id: number } | undefined;
		try {
			const row = await q.approve(id, String(session?.user_id ?? "web"));
			pushGithubEvent("approval", {
				id,
				action: row.action,
				status: row.status,
			});
			authManager.audit.log(
				"github.approval.approve",
				session?.user_id ?? null,
				{ id, action: row.action, status: row.status },
				getClientIp(c),
			);
			return c.json(row);
		} catch (e) {
			return c.json({ error: (e as Error).message }, 400);
		}
	});

	app.post("/api/github/pending/:id/reject", (c) => {
		const q = kernel.githubApprovals;
		if (!q) return c.json({ error: "GitHub approvals unavailable" }, 400);
		const id = c.req.param("id");
		const session = c.get("session") as { user_id: number } | undefined;
		try {
			const row = q.reject(id, String(session?.user_id ?? "web"));
			pushGithubEvent("approval", {
				id,
				action: row.action,
				status: "rejected",
			});
			authManager.audit.log(
				"github.approval.reject",
				session?.user_id ?? null,
				{ id, action: row.action },
				getClientIp(c),
			);
			return c.json(row);
		} catch (e) {
			return c.json({ error: (e as Error).message }, 400);
		}
	});

	// General approval surface (channel-agnostic). Backed by the GitHub approvals
	// queue today; mirrors /api/github/pending but is the surface the web modal +
	// future channels use. Resolution flows through the same approve()/reject(),
	// so resolving here clears the companion + any other surface on next poll.
	app.get("/api/approvals/pending", (c) => {
		const q = kernel.githubApprovals;
		if (!q) return c.json({ pending: [] });
		return c.json({ pending: q.actionable(liveConfig().approvals.ttlHours) });
	});

	app.post("/api/approvals/:id/approve", async (c) => {
		const q = kernel.githubApprovals;
		if (!q) return c.json({ error: "Approvals unavailable" }, 400);
		const id = c.req.param("id");
		const session = c.get("session") as { user_id: number } | undefined;
		try {
			const row = await q.approve(id, `web:${session?.user_id ?? "?"}`);
			authManager.audit.log(
				"approval.approve",
				session?.user_id ?? null,
				{ id, action: row.action, status: row.status },
				getClientIp(c),
			);
			return c.json(row);
		} catch (e) {
			return c.json({ error: (e as Error).message }, 400);
		}
	});

	app.post("/api/approvals/:id/deny", (c) => {
		const q = kernel.githubApprovals;
		if (!q) return c.json({ error: "Approvals unavailable" }, 400);
		const id = c.req.param("id");
		const session = c.get("session") as { user_id: number } | undefined;
		try {
			const row = q.reject(id, `web:${session?.user_id ?? "?"}`);
			authManager.audit.log(
				"approval.deny",
				session?.user_id ?? null,
				{ id, action: row.action },
				getClientIp(c),
			);
			return c.json(row);
		} catch (e) {
			return c.json({ error: (e as Error).message }, 400);
		}
	});

	app.get("/api/github/events", (c) => {
		const since = Number.parseInt(c.req.query("since") || "0", 10);
		return c.json({ events: githubEvents.filter((e) => e.id > since) });
	});

	// Repos + open PRs for the /github page panels (live).
	app.get("/api/github/overview", async (c) => {
		if (!kernel.github) return c.json({ repos: [], prs: [] });
		try {
			const [repos, prs] = await Promise.all([
				kernel.github.listRepos(),
				kernel.github.getAllOpenPrs(),
			]);
			return c.json({ repos, prs });
		} catch (e) {
			return c.json({ repos: [], prs: [], error: (e as Error).message });
		}
	});

	// Unified diff for a PR (rendered in the page's diff viewer).
	app.get("/api/github/diff", async (c) => {
		if (!kernel.github) return c.json({ error: "GitHub not configured" }, 400);
		const repo = c.req.query("repo") || "";
		const number = Number.parseInt(c.req.query("number") || "0", 10);
		if (!repo || !number)
			return c.json({ error: "repo and number required" }, 400);
		try {
			const diff = await kernel.github.getPrDiff(repo, number);
			return c.json({ diff });
		} catch (e) {
			return c.json({ error: (e as Error).message }, 400);
		}
	});

	// Public, HMAC-verified GitHub App webhook. Reads the RAW body (GitHub signs
	// the exact bytes — re-serializing would never match). Dedupes by delivery id.
	app.post("/api/github/webhook", async (c) => {
		const secret = liveConfig().github.webhookSecret;
		const raw = await c.req.text();
		const eventType = c.req.header("x-github-event") || "";
		const delivery = c.req.header("x-github-delivery") || "";

		if (secret) {
			const sigHeader = c.req.header("x-hub-signature-256");
			if (!sigHeader) return c.json({ error: "Missing signature" }, 401);
			const key = await crypto.subtle.importKey(
				"raw",
				new TextEncoder().encode(secret),
				{ name: "HMAC", hash: "SHA-256" },
				false,
				["sign"],
			);
			const sig = await crypto.subtle.sign(
				"HMAC",
				key,
				new TextEncoder().encode(raw),
			);
			const expected = `sha256=${Array.from(new Uint8Array(sig))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("")}`;
			// Constant-time compare (equal length required).
			const a = new TextEncoder().encode(expected);
			const b = new TextEncoder().encode(sigHeader);
			let diff = a.length ^ b.length;
			for (let i = 0; i < a.length && i < b.length; i++) diff |= a[i] ^ b[i];
			if (diff !== 0) {
				return c.json({ error: "Invalid signature" }, 401);
			}
		}

		// Dedupe redeliveries.
		if (delivery) {
			if (seenGithubDeliveries.has(delivery)) {
				return c.json({ ok: true, dedup: true });
			}
			seenGithubDeliveries.add(delivery);
			if (seenGithubDeliveries.size > 1000) seenGithubDeliveries.clear();
		}

		let payload: Record<string, unknown> = {};
		try {
			payload = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			/* non-JSON ping */
		}
		const summary = summarizeGithubWebhook(eventType, payload);
		if (summary) pushGithubEvent("webhook", { type: eventType, ...summary });

		// Hand the event to the kernel so the agent can react (notify / portrait /
		// auto-investigate). Fire-and-forget — the webhook response shouldn't wait.
		const repository = payload.repository as { full_name?: string } | undefined;
		const sender = payload.sender as { login?: string } | undefined;
		void kernel.eventBus.emit("github:event", {
			eventType,
			action: typeof payload.action === "string" ? payload.action : undefined,
			repo: repository?.full_name,
			summary: (summary?.summary as string | undefined) ?? undefined,
			url: (summary?.url as string | undefined) ?? undefined,
			sender: sender?.login,
			payload,
			timestamp: new Date().toISOString(),
		});
		return c.json({ ok: true });
	});

	// --- Proactive notifications (durable inbox + nav badge + portrait) ---
	app.get("/notifications", (c) => {
		return c.html(
			NotificationsPage({
				notifications: kernel.notifications.listRecent(50),
				unread: kernel.notifications.unreadCount(),
			}),
		);
	});

	app.get("/api/notifications", (c) => {
		return c.json({
			notifications: kernel.notifications.listRecent(50),
			unread: kernel.notifications.unreadCount(),
			// Per-kind breakdown → the companion badges the matching skill pill.
			unreadByKind: kernel.notifications.unreadCountByKind(),
		});
	});

	app.post("/api/notifications/read", async (c) => {
		const body = await c.req
			.json<{ id?: string }>()
			.catch(() => ({}) as { id?: string });
		if (body.id) kernel.notifications.markRead(body.id);
		else kernel.notifications.markAllRead();
		return c.json({ ok: true, unread: kernel.notifications.unreadCount() });
	});

	// One-time migration: copy current effective secrets (env + credentials.json
	// + config tokens) into the encrypted vault so the operator can drop the
	// PAW_* env vars. Existing same-named entries are overwritten.
	app.post("/api/vault/import", (c) => {
		if (!kernel.vault.enabled)
			return c.json({ error: "Vault is disabled (PAW_VAULT_KEY unset)" }, 400);
		const cfg = liveConfig();
		const candidates: {
			name: string;
			value: string | undefined;
			scope: VaultScope;
		}[] = [
			{ name: "ai.apiKey", value: cfg.ai.apiKey, scope: "ai" },
			{ name: "openai.apiKey", value: cfg.openai.apiKey, scope: "ai" },
			{ name: "gemini.apiKey", value: cfg.gemini.apiKey, scope: "ai" },
			{ name: "ollama.apiKey", value: cfg.ollama.apiKey, scope: "ai" },
			{ name: "slack.botToken", value: cfg.slack.botToken, scope: "slack" },
			{ name: "slack.appToken", value: cfg.slack.appToken, scope: "slack" },
			{
				name: "slack.signingSecret",
				value: cfg.slack.signingSecret,
				scope: "slack",
			},
			{ name: "strapi.token", value: cfg.strapi.token, scope: "strapi" },
			{ name: "hubspot.token", value: cfg.hubspot?.token, scope: "hubspot" },
			{ name: "n8n.token", value: cfg.n8n?.token, scope: "n8n" },
		];
		for (const [serverName, sc] of Object.entries(cfg.mcpServers ?? {})) {
			if (sc?.authToken)
				candidates.push({
					name: `mcp.${serverName}.authToken`,
					value: sc.authToken,
					scope: "mcp",
				});
		}
		const session = c.get("session") as { user_id: number } | undefined;
		let imported = 0;
		for (const cand of candidates) {
			const v = (cand.value ?? "").trim();
			if (!v) continue;
			kernel.vault.set(
				cand.name,
				v,
				cand.scope,
				String(session?.user_id ?? "web"),
			);
			imported++;
		}
		authManager.audit.log(
			"vault.import",
			session?.user_id ?? null,
			{ imported },
			getClientIp(c),
		);
		return c.json({ imported, restartRequired: true });
	});

	app.get("/api/stats", (c) => {
		const sinceParam = c.req.query("since");
		const usage =
			kernel.costs?.getTotalCost({
				since: sinceParam || undefined,
			}) ?? null;
		const feedback = kernel.feedback?.getFeedbackStats() ?? null;
		const memoryStats = kernel.memory?.getStats() ?? null;
		const totals = readTotals(kernel.database);
		return c.json({
			provider: config.provider,
			uptimeMs: Math.floor(process.uptime() * 1000),
			memory: memoryStats,
			usage,
			feedback,
			totals,
		});
	});

	function liveConfig(): PawConfig {
		const overrides = readConfigOverrides();
		return {
			...config,
			...overrides,
			agent: {
				...config.agent,
				...((overrides.agent as Record<string, unknown>) ?? {}),
			},
		} as PawConfig;
	}

	function getIcpConfig(): {
		icpSampleCities?: string[];
		icpExcludeBrands?: string[];
	} {
		const overrides = readConfigOverrides();
		const icpConfig = overrides["icp-discovery"] as
			| Record<string, unknown>
			| undefined;
		return {
			icpSampleCities: Array.isArray(icpConfig?.sampleCities)
				? (icpConfig.sampleCities as string[])
				: undefined,
			icpExcludeBrands: Array.isArray(icpConfig?.excludeBrands)
				? (icpConfig.excludeBrands as string[])
				: undefined,
		};
	}

	function getAgentEntries(): Array<{
		name: string;
		description: string;
		systemPrompt: string;
		skills: string[];
		provider?: string;
		maxRoundtrips?: number;
	}> {
		const cfg = liveConfig();
		const agents = cfg.agents ?? {};
		return Object.entries(agents).map(([name, def]) => ({
			name,
			description:
				((def as Record<string, unknown>).description as string) || "",
			systemPrompt:
				((def as Record<string, unknown>).systemPrompt as string) || "",
			skills: Array.isArray((def as Record<string, unknown>).skills)
				? ((def as Record<string, unknown>).skills as string[])
				: [],
			provider: (def as Record<string, unknown>).provider as string | undefined,
			maxRoundtrips: (def as Record<string, unknown>).maxRoundtrips as
				| number
				| undefined,
		}));
	}

	// Common props for the consolidated Settings page (config + brand + avatar).
	function settingsBase() {
		return {
			config: liveConfig(),
			...getIcpConfig(),
			agents: getAgentEntries(),
			secrets: computeSecretStatuses(),
			brands: listBrands(kernel.database),
			defaultAvatar: liveConfig().companion?.avatar ?? "gel",
		};
	}

	app.get("/settings", (c) => {
		return c.html(SettingsPage(settingsBase()));
	});

	// The former /config, /brand and /preferences pages are consolidated into
	// /settings — redirect any bookmarks.
	app.get("/config", (c) => c.redirect("/settings"));
	app.get("/brand", (c) => c.redirect("/settings"));
	app.get("/preferences", (c) => c.redirect("/settings"));

	app.post("/settings", async (c) => {
		try {
			const body = await c.req.parseBody();
			const overrides: Record<string, unknown> = {};

			// Parse dotted form field names into nested objects
			const agentFields = new Map<string, Record<string, string>>();
			let n8nEndpointsRaw: string | null = null;
			for (const [key, value] of Object.entries(body)) {
				// Agent fields use agents[idx].field format — collect separately
				const agentMatch = key.match(/^agents\[(\d+)]\.(\w+)$/);
				if (agentMatch) {
					const idx = agentMatch[1];
					if (!agentFields.has(idx)) agentFields.set(idx, {});
					const fields = agentFields.get(idx);
					if (fields) fields[agentMatch[2]] = String(value);
					continue;
				}
				// n8n endpoints arrive as a JSON array in a hidden field.
				if (key === "n8nEndpoints") {
					n8nEndpointsRaw = String(value);
					continue;
				}

				// Block sensitive fields
				if (BLOCKED_CONFIG_FIELDS.has(key)) {
					return c.html(
						SettingsPage({
							...settingsBase(),
							error: `Field "${key}" cannot be modified through the web UI`,
						}),
					);
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
				else if (typeof value === "string" && /^\d+$/.test(value))
					target[lastKey] = Number.parseInt(value, 10);
				else if (typeof value === "string" && /^\d+\.\d+$/.test(value))
					target[lastKey] = Number.parseFloat(value);
				else target[lastKey] = value;
			}

			// Build agents config from collected form fields
			const agentsConfig: Record<string, Record<string, unknown>> = {};
			for (const [, fields] of agentFields) {
				const name = fields.name?.trim();
				if (!name) continue;
				agentsConfig[name] = {
					description: fields.description?.trim() || "",
					systemPrompt: fields.systemPrompt?.trim() || "",
					skills: (fields.skills || "")
						.split(",")
						.map((s: string) => s.trim())
						.filter(Boolean),
				};
				if (fields.provider) {
					agentsConfig[name].provider = fields.provider;
				}
				if (fields.maxRoundtrips && /^\d+$/.test(fields.maxRoundtrips)) {
					agentsConfig[name].maxRoundtrips = Number.parseInt(
						fields.maxRoundtrips,
						10,
					);
				}
			}
			// NOTE: agents are persisted via replaceConfigOverride at save time
			// (below), NOT merged into `overrides`. saveConfigOverrides deep-merges
			// nested objects and so can never delete a key — which made "clear all
			// agents" / removing one agent silently fail (the old agent re-merged
			// from disk). The agents subtree must be replaced wholesale.

			// n8n endpoints: replace the array from the hidden JSON field.
			if (n8nEndpointsRaw !== null) {
				let eps: Array<{ name: string; url: string }> = [];
				try {
					const parsed = JSON.parse(n8nEndpointsRaw);
					if (Array.isArray(parsed)) {
						eps = parsed
							.filter(
								(e) =>
									e && typeof e.name === "string" && typeof e.url === "string",
							)
							.map((e) => ({ name: e.name.trim(), url: e.url.trim() }))
							.filter((e) => e.name && e.url);
					}
				} catch {
					// ignore malformed
				}
				const n8n = (overrides.n8n ?? {}) as Record<string, unknown>;
				n8n.endpoints = eps;
				overrides.n8n = n8n;
			}

			// Convert comma-separated ICP discovery fields into string arrays
			const icpConfig = overrides["icp-discovery"] as
				| Record<string, unknown>
				| undefined;
			if (icpConfig) {
				for (const field of ["sampleCities", "excludeBrands"]) {
					if (typeof icpConfig[field] === "string") {
						icpConfig[field] = (icpConfig[field] as string)
							.split(",")
							.map((s: string) => s.trim())
							.filter(Boolean);
					}
				}
			}

			// Audit log config changes
			const session = c.get("session") as { user_id: number } | undefined;
			const ip = getClientIp(c);
			authManager.audit.log(
				"config.update",
				session?.user_id ?? null,
				{ fields: Object.keys(body) },
				ip,
			);

			// Wholesale-replace the agents subtree so a removed/cleared agent
			// actually disappears (deep-merge can't delete keys). The remaining
			// config fields are additive scalar/array updates, for which merge is
			// correct (arrays are replaced by the merge, so n8n.endpoints removals
			// already persist).
			replaceConfigOverride("agents", agentsConfig);
			saveConfigOverrides(overrides);
			return c.html(SettingsPage({ ...settingsBase(), saved: true }));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.html(SettingsPage({ ...settingsBase(), error: message }));
		}
	});

	app.get("/chat", (c) => {
		const sessionId = c.req.query("session") || crypto.randomUUID();
		const chatLabel =
			getActiveBrand(kernel.database)?.data.chatLabel?.trim() || "Chat";
		return c.html(ChatPage({ sessionId, chatLabel }));
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

	app.get("/favicon.png", async (c) => {
		const faviconPath = resolve(import.meta.dir, "public/favicon.png");
		if (!existsSync(faviconPath)) return c.text("Not found", 404);
		const file = Bun.file(faviconPath);
		c.header("Content-Type", "image/png");
		c.header("Cache-Control", "public, max-age=86400");
		return c.body(await file.arrayBuffer());
	});

	app.get("/favicon.ico", (c) => c.redirect("/favicon.png", 301));

	// llms.txt / llms-full.txt — a curated doc index + full concatenation for
	// coding agents. Generated from the live repo (never drifts), memoized per
	// boot. Public (see PUBLIC_ROUTES); served at the root and under /docs/.
	let llmsDocsCache: { index: string; full: string } | null = null;
	function llmsDocs(): { index: string; full: string } {
		if (!llmsDocsCache) llmsDocsCache = generateLlmsDocs();
		return llmsDocsCache;
	}
	function serveText(c: Context, body: string) {
		c.header("Content-Type", "text/plain; charset=utf-8");
		c.header("Cache-Control", "public, max-age=3600");
		return c.body(body);
	}
	app.get("/llms.txt", (c) => serveText(c, llmsDocs().index));
	app.get("/llms-full.txt", (c) => serveText(c, llmsDocs().full));
	app.get("/docs/llms.txt", (c) => serveText(c, llmsDocs().index));
	app.get("/docs/llms-full.txt", (c) => serveText(c, llmsDocs().full));

	// App design-system stylesheet (ds.css) served from 'self' as a REAL .css file
	// instead of an inline <style> built from a JS template literal — a stray
	// backtick in the CSS used to close the cssDesignSystem string and break Layout
	// for every page. Same whitelist/content-type pattern as /ops/static.
	app.get("/app/static/:file", async (c) => {
		const file = c.req.param("file");
		if (!/^[a-z0-9_-]+\.(js|css)$/.test(file)) return c.text("Not found", 404);
		const p = resolve(import.meta.dir, "public/app", file);
		if (!existsSync(p)) return c.text("Not found", 404);
		c.header(
			"Content-Type",
			file.endsWith(".css")
				? "text/css; charset=utf-8"
				: "application/javascript; charset=utf-8",
		);
		c.header("Cache-Control", "public, max-age=3600");
		return c.body(await Bun.file(p).arrayBuffer());
	});

	// Agent Ops static modules + vendored fonts (served from 'self', so they
	// satisfy the page CSP's script-src/font-src without a CDN). Strict filename
	// whitelist (no path traversal); real .js/.css/.woff2 files under public/.
	app.get("/ops/static/:file", async (c) => {
		const file = c.req.param("file");
		if (!/^[a-z0-9_-]+\.(js|css)$/.test(file)) return c.text("Not found", 404);
		const p = resolve(import.meta.dir, "public/ops", file);
		if (!existsSync(p)) return c.text("Not found", 404);
		c.header(
			"Content-Type",
			file.endsWith(".css")
				? "text/css; charset=utf-8"
				: "application/javascript; charset=utf-8",
		);
		c.header("Cache-Control", "public, max-age=3600");
		return c.body(await Bun.file(p).arrayBuffer());
	});

	// Skill Dock companion modules (served from 'self', not template-literal
	// strings) — the same-origin home for the live companion. See /companion.
	app.get("/companion/static/:file", async (c) => {
		const file = c.req.param("file");
		if (!/^[a-z0-9_-]+\.(js|css)$/.test(file)) return c.text("Not found", 404);
		const p = resolve(import.meta.dir, "public/companion", file);
		if (!existsSync(p)) return c.text("Not found", 404);
		c.header(
			"Content-Type",
			file.endsWith(".css")
				? "text/css; charset=utf-8"
				: "application/javascript; charset=utf-8",
		);
		c.header("Cache-Control", "public, max-age=3600");
		return c.body(await Bun.file(p).arrayBuffer());
	});

	// The live companion (Skill Dock v2). Served same-origin (NOT the null-origin
	// canvas-preview sandbox) so it can fetch /api/ops/feed AND receive the
	// chat page's postMessage relay. Mounted as the pinned Home tab in chat.tsx.
	app.get("/companion", (c) => {
		const brand = getActiveBrand(kernel.database);
		const pal = getBrandPalette(brand);
		const accent = pal?.accent ?? pal?.primary ?? "#7458f5";
		const brandName = brand?.name ?? "Paw";
		// Ordered, humanized skill list for the column (excluding the synthetic
		// orchestrator "core" lane) — so the capped column + overflow are correct
		// before the feed loads. Pills key off the same skillKey the relay sends.
		const humanize = (k: string): string =>
			(k.startsWith("mcp:") ? k.slice(4) : k)
				.split(/[-_:]+/)
				.filter(Boolean)
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(" ");
		const skills = (kernel.skills?.skillNames ?? [])
			.filter((k) => k !== "core")
			.map((k) => ({ key: k, label: humanize(k) }));
		// Mood scalar: a slow health signal (1 − the last hour's tool failure rate)
		// the companion maps to avatar saturation/brightness/posture (hue unchanged).
		let moodScalar = 1;
		try {
			const row = kernel.database
				.query<{ total: number; fails: number }, []>(
					`SELECT COUNT(*) AS total, COALESCE(SUM(is_error), 0) AS fails
					 FROM tool_log WHERE created_at >= datetime('now', '-1 hour')`,
				)
				.get();
			if (row && row.total > 0) {
				moodScalar = Math.max(0, Math.min(1, 1 - row.fails / row.total));
			}
		} catch {
			/* default to healthy */
		}
		const cfg = JSON.stringify({
			accent,
			// NB: do NOT pass the brand `bg` here. The design system owns the
			// light/dark neutrals (companion styles.css: light `:root`, dark
			// `html.dark`); injecting the brand bg as an inline `--bg` froze the
			// theme to the brand's black ground and made light mode unreadable.
			// Brand contributes accent + fonts only — same rule as brands.ts.
			model: currentModel(),
			brandName,
			moodScalar,
			skills,
			// Deployment/brand default avatar; per-user localStorage wins (shell.js).
			avatar: config.companion?.avatar,
		}).replace(/</g, "\\u003c");
		const v = `?v=${ASSET_VERSION}`;
		// Theme bootstrap: the companion is a standalone same-origin iframe doc, so it
		// never runs the layout.tsx bootstrap and would otherwise be stuck on the
		// dark :root palette. Apply the EXISTING `.dark` toggle here from the shared
		// localStorage("paw-theme") BEFORE the stylesheet paints (no flash), and keep
		// it live: __pawSetTheme writes paw-theme → the `storage` event fires in this
		// (other) same-origin doc; system-pref changes update when theme === "system".
		// Regex/backslash-free — this is browser JS cooked from a template literal
		// (the inline-script-template-trap).
		return c.html(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>(function(){function apply(){var t=localStorage.getItem("paw-theme")||"system";var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);}apply();window.addEventListener("storage",function(e){if(e.key==="paw-theme")apply();});window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",apply);})()</script>
<link rel="stylesheet" href="/companion/static/styles.css${v}"></head>
<body><div id="companion-root"></div>
<script src="/companion/static/router.js${v}"></script>
<script src="/companion/static/topology.js${v}"></script>
<script src="/companion/static/expression.js${v}"></script>
<script src="/companion/static/spring.js${v}"></script>
<script src="/companion/static/engine.js${v}"></script>
<script src="/companion/static/inbox.js${v}"></script>
<script src="/companion/static/fit.js${v}"></script>
<script src="/companion/static/shell.js${v}"></script>
<script>window.__COMPANION_CONFIG=${cfg};
window.Companion.mount(document.getElementById("companion-root"),window.__COMPANION_CONFIG);</script>
</body></html>`);
	});

	// Page-scoped Assistant console — a REAL promptable chat surface loaded into
	// the canvas admin toolbar's panel iframe (same-origin). Owner-only: NOT in
	// PUBLIC_PREFIXES, so the auth middleware requires a session. Unlike /companion
	// (the display-only face), this has a composer that drives a real agent turn
	// via POST /api/canvas/stream, passing the host page path (?path=) as context.
	app.get("/canvas/assistant", (c) => {
		const brand = getActiveBrand(kernel.database);
		const pal = getBrandPalette(brand);
		const accent = pal?.accent ?? pal?.primary ?? "#7458f5";
		const cfg = JSON.stringify({ accent }).replace(/</g, "\\u003c");
		const v = `?v=${ASSET_VERSION}`;
		return c.html(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Assistant</title>
<script>(function(){function apply(){var t=localStorage.getItem("paw-theme")||"system";var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);}apply();window.addEventListener("storage",function(e){if(e.key==="paw-theme")apply();});window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",apply);})()</script>
<link rel="stylesheet" href="/companion/static/assistant.css${v}"></head>
<body><div id="assistant-root"></div>
<script>window.__ASSISTANT_CONFIG=${cfg};</script>
<script src="/companion/static/assistant.js${v}"></script>
</body></html>`);
	});

	app.get("/fonts/:file", async (c) => {
		const file = c.req.param("file");
		if (!/^[a-z0-9_-]+\.woff2$/.test(file)) return c.text("Not found", 404);
		const p = resolve(import.meta.dir, "public/fonts", file);
		if (!existsSync(p)) return c.text("Not found", 404);
		c.header("Content-Type", "font/woff2");
		c.header("Cache-Control", "public, max-age=604800");
		return c.body(await Bun.file(p).arrayBuffer());
	});

	// --- Canvas ---

	// Brand assets live next to the canvas workspace (same volume → persists).
	const brandRoot = resolve(dirname(canvasRoot), "brand");

	// In-memory event buffer for canvas polling (replaces SSE which Bun can't sustain)
	const canvasEvents = new Map<
		string,
		Array<{ id: number; event: string; data: unknown; ts: number }>
	>();
	const canvasSessionLastAccess = new Map<string, number>(); // tracks last poll time per session
	let canvasEventSeq = 0;
	const canvasStreamingSessions = new Set<string>(); // tracks sessions using handleInboundStream (to skip duplicate message:outbound)
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
		while (
			pruneCount < buf.length &&
			(buf.length - pruneCount > CANVAS_MAX_EVENTS ||
				buf[pruneCount].ts < cutoff)
		) {
			pruneCount++;
		}
		if (pruneCount > 0) buf.splice(0, pruneCount);
	}

	// Tag tool chunks with the skill/group they belong to, so the canvas
	// portrait can light up the matching pill as the agent works. Mutates +
	// returns the chunk (no-op for non-tool chunks).
	function enrichChunk(chunk: StreamChunk): StreamChunk {
		if (
			(chunk.type === "tool_start" || chunk.type === "tool_end") &&
			chunk.toolName &&
			!chunk.skillKey
		) {
			// Sub-agent chunks carry a "[agentName] " display prefix on toolName
			// (added in kernel.runAgentTurnStream); capture the agent so the
			// companion can route the beam to the acting sub-agent, then strip it
			// so the skill lookup resolves (e.g. "[copy-writer-mate]
			// browser_navigate" → "web-pilot").
			const agentMatch = chunk.toolName.match(/^\[([^\]]+)\]\s*/);
			if (agentMatch) chunk.agentName = agentMatch[1];
			const cleanName = chunk.toolName.replace(/^\[[^\]]+\]\s*/, "");
			// activate_skill itself belongs to the "core" skill, but it's more
			// intuitive to light the *target* skill's pill (activating "strapi"
			// → the strapi pill). Parse it from the summary ("Activating skill: X").
			if (cleanName === "activate_skill" && chunk.toolSummary) {
				const target = chunk.toolSummary
					.match(/Activating skill:\s*(.+)$/)?.[1]
					?.trim();
				if (target && kernel.skills.getSkill(target)) {
					chunk.skillKey = target;
				}
			}
			if (!chunk.skillKey) {
				chunk.skillKey = kernel.skills.skillNameForTool(cleanName);
			}
		}
		return chunk;
	}

	// Share tokens (in-memory, expire after 24 hours)
	const canvasShareTokens = new Map<
		string,
		{ createdAt: number; path: string }
	>();
	const CANVAS_SHARE_TTL = 24 * 60 * 60_000; // 24 hours

	// Periodic cleanup of abandoned canvas sessions and expired share tokens (every 5 minutes)
	const canvasCleanupInterval = setInterval(() => {
		const cutoff = Date.now() - CANVAS_SESSION_TTL;
		for (const [sid, lastAccess] of canvasSessionLastAccess) {
			if (lastAccess < cutoff) {
				canvasEvents.delete(sid);
				canvasSessionLastAccess.delete(sid);
			}
		}
		// Clean up expired share tokens
		const shareCutoff = Date.now() - CANVAS_SHARE_TTL;
		for (const [token, meta] of canvasShareTokens) {
			if (meta.createdAt < shareCutoff) {
				canvasShareTokens.delete(token);
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
	} catch {
		/* fs.watch may not be available */
	}

	// Listen for AI outbound messages bound for canvas sessions
	// Skip sessions that are already streaming via handleInboundStream (they push chunks directly)
	kernel.eventBus.on(
		"message:outbound",
		(outbound: { sessionId: string; content: string; channel?: string }) => {
			if (
				outbound.sessionId?.startsWith("canvas-") &&
				!canvasStreamingSessions.has(outbound.sessionId)
			) {
				pushCanvasEvent(outbound.sessionId, "message", {
					content: outbound.content,
				});
			}
		},
	);

	// Canvas page routes removed — canvas is now integrated into the chat page

	/** Build the canvas instruction content and attachments from a request body */
	async function buildCanvasMessage(body: {
		sessionId?: string;
		message?: string;
		images?: Array<{ data: string; mimeType: string }>;
		files?: Array<{ data: string; mimeType: string; name: string }>;
		/** URL pathname of the served page the admin is viewing (from the toolbar
		 *  Assistant), mapped to a canvas file so the agent knows which page to edit. */
		pagePath?: string;
	}): Promise<{
		content: string;
		attachments: Array<{
			type: "image" | "text";
			data: Buffer;
			mimeType: string;
			name?: string;
		}>;
	}> {
		const attachments: Array<{
			type: "image" | "text";
			data: Buffer;
			mimeType: string;
			name?: string;
		}> = [];
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

		const fileContentSections: string[] = [];
		for (const att of attachments) {
			if (att.type === "text" && att.data) {
				const header = att.name ? `[File: ${att.name}]` : "[Attached file]";
				fileContentSections.push(header + "\n" + att.data.toString("utf-8"));
			}
		}

		const BINARY_EXTS = new Set([
			".png",
			".jpg",
			".jpeg",
			".gif",
			".ico",
			".webp",
			".svg",
			".woff",
			".woff2",
			".ttf",
			".eot",
			".mp3",
			".mp4",
			".webm",
			".ogg",
			".wav",
			".pdf",
			".zip",
			".tar",
			".gz",
		]);
		const MAX_INJECT_BYTES = 50 * 1024;
		let canvasFilesSummary = "";

		if (existsSync(canvasRoot)) {
			const canvasFiles: Array<{
				path: string;
				size: number;
				fullPath: string;
			}> = [];
			function walkCanvas(dir: string): void {
				if (canvasFiles.length >= 50) return;
				try {
					const items = readdirSync(dir, { withFileTypes: true });
					for (const item of items) {
						if (item.name.startsWith(".")) continue;
						const full = resolve(dir, item.name);
						if (item.isDirectory()) {
							walkCanvas(full);
						} else {
							canvasFiles.push({
								path: relative(canvasRoot, full),
								size: statSync(full).size,
								fullPath: full,
							});
						}
					}
				} catch {
					/* ignore */
				}
			}
			walkCanvas(canvasRoot);

			if (canvasFiles.length > 0) {
				const sections: string[] = [];
				let injectedBytes = 0;
				for (const f of canvasFiles) {
					const ext = extname(f.path).toLowerCase();
					const isBinary = BINARY_EXTS.has(ext);
					if (
						isBinary ||
						f.size > MAX_INJECT_BYTES ||
						injectedBytes + f.size > MAX_INJECT_BYTES
					) {
						sections.push(
							`[${f.path}] (${isBinary ? "binary" : `${f.size} bytes`} — use canvas_read if needed)`,
						);
					} else {
						try {
							const content = readFileSync(f.fullPath, "utf-8");
							sections.push(`[${f.path}]\n${content}`);
							injectedBytes += f.size;
						} catch {
							sections.push(
								`[${f.path}] (unreadable — use canvas_read if needed)`,
							);
						}
					}
				}
				canvasFilesSummary =
					"\n\n--- Current Canvas Files ---\n" + sections.join("\n\n");
			}
		}

		const hasExistingFiles = canvasFilesSummary.length > 0;
		// If the request came from the in-page Assistant toolbar, it carries the URL
		// of the page the admin is viewing → map it to its canvas file so the agent
		// edits the right page by default.
		const currentPageFile = body.pagePath
			? canvasFileFromUrlPath(body.pagePath, APP_NAMESPACE)
			: null;
		// Brand compliance for generated canvases: link the shared brand
		// stylesheet (centrally restyleable) and use its CSS variables + logo.
		const activeBrand = getActiveBrand(kernel.database);
		const brandLogo = activeBrand?.data.logos?.light
			? `/api/brand/asset/${activeBrand.id}/${activeBrand.data.logos.light}`
			: null;
		const brandDirective = activeBrand
			? [
					`BRAND COMPLIANCE: An active brand ("${activeBrand.name}") is set. Keep this canvas on-brand by default.`,
					'A brand stylesheet is served at /api/brand/tokens.css exposing CSS variables: <link rel="stylesheet" href="/api/brand/tokens.css"> in <head>, then use var(--brand-primary), var(--brand-accent), var(--brand-bg), var(--brand-surface), var(--brand-text), var(--brand-muted), var(--brand-font-display) and var(--brand-font-body) for colors and typography.',
					brandLogo
						? `Embed the brand logo where appropriate using <img src="${brandLogo}" alt="${activeBrand.name}">.`
						: "",
					"Match the brand's voice, tone and guidelines (provided in your brand_guidelines). Stay on-brand unless the user explicitly asks you to ignore or change the brand for this canvas.",
				].filter(Boolean)
			: [];
		const canvasInstruction = [
			"[CANVAS MODE] You are working in a live canvas environment.",
			"You MUST use the canvas_write tool to create/update files (HTML, CSS, JS).",
			"Files written with canvas_write appear in a live preview iframe immediately.",
			hasExistingFiles
				? "The current canvas file contents are provided below. Write directly using canvas_write — do NOT call canvas_read unless you need a file not listed below."
				: "The canvas is currently empty. Start by writing an index.html file.",
			...(currentPageFile
				? [
						`CURRENT PAGE: The user is viewing "${currentPageFile}". Default any edits to that file (canvas_write to that exact path) unless they ask otherwise.`,
					]
				: []),
			"Do NOT use file_write — only canvas_write works for the live preview.",
			"Write complete, self-contained HTML files with inline CSS and JS when possible.",
			"Organize related pages into folders with canvas_mkdir / canvas_move (e.g. 'sales-campaign/', 'blog/', 'cms/') so the workspace stays a tidy operations hub.",
			"REAL BACKEND WIRING: to make a page's form/button actually capture data (leads, signups, contacts), FIRST call canvas_action_create (type 'strapi' for a CMS content-type, 'hubspot' for a CRM contact, or 'supabase' to insert a row into one of YOUR canvas-yard tables — create it with supabase_create_table first, then map fields to its columns) with a fieldMap, then build the page's <form action> to POST to the returned submitUrl with <input name> matching the fieldMap keys. Never fake a form that goes nowhere — wire it to a real action so submissions route to the backend and appear in Submissions.",
			...brandDirective,
			// Reliability for weaker tool-callers: always emit the full
			// document inline too. If the model forgets to call canvas_write,
			// the server extracts this fenced block and writes it (see
			// extractCanvasHtml in the /api/canvas/* handlers).
			"REQUIRED OUTPUT FORMAT:",
			"1. Call the canvas_write tool with the complete file content.",
			"2. In your reply, ALSO include the complete, final HTML document inside a single ```html fenced code block (full <!DOCTYPE html> … </html>).",
			"NEVER say a file was created or updated unless you actually called canvas_write or included the full ```html document. Do not describe a file you did not produce.",
			"",
			"User request: " + (body.message?.trim() || "(see attached files)"),
			...(fileContentSections.length > 0
				? ["", "--- Attached Data ---", ...fileContentSections]
				: []),
			...(canvasFilesSummary ? [canvasFilesSummary] : []),
		].join("\n");

		return { content: canvasInstruction, attachments };
	}

	// --- Canvas write reliability (B6) ---------------------------------------
	// Weaker tool-callers (e.g. Ollama models) sometimes describe a canvas file
	// without ever calling canvas_write. The canvas-mode prompt asks the model
	// to ALSO emit the full document inline; if no canvas_write ran during the
	// turn, we extract that HTML and write it ourselves so the preview updates.

	/** Pull a complete HTML document from an assistant reply. */
	function extractCanvasHtml(text: string): string | null {
		if (!text) return null;
		const fenced = text.match(/```(?:html)?\s*\n?([\s\S]*?)```/i);
		if (fenced?.[1]) {
			const inner = fenced[1].trim();
			if (/<html[\s>]|<!doctype html/i.test(inner)) return inner;
		}
		const doc =
			text.match(/<!doctype html[\s\S]*?<\/html>/i) ??
			text.match(/<html[\s\S]*?<\/html>/i);
		return doc ? doc[0].trim() : null;
	}

	/**
	 * Decide the target filename for a canvas write from the user's request.
	 * An explicit `*.html|css|js` wins; otherwise "call/name it X" → `X.html`;
	 * default `index.html`.
	 */
	function parseCanvasFilename(message: string): string {
		const m = message ?? "";
		const explicit = m.match(/([\w.\-/]+\.(?:html|css|js))\b/i);
		if (explicit) return explicit[1].replace(/^\/+/, "");
		const named = m.match(
			/\b(?:call(?:ed)?|name[d]?)\s+it\s+["']?([\w-]+)["']?/i,
		);
		if (named) return `${named[1].toLowerCase()}.html`;
		return "index.html";
	}

	/**
	 * Wrap kernel.handleInboundStream for canvas turns: pass chunks through
	 * unchanged, but if the model produced HTML without calling canvas_write,
	 * write the extracted document ourselves (the canvas fs.watch then emits a
	 * file-changed event and the preview refreshes). The terminal `done` chunk
	 * is held back so the fallback's tool step is emitted before it.
	 */
	async function* streamCanvasWithFallback(
		msg: Parameters<typeof kernel.handleInboundStream>[0],
		targetFile: string,
	): AsyncGenerator<StreamChunk> {
		let fullText = "";
		let canvasWriteRan = false;
		let pendingDone: StreamChunk | null = null;

		for await (const chunk of kernel.handleInboundStream(msg)) {
			if (chunk.type === "done") {
				pendingDone = chunk;
				continue;
			}
			if (chunk.type === "text_delta" && chunk.text) fullText += chunk.text;
			if (
				(chunk.type === "tool_start" || chunk.type === "tool_end") &&
				chunk.toolName === "canvas_write"
			) {
				canvasWriteRan = true;
			}
			yield chunk;
		}

		if (!canvasWriteRan) {
			const html = extractCanvasHtml(fullText);
			if (html) {
				try {
					await kernel.toolRegistryPublic.execute("canvas_write", {
						path: targetFile,
						content: html,
					});
					yield {
						type: "tool_end",
						toolName: "canvas_write",
						toolId: "canvas-fallback",
						toolInput: { path: targetFile },
						toolSummary: `Writing canvas (auto): ${targetFile}`,
						toolResult: JSON.stringify({
							written: true,
							path: targetFile,
							fallback: true,
						}),
						roundtrip: 0,
					};
				} catch {
					// Best-effort: if the write fails the preview just won't
					// update — no worse than before the fallback existed.
				}
			}
		}

		yield pendingDone ?? { type: "done" };
	}

	app.post("/api/canvas/chat", async (c) => {
		if (!config.web.canvas?.enabled) {
			return c.json({ error: "Canvas is disabled" }, 400);
		}

		const body = await c.req.json<{
			sessionId: string;
			message: string;
			images?: Array<{ data: string; mimeType: string }>;
			files?: Array<{ data: string; mimeType: string; name: string }>;
			pagePath?: string;
		}>();
		if (!body.message?.trim() && !body.images?.length && !body.files?.length) {
			return c.json({ error: "Message is required" }, 400);
		}

		const sessionId = body.sessionId || "canvas-" + crypto.randomUUID();
		if (!canvasEvents.has(sessionId)) canvasEvents.set(sessionId, []);

		const { content, attachments } = await buildCanvasMessage(body);

		const admin = c.get("admin") as
			| { id: number; username: string }
			| undefined;
		const userId = admin ? `web-${admin.id}` : "web-anonymous";
		const userName = admin?.username ?? "Web User";

		const msg = {
			id: crypto.randomUUID(),
			sessionId,
			channel: "canvas" as const,
			content,
			attachments: attachments.length > 0 ? attachments : undefined,
			user: { id: userId, name: userName },
			timestamp: new Date().toISOString(),
			metadata: { canvas: true },
			// Authenticated admin session — exempt from the pairing-code access
			// controller (still rate-limited).
			authenticated: !!admin,
		};

		// Consume stream in background, push each chunk as a canvas event
		const targetFile = parseCanvasFilename(body.message ?? "");
		canvasStreamingSessions.add(sessionId);
		(async () => {
			try {
				for await (const chunk of streamCanvasWithFallback(msg, targetFile)) {
					pushCanvasEvent(sessionId, "chunk", enrichChunk(chunk));
				}
			} catch (err) {
				pushCanvasEvent(sessionId, "error", {
					message: err instanceof Error ? err.message : String(err),
				});
			} finally {
				canvasStreamingSessions.delete(sessionId);
			}
		})();

		return c.json({ sessionId }, 202);
	});

	app.post("/api/canvas/stream", async (c) => {
		if (!config.web.canvas?.enabled) {
			return c.json({ error: "Canvas is disabled" }, 400);
		}

		try {
			const body = await c.req.json<{
				sessionId: string;
				message: string;
				images?: Array<{ data: string; mimeType: string }>;
				files?: Array<{ data: string; mimeType: string; name: string }>;
				pagePath?: string;
			}>();
			if (
				!body.message?.trim() &&
				!body.images?.length &&
				!body.files?.length
			) {
				return c.json({ error: "Message is required" }, 400);
			}

			const sessionId = body.sessionId || "canvas-" + crypto.randomUUID();
			if (!canvasEvents.has(sessionId)) canvasEvents.set(sessionId, []);

			const { content, attachments } = await buildCanvasMessage(body);

			const admin = c.get("admin") as
				| { id: number; username: string }
				| undefined;
			const userId = admin ? `web-${admin.id}` : "web-anonymous";
			const userName = admin?.username ?? "Web User";

			const msg = {
				id: crypto.randomUUID(),
				sessionId,
				channel: "canvas" as const,
				content,
				attachments: attachments.length > 0 ? attachments : undefined,
				user: { id: userId, name: userName },
				timestamp: new Date().toISOString(),
				metadata: { canvas: true },
				// Authenticated admin session — exempt from the pairing-code access
				// controller (still rate-limited).
				authenticated: !!admin,
			};

			const targetFile = parseCanvasFilename(body.message ?? "");
			return streamSSE(c, async (stream) => {
				try {
					for await (const chunk of streamCanvasWithFallback(msg, targetFile)) {
						await stream.writeSSE({
							data: JSON.stringify(enrichChunk(chunk)),
						});
					}
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					await stream.writeSSE({
						data: JSON.stringify({ type: "error", error: errMsg }),
					});
					await stream.writeSSE({
						data: JSON.stringify({ type: "done" }),
					});
				}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: message }, 500);
		}
	});

	// Polling endpoint — replaces SSE which Bun cannot sustain
	app.get("/api/canvas/events", (c) => {
		const sessionId = c.req.query("sessionId") || "__files__";
		const since = Number.parseInt(c.req.query("since") || "0", 10);

		// Track last access for session cleanup
		canvasSessionLastAccess.set(sessionId, Date.now());

		const buf = canvasEvents.get(sessionId) || [];
		const events = buf.filter((e) => e.id > since);

		return c.json({ events });
	});

	// Canvas share — generate a shareable read-only link
	app.post("/api/canvas/share", async (c) => {
		const token = crypto.randomUUID();
		let path = "index.html";
		try {
			const body = await c.req.json<{ path?: string }>();
			if (body.path && typeof body.path === "string") {
				// Validate path is within canvas root
				const full = resolve(canvasRoot, body.path);
				const rel = relative(canvasRoot, full);
				if (!rel.startsWith("..") && !full.includes("\0")) {
					path = body.path;
				}
			}
		} catch {
			// No body or invalid JSON — use default
		}
		canvasShareTokens.set(token, { createdAt: Date.now(), path });
		return c.json({ token, url: `/canvas/share/${token}` });
	});

	// Canvas share — render a read-only preview page (no auth required)
	app.get("/canvas/share/:token", (c) => {
		const token = c.req.param("token");
		const meta = canvasShareTokens.get(token);
		if (!meta || Date.now() - meta.createdAt > CANVAS_SHARE_TTL) {
			canvasShareTokens.delete(token);
			return c.text("Share link expired or invalid", 404);
		}
		const page = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Shared Canvas - Paw</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { height: 100%; background: #09090b; }
        iframe { width: 100%; height: 100vh; border: none; display: block; }
      </style></head><body>
      <iframe src="/api/canvas/preview/${encodeURIComponent(meta.path)}"></iframe>
    </body></html>`;
		// Deliberately NO toolbar on the share WRAPPER: its URL is /canvas/share/<token>
		// (not a canvas file, so edit-prep can't map it) and the editable content lives
		// in the inner preview iframe. The inner /api/canvas/preview/* page injects the
		// toolbar itself and reveals it when framed inside a same-origin share wrapper
		// (see COMPANION_LAUNCHER) — so editing targets the real page + a mappable URL,
		// and there's still exactly one toolbar.
		return c.html(page);
	});

	// CRC32 for ZIP file construction
	function crc32(data: Uint8Array): number {
		let crc = 0xffffffff;
		for (let i = 0; i < data.length; i++) {
			crc ^= data[i];
			for (let j = 0; j < 8; j++) {
				crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
			}
		}
		return (crc ^ 0xffffffff) >>> 0;
	}

	// Download all canvas files as a ZIP
	app.get("/api/canvas/download", async (c) => {
		if (!existsSync(canvasRoot)) {
			return c.text("No canvas files", 404);
		}

		const files: Array<{ path: string; fullPath: string }> = [];
		function walk(dir: string): void {
			if (files.length >= 200) return;
			const items = readdirSync(dir, { withFileTypes: true });
			for (const item of items) {
				if (item.name.startsWith(".")) continue;
				const full = resolve(dir, item.name);
				if (item.isDirectory()) {
					walk(full);
				} else {
					files.push({ path: relative(canvasRoot, full), fullPath: full });
				}
			}
		}
		walk(canvasRoot);

		if (files.length === 0) {
			return c.text("No canvas files", 404);
		}

		// Build ZIP using Bun's built-in JSZip-compatible approach
		// Manual ZIP construction (minimal spec-compliant)
		const entries: Array<{ path: string; data: Uint8Array }> = [];
		for (const f of files) {
			entries.push({
				path: f.path,
				data: new Uint8Array(readFileSync(f.fullPath)),
			});
		}

		const zipParts: Uint8Array[] = [];
		const centralDir: Uint8Array[] = [];
		let offset = 0;

		for (const entry of entries) {
			const nameBytes = new TextEncoder().encode(entry.path);
			// Local file header
			const header = new Uint8Array(30 + nameBytes.length);
			const hv = new DataView(header.buffer);
			hv.setUint32(0, 0x04034b50, true); // signature
			hv.setUint16(4, 20, true); // version needed
			hv.setUint16(6, 0, true); // flags
			hv.setUint16(8, 0, true); // compression (store)
			hv.setUint16(10, 0, true); // mod time
			hv.setUint16(12, 0, true); // mod date
			// CRC32
			const crc = crc32(entry.data);
			hv.setUint32(14, crc, true);
			hv.setUint32(18, entry.data.length, true); // compressed size
			hv.setUint32(22, entry.data.length, true); // uncompressed size
			hv.setUint16(26, nameBytes.length, true); // filename length
			hv.setUint16(28, 0, true); // extra field length
			header.set(nameBytes, 30);

			zipParts.push(header);
			zipParts.push(entry.data);

			// Central directory entry
			const cdEntry = new Uint8Array(46 + nameBytes.length);
			const cv = new DataView(cdEntry.buffer);
			cv.setUint32(0, 0x02014b50, true); // signature
			cv.setUint16(4, 20, true); // version made by
			cv.setUint16(6, 20, true); // version needed
			cv.setUint16(8, 0, true); // flags
			cv.setUint16(10, 0, true); // compression
			cv.setUint16(12, 0, true); // mod time
			cv.setUint16(14, 0, true); // mod date
			cv.setUint32(16, crc, true);
			cv.setUint32(20, entry.data.length, true);
			cv.setUint32(24, entry.data.length, true);
			cv.setUint16(28, nameBytes.length, true);
			cv.setUint16(30, 0, true); // extra field length
			cv.setUint16(32, 0, true); // comment length
			cv.setUint16(34, 0, true); // disk number
			cv.setUint16(36, 0, true); // internal attrs
			cv.setUint32(38, 0, true); // external attrs
			cv.setUint32(42, offset, true); // local header offset
			cdEntry.set(nameBytes, 46);

			centralDir.push(cdEntry);
			offset += header.length + entry.data.length;
		}

		const cdOffset = offset;
		let cdSize = 0;
		for (const cd of centralDir) {
			zipParts.push(cd);
			cdSize += cd.length;
		}

		// End of central directory
		const eocd = new Uint8Array(22);
		const ev = new DataView(eocd.buffer);
		ev.setUint32(0, 0x06054b50, true);
		ev.setUint16(4, 0, true);
		ev.setUint16(6, 0, true);
		ev.setUint16(8, entries.length, true);
		ev.setUint16(10, entries.length, true);
		ev.setUint32(12, cdSize, true);
		ev.setUint32(16, cdOffset, true);
		ev.setUint16(20, 0, true);
		zipParts.push(eocd);

		// Concatenate all parts
		const totalLen = zipParts.reduce((sum, p) => sum + p.length, 0);
		const zipData = new Uint8Array(totalLen);
		let pos = 0;
		for (const part of zipParts) {
			zipData.set(part, pos);
			pos += part.length;
		}

		c.header("Content-Type", "application/zip");
		c.header("Content-Disposition", 'attachment; filename="canvas.zip"');
		return c.body(zipData);
	});

	app.post("/api/canvas/clear", (c) => {
		// Preserves protected app spaces — see clearCanvasPreservingApps.
		clearCanvasPreservingApps(canvasRoot);
		// Clear all event buffers
		canvasEvents.clear();
		return c.json({ cleared: true });
	});

	// B1: Canvas version history — list versions for a file
	app.get("/api/canvas/versions/:path{.+}", (c) => {
		const filePath = c.req.param("path");
		const versions = database
			.prepare(
				"SELECT id, path, created_at FROM canvas_versions WHERE path = ? ORDER BY created_at DESC LIMIT 10",
			)
			.all(filePath) as Array<{ id: number; path: string; created_at: string }>;
		return c.json({ versions });
	});

	// B1: Restore a canvas version
	app.post("/api/canvas/restore/:id", async (c) => {
		const id = Number.parseInt(c.req.param("id"), 10);
		if (isNaN(id)) return c.json({ error: "Invalid version ID" }, 400);

		const version = database
			.prepare("SELECT id, path, content FROM canvas_versions WHERE id = ?")
			.get(id) as { id: number; path: string; content: string } | null;

		if (!version) return c.json({ error: "Version not found" }, 404);

		// Validate path
		const fullPath = resolve(canvasRoot, version.path);
		const rel = relative(canvasRoot, fullPath);
		if (rel.startsWith("..") || fullPath.includes("\0")) {
			return c.json({ error: "Invalid path" }, 400);
		}

		// Save current content as a version before restoring
		if (existsSync(fullPath)) {
			try {
				const current = readFileSync(fullPath, "utf-8");
				database.run(
					"INSERT INTO canvas_versions (path, content) VALUES (?, ?)",
					[version.path, current],
				);
				database.run(
					`DELETE FROM canvas_versions WHERE path = ? AND id NOT IN (
            SELECT id FROM canvas_versions WHERE path = ? ORDER BY created_at DESC LIMIT 10
          )`,
					[version.path, version.path],
				);
			} catch {
				/* best-effort */
			}
		}

		// Write the restored content
		const dir = resolve(fullPath, "..");
		mkdirSync(dir, { recursive: true });
		await Bun.write(fullPath, version.content);

		return c.json({ restored: true, path: version.path });
	});

	// B1: Get version content (for diff view)
	app.get("/api/canvas/version-content/:id", (c) => {
		const id = Number.parseInt(c.req.param("id"), 10);
		if (isNaN(id)) return c.json({ error: "Invalid version ID" }, 400);

		const version = database
			.prepare(
				"SELECT id, path, content, created_at FROM canvas_versions WHERE id = ?",
			)
			.get(id) as {
			id: number;
			path: string;
			content: string;
			created_at: string;
		} | null;

		if (!version) return c.json({ error: "Version not found" }, 404);
		return c.json({
			id: version.id,
			path: version.path,
			content: version.content,
			created_at: version.created_at,
		});
	});

	// Inline click-to-edit (owner-only; NOT in PUBLIC_PREFIXES → auth-gated).
	// Extracted to a factory so it's app-testable; mounted at "/" so its absolute
	// /api/canvas/edit* paths resolve. Stamps stable data-edit-id anchors on
	// edit-prep, byte-splices inner text on save (round-trip guarded), and reverts
	// to the latest canvas_versions snapshot on restore — all through writeCanvasFile.
	app.route(
		"/",
		createCanvasEditRoutes({
			canvasRoot,
			db: database,
			appNamespace: APP_NAMESPACE,
			audit: (action, userId, details, ip) =>
				authManager.audit.log(action, userId, details, ip),
			getClientIp,
		}),
	);

	// B3: Canvas templates — list available templates
	app.get("/api/canvas/templates", (c) => {
		return c.json({
			templates: CANVAS_TEMPLATES.map((t) => ({
				name: t.name,
				description: t.description,
				files: Object.keys(t.files),
			})),
		});
	});

	// B3: Apply a template to the canvas
	app.post("/api/canvas/template", async (c) => {
		const body = await c.req.json<{ name: string }>();
		const template = CANVAS_TEMPLATES.find((t) => t.name === body.name);
		if (!template) return c.json({ error: "Template not found" }, 404);

		// Clear existing canvas files (preserving protected app spaces)
		clearCanvasPreservingApps(canvasRoot);

		// Write template files
		for (const [filePath, content] of Object.entries(template.files)) {
			const fullPath = resolve(canvasRoot, filePath);
			const dir = resolve(fullPath, "..");
			mkdirSync(dir, { recursive: true });
			await Bun.write(fullPath, content);
		}

		// Clear event buffers
		canvasEvents.clear();

		return c.json({ applied: true, files: Object.keys(template.files) });
	});

	app.get("/api/canvas/files", (c) => {
		if (!existsSync(canvasRoot)) {
			return c.json({ files: [] });
		}

		const files: Array<{ path: string; size: number; mtime: number }> = [];
		function walk(dir: string): void {
			if (files.length >= 200) return;
			const items = readdirSync(dir, { withFileTypes: true });
			for (const item of items) {
				if (item.name.startsWith(".")) continue;
				const full = resolve(dir, item.name);
				if (item.isDirectory()) {
					walk(full);
				} else {
					const stat = statSync(full);
					files.push({
						path: relative(canvasRoot, full),
						size: stat.size,
						mtime: stat.mtimeMs,
					});
				}
			}
		}
		walk(canvasRoot);
		return c.json({ files });
	});

	// Resolve a canvas-relative path safely (logical + symlink guard). Mirrors
	// safePath() in canvas-tools.ts. Returns the absolute path or null.
	function canvasResolve(rel: string): string | null {
		if (typeof rel !== "string") return null;
		const full = resolve(canvasRoot, rel);
		const r = relative(canvasRoot, full);
		if (r.startsWith("..") || full.includes("\0")) return null;
		if (existsSync(full)) {
			try {
				if (relative(canvasRoot, realpathSync(full)).startsWith(".."))
					return null;
			} catch {
				return null;
			}
		}
		return full;
	}

	// Full workspace tree (files AND folders, so empty folders show in the explorer).
	app.get("/api/canvas/tree", (c) => {
		const entries: Array<{
			path: string;
			type: "file" | "dir";
			size?: number;
			mtime?: number;
		}> = [];
		if (!existsSync(canvasRoot)) return c.json({ entries });
		function walk(dir: string, depth: number): void {
			if (entries.length >= 1000 || depth > 12) return;
			for (const item of readdirSync(dir, { withFileTypes: true })) {
				if (item.name.startsWith(".")) continue;
				const full = resolve(dir, item.name);
				const rel = relative(canvasRoot, full);
				if (item.isDirectory()) {
					entries.push({ path: rel, type: "dir" });
					walk(full, depth + 1);
				} else {
					const stat = statSync(full);
					entries.push({
						path: rel,
						type: "file",
						size: stat.size,
						mtime: stat.mtimeMs,
					});
				}
			}
		}
		walk(canvasRoot, 0);
		return c.json({ entries });
	});

	app.post("/api/canvas/mkdir", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { path?: string };
		const rel = (body.path ?? "").trim();
		if (!rel || rel === "." || rel === "/")
			return c.json({ error: "Invalid path" }, 400);
		const full = canvasResolve(rel);
		if (!full) return c.json({ error: "Invalid path" }, 400);
		mkdirSync(full, { recursive: true });
		pushFileChanged(rel);
		return c.json({ ok: true, path: rel });
	});

	app.post("/api/canvas/delete", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { path?: string };
		const rel = (body.path ?? "").trim();
		if (!rel || rel === "." || rel === "/" || rel === "./")
			return c.json({ error: "Refusing to delete canvas root" }, 400);
		const full = canvasResolve(rel);
		if (!full || resolve(full) === resolve(canvasRoot))
			return c.json({ error: "Invalid path" }, 400);
		if (!existsSync(full)) return c.json({ error: "Not found" }, 404);
		rmSync(full, { recursive: true, force: true });
		pushFileChanged(rel);
		return c.json({ ok: true, path: rel });
	});

	app.post("/api/canvas/rename", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			from?: string;
			to?: string;
		};
		const from = (body.from ?? "").trim();
		const to = (body.to ?? "").trim();
		if (!from || !to) return c.json({ error: "from and to are required" }, 400);
		const fromFull = canvasResolve(from);
		const toFull = canvasResolve(to);
		if (!fromFull || !toFull) return c.json({ error: "Invalid path" }, 400);
		if (!existsSync(fromFull)) return c.json({ error: "Not found" }, 404);
		if (existsSync(toFull)) return c.json({ error: "Destination exists" }, 409);
		mkdirSync(dirname(toFull), { recursive: true });
		renameSync(fromFull, toFull);
		pushFileChanged(to);
		pushFileChanged(from);
		return c.json({ ok: true, from, to });
	});

	app.post("/api/canvas/new-file", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			path?: string;
			content?: string;
		};
		const rel = (body.path ?? "").trim();
		if (!rel || rel.endsWith("/"))
			return c.json({ error: "Invalid path" }, 400);
		const full = canvasResolve(rel);
		if (!full) return c.json({ error: "Invalid path" }, 400);
		if (existsSync(full)) return c.json({ error: "File exists" }, 409);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, typeof body.content === "string" ? body.content : "");
		pushFileChanged(rel);
		return c.json({ ok: true, path: rel });
	});

	// Search canvas files by name (always) and optionally by content.
	app.get("/api/canvas/search", (c) => {
		const q = (c.req.query("q") ?? "").trim().toLowerCase();
		const searchContent = c.req.query("content") === "1";
		const results: Array<{ path: string; line?: number; snippet?: string }> =
			[];
		if (!q || !existsSync(canvasRoot)) return c.json({ results });
		let scanned = 0;
		function walk(dir: string, depth: number): void {
			if (results.length >= 100 || depth > 12) return;
			for (const item of readdirSync(dir, { withFileTypes: true })) {
				if (item.name.startsWith(".")) continue;
				const full = resolve(dir, item.name);
				const rel = relative(canvasRoot, full);
				if (item.isDirectory()) {
					walk(full, depth + 1);
					continue;
				}
				if (rel.toLowerCase().includes(q)) {
					results.push({ path: rel });
					continue;
				}
				if (searchContent && scanned < 300) {
					scanned++;
					try {
						const stat = statSync(full);
						if (stat.size > 512 * 1024) continue; // skip large/binary
						const text = readFileSync(full, "utf-8");
						const idx = text.toLowerCase().indexOf(q);
						if (idx !== -1) {
							const line = text.slice(0, idx).split("\n").length;
							const lineText = text.split("\n")[line - 1] ?? "";
							results.push({
								path: rel,
								line,
								snippet: lineText.trim().slice(0, 160),
							});
						}
					} catch {
						// unreadable/binary — skip
					}
				}
			}
		}
		walk(canvasRoot, 0);
		return c.json({ results });
	});

	app.get("/api/canvas/preview/*", async (c) => {
		const reqPath =
			c.req.path.replace("/api/canvas/preview/", "").replace(/^\/+/, "") ||
			"index.html";
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

		// `__home__` is the reserved path that backs the pinned "Home" tab. The
		// Home tab now loads the live companion (`/companion`); this legacy route
		// used to render the old inline portrait face here. Redirect it to the
		// companion so the old face can never paint — even from a stale client or
		// a cached pre-companion chat script that still requests this path.
		const isHome = decoded === "__home__";
		if (isHome) return c.redirect("/companion");
		if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) {
			// Empty canvas: a neutral "nothing built yet" placeholder (NO face).
			// Served from a static file so app.ts holds NO inline template-literal
			// HTML — the old ~530-line inline portrait that rendered here was a
			// recurring backtick template-literal trap. The live agent face is the
			// /companion Home tab (handled by the __home__ redirect above).
			if (decoded === "index.html") {
				return c.html(
					await Bun.file(
						resolve(import.meta.dir, "public/app", "canvas-empty.html"),
					).text(),
				);
			}
			return c.text("Not found", 404);
		}

		const ext = extname(fullPath).toLowerCase();
		const contentType = canvasContentType(ext);

		const file = Bun.file(fullPath);

		// B2: Inject error overlay + runtime shim into HTML files at serve time.
		if (ext === ".html" || ext === ".htm") {
			const html = injectCanvasRuntime(await file.text(), {
				companion: isCanvasCompanionVisitor(c),
			});
			c.header("Content-Type", contentType);
			c.header("Cache-Control", "no-cache");
			return c.body(html);
		}

		c.header("Content-Type", contentType);
		c.header("Cache-Control", "no-cache");
		return c.body(await file.arrayBuffer());
	});

	// --- App spaces ---
	// Authed serving for production app surfaces under `apps/<space>/`. Unlike
	// `/api/canvas/preview/*` (public sketch surface), this route sits AFTER the
	// auth middleware and is NOT in PUBLIC_PREFIXES, so it requires a session by
	// default. Reuses the same canvas files, MIME map, traversal/symlink guards,
	// and runtime shim; adds directory-index resolution (folder/ → index.html)
	// and a strict per-space CSP (see security-headers.ts).
	app.get("/api/app/:space/*", async (c) => {
		const space = c.req.param("space");
		// Strip "/api/app/<space>/" → subpath within the space.
		const prefix = `/api/app/${space}/`;
		const sub = c.req.path.startsWith(prefix)
			? c.req.path.slice(prefix.length)
			: "";
		let decoded: string;
		try {
			decoded = decodeURIComponent(sub.replace(/^\/+/, "")) || "index.html";
		} catch {
			return c.text("Bad Request", 400);
		}
		// All app files live under apps/<space>/ in the canvas root.
		const spaceRoot = resolve(canvasRoot, APP_NAMESPACE, space);
		let fullPath = resolve(spaceRoot, decoded);

		// Path traversal check (logical path) — must stay within the space.
		if (
			relative(spaceRoot, fullPath).startsWith("..") ||
			fullPath.includes("\0")
		) {
			return c.text("Forbidden", 403);
		}

		// Directory-index resolution: a directory (or trailing slash) serves its
		// index.html — file-based routing the preview surface lacks.
		if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
			fullPath = resolve(fullPath, "index.html");
		}

		// Symlink check: resolve real path and verify it's still within the space.
		if (existsSync(fullPath)) {
			try {
				if (relative(spaceRoot, realpathSync(fullPath)).startsWith("..")) {
					return c.text("Forbidden", 403);
				}
			} catch {
				return c.text("Forbidden", 403);
			}
		} else {
			return c.text("Not found", 404);
		}

		const ext = extname(fullPath).toLowerCase();
		const contentType = canvasContentType(ext);
		const file = Bun.file(fullPath);

		if (ext === ".html" || ext === ".htm") {
			const html = injectCanvasRuntime(await file.text(), {
				companion: isCanvasCompanionVisitor(c),
			});
			c.header("Content-Type", contentType);
			c.header("Cache-Control", "no-cache");
			return c.body(html);
		}
		c.header("Content-Type", contentType);
		c.header("Cache-Control", "no-cache");
		return c.body(await file.arrayBuffer());
	});

	// --- Cron Page ---

	// Registered tools for the cron "tool" action dropdown — name + plugin
	// (label) + description (tooltip), sorted for stable rendering. Includes
	// on-demand skill tools; the scheduler's permission check governs execution.
	const cronToolList = () =>
		[...kernel.toolRegistryPublic.allTools()]
			.map((t) => ({
				name: t.name,
				plugin: t.plugin,
				description: t.description,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

	app.get("/cron", (c) => {
		const jobs = kernel.cron?.listJobs() ?? [];
		return c.html(CronPage({ jobs, tools: cronToolList() }));
	});

	// --- Heartbeat Page ---

	app.get("/heartbeat", (c) => {
		const lastResult = kernel.heartbeat?.lastResult ?? null;
		const history: Array<{ id: string; text: string; created_at: string }> =
			kernel.memory
				? kernel.memory
						.list({ limit: 50, category: "summary" })
						.filter((m: { text: string; [k: string]: unknown }) =>
							m.text.includes("Heartbeat"),
						)
				: [];
		const hbConfig = {
			enabled: config.heartbeat.enabled,
			intervalMinutes: config.heartbeat.intervalMinutes,
			triggerAiOnFailure: config.heartbeat.triggerAiOnFailure,
		};
		const success = c.req.query("success") ? "Configuration saved." : undefined;
		return c.html(
			HeartbeatPage({
				lastResult,
				history,
				config: hbConfig,
				success,
				metrics: metricsSnapshot(kernel.database),
			}),
		);
	});

	app.post("/api/heartbeat/trigger", async (c) => {
		if (!kernel.heartbeat) {
			return c.json({ error: "Heartbeat is disabled" }, 400);
		}
		const result = await kernel.heartbeat.runCheck();
		const contentType = c.req.header("Content-Type") ?? "";
		if (contentType.includes("application/json")) {
			return c.json(result);
		}
		return c.redirect("/heartbeat");
	});

	app.get("/api/heartbeat/status", (c) => {
		const lastResult = kernel.heartbeat?.lastResult ?? null;
		return c.json({ enabled: config.heartbeat.enabled, lastResult });
	});

	// Live, REAL runtime metrics for the Heartbeat console KPIs (polled).
	app.get("/api/heartbeat/metrics", (c) => {
		return c.json(metricsSnapshot(kernel.database));
	});

	app.post("/api/heartbeat/config", async (c) => {
		const body = await c.req.parseBody();
		const overrides = readConfigOverrides();
		const hb = (overrides.heartbeat ?? {}) as Record<string, unknown>;
		if (body.enabled !== undefined) hb.enabled = body.enabled === "true";
		if (body.intervalMinutes !== undefined)
			hb.intervalMinutes = Number.parseInt(String(body.intervalMinutes), 10);
		if (body.triggerAiOnFailure !== undefined)
			hb.triggerAiOnFailure = body.triggerAiOnFailure === "true";
		overrides.heartbeat = hb;
		saveConfigOverrides(overrides);
		return c.redirect("/heartbeat?success=1");
	});

	// --- Memory Page ---
	app.get("/memory", async (c) => {
		const q = c.req.query("q") ?? "";
		const category = c.req.query("category") ?? "";
		const stats = kernel.memory?.getStats() ?? null;
		const ownerUserId = getRequestUserId(c);

		let memories: Array<{
			id: string;
			text: string;
			scope: string;
			category: string;
			source: string | null;
			created_at: string;
			confidence?: number;
			access_count?: number;
			last_accessed_at?: string | null;
		}> = [];

		if (kernel.memory) {
			if (q) {
				const results = await kernel.memory.recall(q, {
					limit: 50,
					ownerUserId: ownerUserId ?? undefined,
				});
				memories = results.map((r) => ({
					id: r.id,
					text: r.text,
					scope: r.metadata.scope,
					category: r.metadata.category,
					source: r.metadata.source ?? null,
					created_at: r.created_at,
					confidence: r.confidence,
					access_count: r.access_count,
				}));

				// Filter by category client-side if search was used
				if (category) {
					memories = memories.filter((m) => m.category === category);
				}
			} else {
				memories = kernel.memory.list({
					limit: 50,
					category: category || undefined,
					ownerUserId: ownerUserId ?? undefined,
				});
			}
		}

		return c.html(MemoryPage({ memories, stats, query: q, category }));
	});

	// --- Search Page ---

	app.get("/search", (c) => {
		const q = c.req.query("q") ?? "";
		const admin = c.get("admin") as
			| { id: number; username: string }
			| undefined;
		const userId = admin ? `web-${admin.id}` : "web-anonymous";
		const hits: SearchHit[] = q
			? searchMessages(kernel.database, q, {
					userId,
					limit: 50,
				}).map((h) => ({
					id: h.id,
					session_id: h.session_id,
					role: h.role,
					snippet: h.snippet,
					created_at: h.created_at,
					session_title: h.session_title,
					session_channel: h.session_channel,
				}))
			: [];
		return c.html(SearchPage({ query: q, hits }));
	});

	app.get("/audit", (c) => {
		const actionFilter = c.req.query("action") ?? undefined;
		const userRaw = c.req.query("user");
		const userFilter = userRaw && /^\d+$/.test(userRaw) ? userRaw : undefined;
		const rows: AuditRow[] = authManager.audit.query({
			limit: 200,
			action: actionFilter,
			userId: userFilter ? Number.parseInt(userFilter, 10) : undefined,
		});
		const actions = authManager.audit.distinctActions(100);
		return c.html(AuditPage({ rows, actions, actionFilter, userFilter }));
	});

	app.get("/submissions", (c) => {
		const actionFilter = c.req.query("action") ?? undefined;
		const actions = kernel.database
			.prepare(
				"SELECT id, name, type, config_json, submit_count, active, created_at FROM canvas_actions ORDER BY created_at DESC LIMIT 200",
			)
			.all() as CanvasAction[];
		const submissions = (
			actionFilter
				? kernel.database
						.prepare(
							`SELECT s.id, s.action_id, a.name AS action_name, s.data_json, s.status, s.target_ref, s.created_at
							 FROM canvas_submissions s LEFT JOIN canvas_actions a ON a.id = s.action_id
							 WHERE s.action_id = ? ORDER BY s.created_at DESC LIMIT 300`,
						)
						.all(actionFilter)
				: kernel.database
						.prepare(
							`SELECT s.id, s.action_id, a.name AS action_name, s.data_json, s.status, s.target_ref, s.created_at
							 FROM canvas_submissions s LEFT JOIN canvas_actions a ON a.id = s.action_id
							 ORDER BY s.created_at DESC LIMIT 300`,
						)
						.all()
		) as CanvasSubmission[];
		return c.html(SubmissionsPage({ actions, submissions, actionFilter }));
	});

	app.get("/prompts", (c) => {
		const prompts = listPrompts(kernel.database, 200);
		return c.html(PromptsPage({ prompts }));
	});

	app.get("/api/prompts", (c) => {
		const limitRaw = Number.parseInt(c.req.query("limit") ?? "200", 10);
		const prompts = listPrompts(
			kernel.database,
			Number.isFinite(limitRaw) ? limitRaw : 200,
		);
		return c.json({ prompts });
	});

	app.post("/api/prompts", async (c) => {
		const body = await c.req
			.json<{ title?: string; body?: string; tags?: string }>()
			.catch(() => ({}) as { title?: string; body?: string; tags?: string });
		try {
			const prompt = createPrompt(kernel.database, {
				title: body.title ?? "",
				body: body.body ?? "",
				tags: body.tags,
			});
			return c.json({ prompt });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return c.json({ error: msg }, 400);
		}
	});

	app.put("/api/prompts/:id", async (c) => {
		const id = c.req.param("id");
		const body = await c.req
			.json<{ title?: string; body?: string; tags?: string | null }>()
			.catch(
				() =>
					({}) as {
						title?: string;
						body?: string;
						tags?: string | null;
					},
			);
		const prompt = updatePrompt(kernel.database, id, body);
		if (!prompt) return c.json({ error: "Prompt not found" }, 404);
		return c.json({ prompt });
	});

	app.delete("/api/prompts/:id", (c) => {
		const id = c.req.param("id");
		const ok = deletePrompt(kernel.database, id);
		if (!ok) return c.json({ error: "Prompt not found" }, 404);
		return c.json({ deleted: true });
	});

	app.post("/api/prompts/:id/use", (c) => {
		const id = c.req.param("id");
		const prompt = getPrompt(kernel.database, id);
		if (!prompt) return c.json({ error: "Prompt not found" }, 404);
		recordPromptUse(kernel.database, id);
		return c.json({ prompt });
	});

	app.get("/tools", (c) => {
		const toolLog = kernel.tools;
		if (!toolLog) {
			return c.text("Tool log disabled", 400);
		}
		const toolFilter = c.req.query("tool") || undefined;
		const errorsOnly = c.req.query("errors") === "1";
		const rows: ToolLogRow[] = toolLog.query({
			limit: 200,
			tool: toolFilter,
			errorsOnly,
		});
		return c.html(
			ToolsPage({
				rows,
				tools: toolLog.distinctTools(100),
				summary: toolLog.summary(),
				toolFilter,
				errorsOnly,
			}),
		);
	});

	app.get("/api/tools/log", (c) => {
		const toolLog = kernel.tools;
		if (!toolLog) return c.json({ error: "Tool log disabled" }, 400);
		const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
		const rows = toolLog.query({
			limit: Number.isFinite(limit) ? limit : 100,
			tool: c.req.query("tool") || undefined,
			sessionId: c.req.query("session") || undefined,
			errorsOnly: c.req.query("errors") === "1",
		});
		return c.json({ count: rows.length, rows, summary: toolLog.summary() });
	});

	app.get("/api/audit", (c) => {
		const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
		const action = c.req.query("action") ?? undefined;
		const userRaw = c.req.query("user");
		const userId =
			userRaw && /^\d+$/.test(userRaw)
				? Number.parseInt(userRaw, 10)
				: undefined;
		const rows = authManager.audit.query({
			limit: Number.isFinite(limit) ? limit : 100,
			action,
			userId,
		});
		return c.json({ count: rows.length, rows });
	});

	app.get("/api/search", (c) => {
		const q = c.req.query("q") ?? "";
		const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
		const sessionId = c.req.query("session") ?? undefined;
		const admin = c.get("admin") as
			| { id: number; username: string }
			| undefined;
		const userId = admin ? `web-${admin.id}` : "web-anonymous";
		const hits = q
			? searchMessages(kernel.database, q, {
					userId,
					limit: Number.isFinite(limit) ? limit : 50,
					sessionId,
				})
			: [];
		return c.json({ query: q, count: hits.length, hits });
	});

	// --- Sessions Page ---

	app.get("/sessions", (c) => {
		const userId = getRequestUserId(c);
		if (!userId) return c.text("Unauthorized", 401);
		const sessions = listRecentSessionsForUser(kernel.database, userId, 50);
		// Persistence diagnostic: forUser=0 but total>0 ⇒ owner mismatch;
		// both 0 ⇒ empty/wiped DB.
		createLogger("web").info("Sessions list", {
			userId,
			forUser: sessions.length,
			total: countAllSessions(kernel.database),
		});
		return c.html(SessionsListPage({ sessions }));
	});

	app.get("/sessions/:id", (c) => {
		const id = c.req.param("id");
		const userId = getRequestUserId(c);
		if (!userId) return c.text("Unauthorized", 401);
		const session = getSessionOwnedBy(kernel.database, id, userId);
		if (!session) return c.text("Session not found", 404);
		// High limit: the detail page shows full history (the old
		// getSessionWithMessages had no limit; the default 50 would truncate).
		const messages = getSessionMessages(kernel.database, id, 100_000);
		return c.html(SessionDetailPage({ session, messages }));
	});

	// --- Skills Page ---

	app.get("/skills", (c) => {
		const skills = kernel.skills.getAllSkills();
		const totalTools = skills.reduce((sum, s) => sum + s.toolNames.length, 0);
		const success = c.req.query("success")
			? "Skill updated successfully."
			: undefined;
		return c.html(SkillsPage({ skills, totalTools, success }));
	});

	// --- MCP Page ---

	app.get("/mcp", (c) => {
		const servers = kernel.mcpManager.getServerInfo();
		const success = c.req.query("success")
			? "MCP server added and connected successfully."
			: undefined;
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
		const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);
		const ownerUserId = getRequestUserId(c) ?? undefined;

		if (!q) {
			const memories = kernel.memory.list({
				limit,
				category: category || undefined,
				ownerUserId,
			});
			return c.json({ memories });
		}

		const results = await kernel.memory.recall(q, {
			limit,
			scope: scope || undefined,
			ownerUserId,
		});
		return c.json({ memories: results });
	});

	app.get("/api/memory/:id", (c) => {
		if (!kernel.memory) {
			return c.json({ error: "Memory system disabled" }, 400);
		}
		const id = c.req.param("id");
		if (!/^[A-Za-z0-9-]+$/.test(id)) {
			return c.json({ error: "Invalid memory id" }, 400);
		}
		const ownerUserId = getRequestUserId(c);
		if (!ownerUserId) return c.json({ error: "Unauthorized" }, 401);
		const mem = kernel.memory.getByIdForOwner(id, ownerUserId);
		if (!mem) return c.json({ error: "Not found" }, 404);
		return c.json({ memory: mem });
	});

	app.delete("/api/memory/:id", (c) => {
		if (!kernel.memory) {
			return c.json({ error: "Memory system disabled" }, 400);
		}
		const id = c.req.param("id");
		const ownerUserId = getRequestUserId(c);
		if (!ownerUserId) return c.json({ error: "Unauthorized" }, 401);
		// Only delete if the memory is visible to this admin (C-NEW-1, M-NEW-15).
		const mem = kernel.memory.getByIdForOwner(id, ownerUserId);
		if (!mem) return c.json({ error: "Not found" }, 404);
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
			const body = await c.req.json<{
				text: string;
				category?: string;
				scope?: string;
			}>();
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

		const ownerUserId = getRequestUserId(c) ?? null;

		const id = await kernel.memory.store(text.trim(), {
			scope,
			category: category as "fact" | "preference" | "decision" | "summary",
			source: "web-ui",
			ownerUserId,
		});

		// Redirect back to memory page for form submissions
		if (!contentType.includes("application/json")) {
			return c.redirect("/memory?success=1");
		}
		return c.json({ id });
	});

	app.post("/api/memory/import", async (c) => {
		if (!kernel.memory) {
			return c.json({ error: "Memory system disabled" }, 400);
		}
		type ImportBody = {
			text?: string;
			source?: string;
			scope?: string;
			category?: "fact" | "summary";
		};
		const body = await c.req.json<ImportBody>().catch(() => ({}) as ImportBody);
		const text = String(body.text ?? "");
		if (!text.trim()) return c.json({ error: "text is required" }, 400);

		// Hard size limit to protect the embedding pipeline + DB.
		const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // 2 MiB
		if (text.length > MAX_IMPORT_BYTES) {
			return c.json({ error: `text exceeds ${MAX_IMPORT_BYTES} bytes` }, 413);
		}

		const source = (body.source ?? "").trim() || "import";
		const scope = body.scope || "global";
		const category: "fact" | "summary" =
			body.category === "summary" ? "summary" : "fact";
		const ownerUserId = getRequestUserId(c) ?? null;

		const { chunkText } = await import("../memory/chunker.js");
		const { chunks, totalChars } = chunkText(text);
		if (chunks.length === 0) {
			return c.json({ error: "empty after normalization" }, 400);
		}

		let stored = 0;
		for (const chunk of chunks) {
			try {
				await kernel.memory.store(chunk, {
					scope,
					category,
					source,
					ownerUserId,
				});
				stored++;
			} catch {
				// swallow and continue so partial success still reports
			}
		}

		const session = c.get("session") as { user_id: number } | undefined;
		authManager.audit.log(
			"memory.import",
			session?.user_id ?? null,
			{ source, stored, total: chunks.length, totalChars },
			getClientIp(c),
		);

		return c.json({
			stored,
			total: chunks.length,
			totalChars,
			source,
		});
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
		const isJson = contentType.includes("application/json");
		let name: string;
		let expression: string;
		let actionType: string;
		let payload: string;
		let toolArgs: string | undefined;

		if (isJson) {
			const body = await c.req.json<{
				name: string;
				expression: string;
				actionType: string;
				payload: string;
				toolArgs?: string;
			}>();
			name = body.name;
			expression = body.expression;
			actionType = body.actionType;
			payload = body.payload;
			toolArgs = body.toolArgs;
		} else {
			const body = await c.req.parseBody();
			name = String(body.name ?? "");
			expression = String(body.expression ?? "");
			actionType = String(body.actionType ?? "prompt");
			payload = String(body.payload ?? "");
			toolArgs =
				body.toolArgs === undefined ? undefined : String(body.toolArgs);
		}

		// Render the page with an error for form posts; JSON for API callers.
		const fail = (message: string) => {
			if (!isJson) {
				const jobs = kernel.cron?.listJobs() ?? [];
				return c.html(
					CronPage({ jobs, tools: cronToolList(), error: message }),
				);
			}
			return c.json({ error: message }, 400);
		};

		if (!name.trim() || !expression.trim() || !payload.trim()) {
			return fail("All fields are required");
		}

		if (!isValidCron(expression.trim())) {
			return fail("Invalid cron expression");
		}

		// H-NEW-1 / H-NEW-2 are enforced here at the API boundary (and again in
		// the scheduler at addJob/execute time — defense in depth).
		const resolved = resolveCronAction(actionType, payload, toolArgs, {
			getTool: (n) => kernel.toolRegistryPublic.get(n),
			toolNames: () => cronToolList().map((t) => t.name),
		});
		if ("error" in resolved) {
			return fail(resolved.error);
		}

		const id = kernel.cron.addJob({
			name: name.trim(),
			expression: expression.trim(),
			action: resolved.action,
		});

		if (!isJson) {
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

	app.post("/api/chat/stream", async (c) => {
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

			const attachments: Array<{
				type: "image" | "text";
				data: Buffer;
				mimeType: string;
				name?: string;
			}> = [];
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

			const admin = c.get("admin") as
				| { id: number; username: string }
				| undefined;
			const userId = admin ? `web-${admin.id}` : "web-anonymous";
			const userName = admin?.username ?? "Web User";

			const msg = {
				id: crypto.randomUUID(),
				sessionId,
				channel: "web" as const,
				content: body.message.trim(),
				attachments: attachments.length > 0 ? attachments : undefined,
				user: { id: userId, name: userName },
				timestamp: new Date().toISOString(),
				// Authenticated admin session — exempt from the pairing-code access
				// controller (still rate-limited). See src/kernel/inbound-gate.ts.
				authenticated: !!admin,
			};

			return streamSSE(c, async (stream) => {
				try {
					for await (const chunk of kernel.handleInboundStream(msg)) {
						await stream.writeSSE({
							data: JSON.stringify(enrichChunk(chunk)),
						});
					}
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					await stream.writeSSE({
						data: JSON.stringify({ type: "error", error: errMsg }),
					});
					await stream.writeSSE({
						data: JSON.stringify({ type: "done" }),
					});
				}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: message }, 500);
		}
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
			const attachments: Array<{
				type: "image" | "text";
				data: Buffer;
				mimeType: string;
				name?: string;
			}> = [];
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
			const userImages = body.images?.map(
				(img: { data: string; mimeType: string }) =>
					`data:${img.mimeType};base64,${img.data}`,
			);

			const admin = c.get("admin") as
				| { id: number; username: string }
				| undefined;
			const userId = admin ? `web-${admin.id}` : "web-anonymous";
			const userName = admin?.username ?? "Web User";

			// Create a promise that resolves when the outbound message arrives
			const responsePromise = new Promise<{
				content: string;
				images?: string[];
			}>((resolve, reject) => {
				const handler = (outbound: {
					sessionId: string;
					content: string;
					attachments?: Array<{
						type: string;
						data?: Buffer;
						mimeType?: string;
					}>;
				}) => {
					if (outbound.sessionId === sessionId) {
						clearTimeout(timeout);
						kernel.eventBus.off("message:outbound", handler);
						// Convert image attachments to base64 data URIs for the web UI
						const images = outbound.attachments
							?.filter((a) => a.type === "image" && a.data && a.mimeType)
							.map(
								(a) =>
									`data:${a.mimeType};base64,${a.data!.toString("base64")}`,
							);
						resolve({
							content: outbound.content,
							images: images?.length ? images : undefined,
						});
					}
				};

				const timeout = setTimeout(() => {
					kernel.eventBus.off("message:outbound", handler); // prevent listener leak
					reject(new Error("Response timeout"));
				}, 1_800_000); // 30 minutes — large model tool pipelines can take 10-20 min

				kernel.eventBus.on("message:outbound", handler);
			});

			// Emit the inbound message (fire-and-forget so errors flow through the bus)
			kernel.eventBus
				.emit("message:inbound", {
					id: crypto.randomUUID(),
					sessionId,
					channel: "web",
					content: body.message.trim(),
					attachments: attachments.length > 0 ? attachments : undefined,
					user: { id: userId, name: userName },
					timestamp: new Date().toISOString(),
					// Authenticated admin session — exempt from the pairing-code
					// access controller (still rate-limited).
					authenticated: !!admin,
				})
				.catch((err) => {
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
		let authToken: string;
		let headersStr: string;

		if (contentType.includes("application/json")) {
			const body = await c.req.json<Record<string, string>>();
			name = body.name ?? "";
			transport = body.transport ?? "stdio";
			command = body.command ?? "";
			args = body.args ?? "";
			url = body.url ?? "";
			envStr = body.env ?? "";
			authToken = body.authToken ?? "";
			headersStr = body.headers ?? "";
		} else {
			const body = await c.req.parseBody();
			name = String(body.name ?? "");
			transport = String(body.transport ?? "stdio");
			command = String(body.command ?? "");
			args = String(body.args ?? "");
			url = String(body.url ?? "");
			envStr = String(body.env ?? "");
			authToken = String(body.authToken ?? "");
			headersStr = String(body.headers ?? "");
		}

		name = name.trim();
		if (!name) {
			if (!contentType.includes("application/json")) {
				return c.redirect(
					"/mcp?error=" + encodeURIComponent("Server name is required"),
				);
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

		// Auth for remote transports
		if (authToken.trim()) serverConfig.authToken = authToken.trim();
		if (headersStr.trim()) {
			const headers = parseHeaderLines(headersStr);
			if (Object.keys(headers).length > 0) serverConfig.headers = headers;
		}

		// Normalize the name to a canonical (lowercase) key and persist the whole
		// mcpServers map wholesale (replace, not merge) so a re-add of a different
		// casing updates the existing entry rather than forking a duplicate.
		name = normalizeMcpName(name);
		const existing = readConfigOverrides();
		const mcpServers = upsertMcpServer(
			(existing.mcpServers ?? {}) as Record<string, unknown>,
			name,
			serverConfig,
		);
		replaceConfigOverride("mcpServers", mcpServers);

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

	// Parse "Key: Value" (or "Key=Value") header lines into an object.
	function parseHeaderLines(s: string): Record<string, string> {
		const out: Record<string, string> = {};
		for (const line of s.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			const sep = t.search(/[:=]/);
			if (sep > 0) out[t.slice(0, sep).trim()] = t.slice(sep + 1).trim();
		}
		return out;
	}

	// Import one or more MCP servers from a pasted standard config. Accepts the
	// canonical { "mcpServers": { name: {...} } }, a bare { name: {...} } map, or
	// a single server object (with `name`). Each entry may carry authToken/headers.
	app.post("/api/mcp/import", async (c) => {
		let raw: unknown;
		try {
			const body = await c.req.json<{ json?: string }>();
			raw =
				typeof body.json === "string"
					? JSON.parse(body.json)
					: (body.json ?? body);
		} catch {
			return c.json({ error: "Invalid JSON" }, 400);
		}
		// Normalize into a name->config map.
		let servers: Record<string, unknown> = {};
		const obj = raw as Record<string, unknown>;
		if (obj && typeof obj === "object") {
			if (obj.mcpServers && typeof obj.mcpServers === "object") {
				servers = obj.mcpServers as Record<string, unknown>;
			} else if (typeof obj.name === "string") {
				const { name, ...rest } = obj as { name: string };
				servers = { [name]: rest };
			} else {
				servers = obj;
			}
		}
		const names = Object.keys(servers).filter(
			(k) => servers[k] && typeof servers[k] === "object",
		);
		if (names.length === 0) {
			return c.json({ error: "No MCP servers found in the pasted JSON" }, 400);
		}

		const existing = readConfigOverrides();
		let mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
		const imported: string[] = [];
		const connected: string[] = [];
		for (const rawName of names) {
			const cfg = servers[rawName] as Record<string, unknown>;
			// Infer transport if missing: url → http, command → stdio.
			if (!cfg.transport) cfg.transport = cfg.url ? "http" : "stdio";
			// Canonical (lowercase) key; a re-import of a differently-cased name
			// updates the existing entry instead of forking a duplicate.
			const name = normalizeMcpName(rawName);
			mcpServers = upsertMcpServer(mcpServers, name, cfg);
			imported.push(name);
		}
		// Persist the whole map wholesale (replace, not merge).
		replaceConfigOverride("mcpServers", mcpServers);

		// Live-connect each imported server (best-effort).
		for (const name of imported) {
			try {
				await kernel.mcpManager.connectServer(
					name,
					mcpServers[name] as Parameters<
						typeof kernel.mcpManager.connectServer
					>[1],
				);
				const tools = await kernel.mcpManager.discoverTools(name);
				if (tools.length > 0) kernel.registerTools(tools);
				connected.push(name);
			} catch {
				// saved but not connected — user can reconnect
			}
		}
		return c.json({ ok: true, imported, connected });
	});

	// Live-(re)connect the configured n8n MCP endpoints without a full restart.
	app.post("/api/n8n/reconnect", async (c) => {
		const n8n = liveConfig().n8n;
		if (!n8n?.enabled || !n8n.token) {
			return c.json(
				{ error: "n8n is disabled or missing a token — save the form first." },
				400,
			);
		}
		const eps = (n8n.endpoints ?? []).filter((e) => e?.name && e?.url);
		const connected: string[] = [];
		for (const ep of eps) {
			const key = `n8n_${ep.name}`.replace(/[^a-zA-Z0-9_]/g, "_");
			try {
				await kernel.mcpManager.connectServer(key, {
					transport: n8n.transport,
					url: ep.url,
					authToken: n8n.token,
				} as Parameters<typeof kernel.mcpManager.connectServer>[1]);
				const tools = await kernel.mcpManager.discoverTools(key);
				if (tools.length > 0) kernel.registerTools(tools);
				connected.push(key);
			} catch {
				// leave it disconnected; user can retry
			}
		}
		return c.json({ ok: true, total: eps.length, connected });
	});

	// ===== Brand Kit =====
	function brandAssetResolve(id: string, file: string): string | null {
		if (!id || !file) return null;
		const full = resolve(brandRoot, id, file);
		const rel = relative(brandRoot, full);
		if (rel.startsWith("..") || full.includes("\0")) return null;
		return full;
	}
	const IMG_MIME: Record<string, string> = {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".webp": "image/webp",
		".svg": "image/svg+xml",
		".ico": "image/x-icon",
	};
	function extForMime(mime: string): string {
		const hit = Object.entries(IMG_MIME).find(([, v]) => v === mime);
		return hit ? hit[0] : ".png";
	}

	// Public: brand CSS variables for the active (or ?brand=) brand.
	app.get("/api/brand/tokens.css", (c) => {
		const id = c.req.query("brand");
		const brand = id
			? getBrand(kernel.database, id)
			: getActiveBrand(kernel.database);
		c.header("Content-Type", "text/css; charset=utf-8");
		c.header("Cache-Control", "no-cache");
		return c.body(renderBrandTokensCss(brand));
	});

	// Public: app-chrome theme — maps the active brand onto the Paw design
	// tokens so the console + auth screens re-skin. Empty (no-op) when no brand.
	app.get("/api/brand/theme.css", (c) => {
		c.header("Content-Type", "text/css; charset=utf-8");
		c.header("Cache-Control", "no-cache");
		return c.body(renderBrandAppThemeCss(getActiveBrand(kernel.database)));
	});

	// Public: active brand identity (name + logo/favicon URLs) for white-label
	// theming of the console + auth screens. Nulls when no brand is active.
	app.get("/api/brand/ui", (c) => {
		c.header("Cache-Control", "no-cache");
		return c.json(
			getBrandUi(getActiveBrand(kernel.database)) ?? {
				name: null,
				logo: null,
				favicon: null,
			},
		);
	});

	// Public: serve a brand asset file (logo etc.).
	app.get("/api/brand/asset/*", async (c) => {
		const prefix = "/api/brand/asset/";
		const rest = decodeURIComponent(c.req.path.slice(prefix.length));
		const slash = rest.indexOf("/");
		const id = slash > 0 ? rest.slice(0, slash) : "";
		const file = slash > 0 ? rest.slice(slash + 1) : "";
		const full = brandAssetResolve(id, file);
		if (!full || !existsSync(full) || statSync(full).isDirectory()) {
			return c.text("Not found", 404);
		}
		c.header(
			"Content-Type",
			IMG_MIME[extname(full).toLowerCase()] ?? "application/octet-stream",
		);
		c.header("Cache-Control", "public, max-age=300");
		return c.body(await Bun.file(full).arrayBuffer());
	});

	// --- Auth-guarded brand management ---
	app.get("/api/brands", (c) =>
		c.json({ brands: listBrands(kernel.database) }),
	);

	app.post("/api/brands", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			name?: string;
			data?: Partial<BrandDefinition>;
		};
		const name = (body.name ?? "").trim();
		if (!name) return c.json({ error: "Brand name is required" }, 400);
		const brand = createBrand(kernel.database, name, body.data ?? {});
		return c.json({ ok: true, brand }, 201);
	});

	app.put("/api/brands/:id", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			name?: string;
			data?: Partial<BrandDefinition>;
		};
		const brand = updateBrand(kernel.database, c.req.param("id"), body);
		if (!brand) return c.json({ error: "Brand not found" }, 404);
		return c.json({ ok: true, brand });
	});

	app.delete("/api/brands/:id", (c) => {
		const ok = deleteBrand(kernel.database, c.req.param("id"));
		return c.json({ ok }, ok ? 200 : 404);
	});

	app.post("/api/brands/:id/activate", (c) => {
		const ok = activateBrand(kernel.database, c.req.param("id"));
		return c.json({ ok }, ok ? 200 : 404);
	});

	// Upload a logo (base64) into a brand's asset dir, recording the filename.
	app.post("/api/brands/:id/logo", async (c) => {
		const id = c.req.param("id");
		const brand = getBrand(kernel.database, id);
		if (!brand) return c.json({ error: "Brand not found" }, 404);
		const body = (await c.req.json().catch(() => ({}))) as {
			slot?: string;
			data?: string;
			mimeType?: string;
		};
		const slot = ["light", "dark", "icon", "favicon"].includes(body.slot ?? "")
			? (body.slot as "light" | "dark" | "icon" | "favicon")
			: "light";
		const mime = body.mimeType ?? "";
		if (
			!body.data ||
			!IMG_MIME[extForMime(mime)] ||
			!mime.startsWith("image/")
		) {
			return c.json({ error: "An image file is required" }, 400);
		}
		const buf = Buffer.from(body.data, "base64");
		if (buf.length > 2_000_000) {
			return c.json({ error: "Logo too large (max 2MB)" }, 400);
		}
		const filename = `logo-${slot}${extForMime(mime)}`;
		const dir = resolve(brandRoot, id);
		mkdirSync(dir, { recursive: true });
		writeFileSync(resolve(dir, filename), buf);
		updateBrand(kernel.database, id, {
			data: { logos: { ...brand.data.logos, [slot]: filename } },
		});
		return c.json({
			ok: true,
			slot,
			url: `/api/brand/asset/${id}/${filename}`,
		});
	});

	// AI-assisted setup: the agent (vision) reads an uploaded logo/brand-guide
	// and proposes brand fields to pre-fill the form.
	app.post("/api/brands/analyze", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			data?: string;
			mimeType?: string;
		};
		if (!body.data || !body.mimeType?.startsWith("image/")) {
			return c.json({ error: "An image is required" }, 400);
		}
		const prompt =
			"You are a brand designer. Study this logo / brand asset and infer the brand identity. " +
			"Respond with ONLY a JSON object (no prose, no code fences): " +
			'{"name": string, "tagline": string, "colors": {"primary":"#hex","accent":"#hex","bg":"#hex","surface":"#hex","text":"#hex","muted":"#hex"}, ' +
			'"fonts": {"display": string, "body": string}, "voice": string, "guidelines": string}. ' +
			"Use hex colors actually present in the asset; pick web-safe font families that match the style.";
		try {
			const res = await kernel.aiProvider.chat(
				[
					{
						role: "user",
						content: prompt,
						attachments: [
							{
								type: "image",
								data: Buffer.from(body.data, "base64"),
								mimeType: body.mimeType,
							},
						],
					},
				],
				"You analyze brand assets and return strict JSON.",
				`brand-analyze-${Date.now()}`,
				{},
			);
			const text = (res.text ?? "").trim();
			const jsonStr = text
				.replace(/^```(?:json)?\s*/i, "")
				.replace(/\s*```\s*$/i, "")
				.trim();
			const suggestion = JSON.parse(jsonStr);
			return c.json({ ok: true, suggestion });
		} catch (err) {
			return c.json(
				{
					error:
						"Could not analyze the image. The model may not support vision, or returned unparseable output.",
					detail: err instanceof Error ? err.message : String(err),
				},
				422,
			);
		}
	});

	app.delete("/api/mcp/servers/:name", async (c) => {
		const name = normalizeMcpName(c.req.param("name"));

		// Disconnect the live server (try the canonical name + the raw param, in
		// case a legacy mixed-case entry is still connected this session).
		await kernel.mcpManager.disconnectServer(name);
		const raw = c.req.param("name");
		if (raw !== name) await kernel.mcpManager.disconnectServer(raw);

		// Remove from config and persist the map WHOLESALE (replace, not merge) so
		// the removal actually sticks — saveConfigOverrides deep-merges and would
		// resurrect the deleted key from disk. removeMcpServer drops all casings.
		const existing = readConfigOverrides();
		const mcpServers = removeMcpServer(
			(existing.mcpServers ?? {}) as Record<string, unknown>,
			name,
		);
		replaceConfigOverride("mcpServers", mcpServers);

		return c.json({ removed: true });
	});

	app.post("/api/mcp/servers/:name/reconnect", async (c) => {
		const name = normalizeMcpName(c.req.param("name"));

		// Read config for this server (by canonical name).
		const existing = readConfigOverrides();
		const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
		const serverConfig = mcpServers[name] as
			| Record<string, unknown>
			| undefined;

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

	// --- Webhooks Page ---

	app.get("/webhooks", (c) => {
		const webhooks = database
			.prepare("SELECT * FROM webhooks ORDER BY created_at DESC")
			.all() as Array<{
			id: string;
			name: string;
			slug: string;
			secret: string | null;
			description: string;
			event_type: string;
			active: number;
			last_triggered_at: string | null;
			trigger_count: number;
			created_at: string;
		}>;

		// Derive base URL from request
		const proto = trustedProxy
			? (c.req.header("x-forwarded-proto") ?? "http")
			: config.web.tls.enabled
				? "https"
				: "http";
		const host =
			c.req.header("host") ?? `${config.web.host}:${config.web.port}`;
		const baseUrl = `${proto}://${host}`;

		return c.html(WebhooksPage({ webhooks, baseUrl }));
	});

	// --- Webhooks API ---

	app.get("/api/webhooks", (c) => {
		const webhooks = database
			.prepare("SELECT * FROM webhooks ORDER BY created_at DESC")
			.all();
		return c.json({ webhooks });
	});

	app.post("/api/webhooks", async (c) => {
		const body = await c.req.json<{
			name: string;
			slug: string;
			secret?: string;
			description?: string;
			event_type?: string;
		}>();

		if (!body.name?.trim() || !body.slug?.trim()) {
			return c.json({ error: "Name and slug are required" }, 400);
		}

		const slug = body.slug
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, "");
		if (!slug || slug.length < 2) {
			return c.json(
				{
					error:
						"Slug must be at least 2 characters (lowercase letters, numbers, hyphens)",
				},
				400,
			);
		}

		const existing = database
			.prepare("SELECT id FROM webhooks WHERE slug = ?")
			.get(slug);
		if (existing) {
			return c.json({ error: "A webhook with this slug already exists" }, 409);
		}

		const id = crypto.randomUUID();
		database.run(
			"INSERT INTO webhooks (id, name, slug, secret, description, event_type) VALUES (?, ?, ?, ?, ?, ?)",
			[
				id,
				body.name.trim(),
				slug,
				body.secret ?? null,
				body.description ?? "",
				body.event_type ?? "webhook:inbound",
			],
		);

		return c.json({ id, slug }, 201);
	});

	app.put("/api/webhooks/:id", async (c) => {
		const id = c.req.param("id");
		const body = await c.req.json<{
			name?: string;
			description?: string;
			active?: boolean;
			secret?: string | null;
			event_type?: string;
		}>();

		const webhook = database
			.prepare("SELECT id FROM webhooks WHERE id = ?")
			.get(id);
		if (!webhook) return c.json({ error: "Webhook not found" }, 404);

		const updates: string[] = [];
		const params: unknown[] = [];

		if (body.name !== undefined) {
			updates.push("name = ?");
			params.push(body.name);
		}
		if (body.description !== undefined) {
			updates.push("description = ?");
			params.push(body.description);
		}
		if (body.active !== undefined) {
			updates.push("active = ?");
			params.push(body.active ? 1 : 0);
		}
		if (body.secret !== undefined) {
			updates.push("secret = ?");
			params.push(body.secret);
		}
		if (body.event_type !== undefined) {
			updates.push("event_type = ?");
			params.push(body.event_type);
		}

		if (updates.length > 0) {
			updates.push("updated_at = datetime('now')");
			params.push(id);
			database.run(
				`UPDATE webhooks SET ${updates.join(", ")} WHERE id = ?`,
				params,
			);
		}

		return c.json({ ok: true });
	});

	app.delete("/api/webhooks/:id", (c) => {
		const id = c.req.param("id");
		const result = database.run("DELETE FROM webhooks WHERE id = ?", [id]);
		if (result.changes === 0)
			return c.json({ error: "Webhook not found" }, 404);
		return c.json({ deleted: true });
	});

	app.post("/api/webhooks/:id/test", (c) => {
		const id = c.req.param("id");
		const webhook = database
			.prepare("SELECT * FROM webhooks WHERE id = ?")
			.get(id) as { id: string; name: string; slug: string } | null;
		if (!webhook) return c.json({ error: "Webhook not found" }, 404);

		kernel.eventBus
			.emit("webhook:inbound", {
				webhookId: webhook.id,
				webhookName: webhook.name,
				slug: webhook.slug,
				headers: {},
				body: { test: true, timestamp: new Date().toISOString() },
				timestamp: new Date().toISOString(),
			})
			.catch(() => {});

		database.run(
			"INSERT INTO webhook_logs (webhook_id, status, body_json) VALUES (?, 'ok', ?)",
			[webhook.id, JSON.stringify({ test: true })],
		);
		database.run(
			"UPDATE webhooks SET trigger_count = trigger_count + 1, last_triggered_at = datetime('now') WHERE id = ?",
			[webhook.id],
		);

		return c.json({ ok: true });
	});

	app.get("/api/webhooks/:id/logs", (c) => {
		const id = c.req.param("id");
		const logs = database
			.prepare(
				"SELECT * FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50",
			)
			.all(id);
		return c.json({ logs });
	});

	app.get("/api/health", async (c) => {
		// Lightweight liveness check — always 200 if the web server is responding.
		// Plugin/MCP status is informational, not a gate for liveness.
		const health = await kernel.healthCheck();
		const allOk = Object.values(health).every((h) => h.ok);
		if (!c.get("authenticated")) {
			return c.json({ ok: true, healthy: allOk });
		}
		return c.json({ ok: true, healthy: allOk, checks: health });
	});

	app.get("/api/sessions", (c) => {
		const userId = getRequestUserId(c);
		if (!userId) return c.json({ error: "Unauthorized" }, 401);
		const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
		const sessions = listRecentSessionsForUser(
			kernel.database,
			userId,
			Number.isFinite(limit) ? limit : 50,
		);
		return c.json({ sessions });
	});

	app.delete("/api/sessions/:id", (c) => {
		const id = c.req.param("id");
		const userId = getRequestUserId(c);
		if (!userId) return c.json({ error: "Unauthorized" }, 401);
		const deleted = deleteSessionOwnedBy(kernel.database, id, userId);
		if (!deleted) return c.json({ error: "Session not found" }, 404);
		return c.json({ deleted: true });
	});

	app.put("/api/sessions/:id/title", async (c) => {
		const id = c.req.param("id");
		const userId = getRequestUserId(c);
		if (!userId) return c.json({ error: "Unauthorized" }, 401);
		const body = await c.req.json<{ title: string }>();
		if (!body.title?.trim()) return c.json({ error: "Title is required" }, 400);
		const updated = updateSessionTitleOwnedBy(
			kernel.database,
			id,
			body.title.trim(),
			userId,
		);
		if (!updated) return c.json({ error: "Session not found" }, 404);
		return c.json({ updated: true });
	});

	app.get("/api/sessions/:id/messages", (c) => {
		const id = c.req.param("id");
		const userId = getRequestUserId(c);
		if (!userId) return c.json({ error: "Unauthorized" }, 401);
		const session = getSessionOwnedBy(kernel.database, id, userId);
		if (!session) return c.json({ error: "Session not found" }, 404);
		// High limit: return full history (parity with the old
		// getSessionWithMessages, which had no LIMIT).
		const messages = getSessionMessages(kernel.database, id, 100_000);
		return c.json({ session, messages });
	});

	app.post("/api/sessions/:id/fork", async (c) => {
		const id = c.req.param("id");
		const userId = getRequestUserId(c);
		if (!userId) return c.json({ error: "Unauthorized" }, 401);
		const body = await c.req
			.json<{ messageId?: string }>()
			.catch(() => ({}) as { messageId?: string });
		const messageId = (body.messageId ?? "").trim();
		if (!messageId) {
			return c.json({ error: "messageId is required" }, 400);
		}
		const newId = `web-${Date.now()}-fork`;
		const result = forkSessionOwnedBy(kernel.database, id, messageId, userId, {
			newSessionId: newId,
		});
		if (!result) {
			return c.json({ error: "Source session or message not found" }, 404);
		}
		return c.json(result);
	});

	app.get("/api/sessions/:id/export", (c) => {
		const id = c.req.param("id");
		const userId = getRequestUserId(c);
		if (!userId) return c.json({ error: "Unauthorized" }, 401);
		const session = getSessionOwnedBy(kernel.database, id, userId);
		if (!session) return c.json({ error: "Session not found" }, 404);

		const rawFormat = (c.req.query("format") ?? "md").toLowerCase();
		const format: ExportFormat =
			rawFormat === "html" || rawFormat === "json"
				? (rawFormat as ExportFormat)
				: "md";

		const result = exportSession(kernel.database, id, format);
		if (!result) return c.json({ error: "Session not found" }, 404);

		return new Response(result.body, {
			headers: {
				"Content-Type": result.contentType,
				"Content-Disposition": `attachment; filename="${result.filename}"`,
				"X-Content-Type-Options": "nosniff",
			},
		});
	});

	// --- Feedback API ---

	app.post("/api/feedback", async (c) => {
		const feedbackStore = kernel.feedback;
		if (!feedbackStore) {
			return c.json({ error: "Feedback system not available" }, 400);
		}
		const body = await c.req.json<{
			messageId: string;
			sessionId: string;
			rating: "up" | "down";
			reason?: string;
		}>();
		if (!body.messageId || !body.sessionId || !body.rating) {
			return c.json(
				{ error: "messageId, sessionId, and rating required" },
				400,
			);
		}
		const id = feedbackStore.recordRating(
			body.messageId,
			body.sessionId,
			body.rating,
			body.reason,
		);
		return c.json({ id, recorded: true });
	});

	app.post("/api/chat/cancel", async (c) => {
		const body = await c.req.json<{ sessionId: string }>();
		if (!body.sessionId) {
			return c.json({ error: "sessionId required" }, 400);
		}
		const cancelled = kernel.cancelSession(body.sessionId);
		return c.json({ cancelled });
	});

	app.get("/api/usage", (c) => {
		const costTracker = kernel.costs;
		if (!costTracker) {
			return c.json({ error: "Cost tracking not available" }, 400);
		}
		const since = c.req.query("since") || undefined;
		return c.json(costTracker.getTotalCost({ since }));
	});

	app.get("/api/usage/:sessionId", (c) => {
		const costTracker = kernel.costs;
		if (!costTracker) {
			return c.json({ error: "Cost tracking not available" }, 400);
		}
		const sessionId = c.req.param("sessionId");
		return c.json(costTracker.getSessionCost(sessionId));
	});

	app.get("/api/feedback/stats", (c) => {
		const feedbackStore = kernel.feedback;
		if (!feedbackStore) {
			return c.json({ error: "Feedback system not available" }, 400);
		}
		return c.json(feedbackStore.getFeedbackStats());
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
