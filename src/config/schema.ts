import { z } from "zod";

export const configSchema = z.object({
	provider: z.enum(["claude", "ollama", "openai", "gemini"]).default("claude"),
	ai: z.object({
		apiKey: z.string().default(""),
		authMethod: z.enum(["api_key", "oauth"]).default("api_key"),
		model: z.string().default("claude-sonnet-4-5-20250929"),
		maxTokens: z.number().int().positive().default(4096),
		maxToolRoundtrips: z.number().int().positive().default(50),
		// Anthropic prompt caching: cache the stable Claude prefix (system prompt
		// + tool definitions) so it's billed once per ~5-min window instead of every
		// turn. Default ON; a no-op for the Ollama/OpenAI/Gemini code paths.
		promptCache: z.boolean().default(true),
		// Ordered provider fallback for the main chat turn. On a TRANSIENT primary
		// error (network/timeout/5xx/quota — never user refusals or tool errors)
		// the turn is retried on the next entry in order, preserving history. Each
		// entry is its own provider+model instance built at boot (reusing that
		// provider's existing config/key). Empty ⇒ no fallback (today's behavior).
		// Aux routes (vision) keep their own dedicated degrade — an `ai.vision`-level
		// fallback list is a future extension, intentionally not built here.
		fallback: z
			.array(
				z.object({
					provider: z.enum(["claude", "ollama", "openai", "gemini"]),
					model: z.string().min(1),
				}),
			)
			.default([]),
		// Optional image-understanding route. When configured, inbound turns that
		// carry image attachments are served by this provider/model instead of the
		// (possibly text-only) default; text turns are untouched. Credentials reuse
		// the chosen provider's existing config/vault path — no new secret storage.
		// Absent ⇒ no vision routing (text-only deploys behave identically).
		vision: z
			.object({
				provider: z.enum(["claude", "ollama", "openai", "gemini"]),
				model: z.string().min(1),
				enabled: z.boolean().default(true),
			})
			.optional(),
	}),
	ollama: z.object({
		baseUrl: z.string().default("http://localhost:11434"),
		model: z.string().default("llama3.1"),
		apiKey: z.string().default(""),
		maxToolRoundtrips: z.number().int().positive().default(50),
		requestTimeoutMs: z.number().int().positive().default(300_000),
	}),
	openai: z.object({
		apiKey: z.string().default(""),
		model: z.string().default("gpt-4o"),
		maxTokens: z.number().int().positive().default(4096),
		maxToolRoundtrips: z.number().int().positive().default(50),
		baseUrl: z.string().default("https://api.openai.com/v1"),
	}),
	gemini: z.object({
		apiKey: z.string().default(""),
		model: z.string().default("gemini-2.0-flash"),
		maxTokens: z.number().int().positive().default(4096),
		maxToolRoundtrips: z.number().int().positive().default(50),
	}),
	memory: z.object({
		enabled: z.boolean().default(true),
		embeddingModel: z.string().default("Xenova/all-MiniLM-L6-v2"),
		vectorWeight: z.number().default(0.7),
		ftsWeight: z.number().default(0.3),
		autoExtract: z.boolean().default(true),
		maxRecallResults: z.number().int().positive().default(10),
		decayRate: z.number().min(0).max(1).default(0.995),
		decayThresholdDays: z.number().int().positive().default(7),
	}),
	// Approval surfaces (gated GitHub actions, future destructive ops). `ttlHours`
	// auto-expires an abandoned pending row so it can't wedge the companion's
	// "waiting" face forever.
	approvals: z
		.object({
			ttlHours: z.number().positive().default(24),
		})
		.default({}),
	// Lifecycle-hook guardrail policy (the built-in config-driven gate). Both
	// empty ⇒ inert; name tools to hard-deny or route to human approval.
	hooks: z
		.object({
			denyTools: z.array(z.string()).default([]),
			requireApprovalTools: z.array(z.string()).default([]),
		})
		.default({}),
	// OpenAI-compatible API server (B7). DISABLED unless `bearerToken` is set
	// (vault slot `api.bearerToken`). A programmatic door to the whole agent —
	// keep off until deliberately needed.
	api: z
		.object({
			bearerToken: z.string().default(""),
		})
		.default({}),
	cron: z.object({
		enabled: z.boolean().default(true),
		tickIntervalMs: z.number().int().positive().default(60_000),
	}),
	heartbeat: z.object({
		enabled: z.boolean().default(true),
		intervalMinutes: z.number().int().positive().default(30),
		triggerAiOnFailure: z.boolean().default(true),
		workspacePath: z.string().default("."),
	}),
	security: z.object({
		enforcePermissions: z.boolean().default(true),
		// DEPRECATED: no longer gates anything. External channels (e.g. Slack) are
		// always access-controlled now; openness is governed solely by the explicit
		// default-OFF `allowUnapprovedExternal` below. Kept for config back-compat.
		requireApproval: z.boolean().default(false),
		// DANGER, default OFF. When true, unrecognized users on EXTERNAL channels
		// (Slack) can command the agent with no approval. This is the ONLY way to
		// run open — the absence of config fails CLOSED, never open.
		allowUnapprovedExternal: z.boolean().default(false),
		pairingCodeTtlMinutes: z.number().int().positive().default(10),
		rateLimiting: z.object({
			enabled: z.boolean().default(true),
			maxRequestsPerMinute: z.number().int().positive().default(30),
		}),
		allowedUsers: z.array(z.string()).default([]),
		blockedUsers: z.array(z.string()).default([]),
		// Operator/owner identities (e.g. the owner's Slack user id) that are
		// always approved — never pairing-gated in their own workspace. Lives in
		// `security` (not `slack`) because the exemption is channel-agnostic: the
		// id itself is the qualifier, and any future channel inherits it.
		ownerUserIds: z.array(z.string()).default([]),
		// DANGER, default EMPTY. Trusts EVERY message a given Slack app relays into
		// the named channel, REGARDLESS of the human behind it — so only ever name
		// an owner-only DM/channel. Exists for the "Sent using @Claude" relay case
		// where Slack carries no recoverable human id, only a shared app id. Empty =
		// no trust (the app sender stays pairing-gated, observable in /access). Do
		// NOT add an entry unless you accept that anyone who can post through that
		// app into that channel can command the agent.
		trustedRelayApps: z
			.array(z.object({ appId: z.string(), channel: z.string() }))
			.default([]),
	}),
	web: z.object({
		enabled: z.boolean().default(false),
		host: z.string().default("127.0.0.1"),
		port: z.number().int().positive().default(3000),
		authToken: z.string().optional(),
		username: z.string().default("admin"),
		password: z.string().default(""),
		tls: z
			.object({
				enabled: z.boolean().default(false),
				certFile: z.string().default(""),
				keyFile: z.string().default(""),
			})
			.default({}),
		session: z
			.object({
				maxAgeMinutes: z.number().int().positive().default(480),
				idleTimeoutMinutes: z.number().int().positive().default(60),
			})
			.default({}),
		canvas: z
			.object({
				enabled: z.boolean().default(true),
				root: z.string().default("./data/canvas"),
			})
			.default({}),
		trustedProxy: z.boolean().default(false),
	}),
	workspace: z.object({
		path: z.string().default("."),
		maxFileSize: z.number().int().positive().default(1_048_576),
		maxOutputLength: z.number().int().positive().default(10_000),
		execTimeout: z.number().int().positive().default(30_000),
		allowedCommands: z.array(z.string()).optional(),
		// Persistent root for runtime-authored playbooks. Unset = co-locate with
		// the bundled `<workspace.path>/playbooks` dir (dev/local). On Railway set
		// PAW_PLAYBOOKS_ROOT=/data/playbooks so authored playbooks survive
		// redeploys. Infra-path concern: applied AFTER file config and NEVER
		// persisted by the writer (mirrors store.dbPath).
		playbooksRoot: z.string().optional(),
	}),
	slack: z.object({
		botToken: z.string().default(""),
		appToken: z.string().default(""),
		signingSecret: z.string().default(""),
		// Channel (id or #name) for proactive agent notifications. Empty = off.
		// The bot must be a member of the channel.
		notifyChannel: z.string().default(""),
	}),
	webPilot: z.object({
		headless: z.boolean().default(true),
		maxPages: z.number().int().positive().default(3),
		defaultTimeout: z.number().int().positive().default(30_000),
	}),
	// Companion (avatar) preferences. `avatar` is the deployment/brand DEFAULT
	// face key (e.g. "gel" | "robot-halo"); a per-user localStorage["paw-avatar"]
	// choice overrides it client-side.
	companion: z
		.object({
			avatar: z.string().optional(),
		})
		.default({}),
	agent: z
		.object({
			name: z.string().default("Paw"),
			systemPrompt: z.string().default(""),
		})
		.default({}),
	routing: z
		.object({
			enabled: z.boolean().default(false),
			rules: z
				.array(
					z.object({
						match: z.object({
							taskType: z
								.enum([
									"classification",
									"extraction",
									"summarization",
									"reasoning",
									"coding",
									"general",
								])
								.optional(),
							skillName: z.string().optional(),
							agentName: z.string().optional(),
						}),
						provider: z.enum(["claude", "ollama", "openai", "gemini"]),
						model: z.string().optional(),
					}),
				)
				.default([]),
		})
		.default({}),
	store: z.object({
		dbPath: z.string().default("./data/paw.db"),
		customSqlitePath: z.string().optional(),
		messageHistoryLimit: z.number().int().positive().default(20),
	}),
	log: z.object({
		level: z.enum(["debug", "info", "warn", "error"]).default("info"),
	}),
	agents: z
		.record(
			z.string(),
			z.object({
				description: z.string(),
				systemPrompt: z.string(),
				skills: z.array(z.string()).default([]),
				provider: z.enum(["claude", "ollama", "openai", "gemini"]).optional(),
				maxRoundtrips: z.number().int().positive().optional(),
				memoryScope: z.string().optional(),
			}),
		)
		.default({}),
	skills: z
		.record(
			z.string(),
			z.object({
				description: z.string().optional(),
				alwaysActive: z.boolean().optional(),
				disabledTools: z.array(z.string()).optional(),
			}),
		)
		.default({}),
	strapi: z
		.object({
			enabled: z.boolean().default(false),
			url: z.string().default(""),
			token: z.string().default(""),
			timeout: z.number().int().positive().default(10_000),
		})
		.default({}),
	hubspot: z
		.object({
			enabled: z.boolean().default(false),
			// Private-app access token. Sent as Authorization: Bearer.
			token: z.string().default(""),
			timeout: z.number().int().positive().default(10_000),
		})
		.default({}),
	mcpServers: z
		.record(
			z.string(),
			z.object({
				command: z.string().optional(),
				args: z.array(z.string()).default([]),
				env: z.record(z.string()).optional(),
				url: z.string().optional(),
				transport: z.enum(["stdio", "sse", "http"]).default("stdio"),
				// Auth for remote (sse/http) servers.
				authToken: z.string().optional(), // sent as Authorization: Bearer
				headers: z.record(z.string()).optional(), // extra request headers
			}),
		)
		.default({}),
	n8n: z
		.object({
			enabled: z.boolean().default(false),
			// Shared bearer token sent to every n8n MCP endpoint.
			token: z.string().default(""),
			transport: z.enum(["sse", "http"]).default("sse"),
			endpoints: z
				.array(z.object({ name: z.string(), url: z.string() }))
				.default([]),
		})
		.default({}),
	github: z
		.object({
			enabled: z.boolean().default(false),
			// GitHub App ID (numeric, kept as string).
			appId: z.string().default(""),
			// Installation ID the App is installed under.
			installationId: z.string().default(""),
			// PEM private key — overlaid from vault slot `github.appPrivateKey`.
			privateKey: z.string().default(""),
			// Webhook signing secret — overlaid from vault slot `github.webhookSecret`.
			webhookSecret: z.string().default(""),
			baseUrl: z.string().default("https://api.github.com"),
			// Allowlist of `owner/repo` the agent may touch. Empty = none allowed.
			repoAllowlist: z.array(z.string()).default([]),
			// Fallback fine-grained PAT for the git/gh workspace tools — overlaid
			// from vault slot `github.token`. Prefer the auto-rotating App token.
			token: z.string().default(""),
			// Branches git/gh may never push to directly; merges to them are
			// approval-gated. Defaults to ["main"] (Railway auto-deploys main).
			protectedBranches: z.array(z.string()).default(["main"]),
			// When CI fails on a PR, automatically run an agent turn that reads the
			// logs and posts a diagnosis comment (never commits/merges).
			autoInvestigateCi: z.boolean().default(true),
		})
		.default({}),
	supabase: z
		.object({
			enabled: z.boolean().default(false),
			// Project REST URL, e.g. https://<ref>.supabase.co
			url: z.string().default(""),
			// Service-role key — overlaid from vault slot `supabase.serviceKey`.
			serviceKey: z.string().default(""),
			// Postgres DSN for the scoped `paw_builder` role (USAGE+CREATE on
			// schema `canvas` only). Used ONLY by the typed provisioning DDL tools,
			// never the CRUD path. Overlaid from vault slot `supabase.builderDsn`.
			// See src/integrations/supabase/migrations/README.md.
			builderDsn: z.string().default(""),
			timeout: z.number().int().positive().default(10_000),
		})
		.default({}),
	wordpress: z
		.object({
			enabled: z.boolean().default(false),
			// Site URL, e.g. https://example.com
			url: z.string().default(""),
			username: z.string().default(""),
			// Application Password — overlaid from vault slot `wordpress.appPassword`.
			appPassword: z.string().default(""),
			timeout: z.number().int().positive().default(10_000),
		})
		.default({}),
	vercel: z
		.object({
			enabled: z.boolean().default(false),
			// API token — overlaid from vault slot `vercel.token`. Server-side only;
			// never exposed to the model.
			token: z.string().default(""),
			// Optional team scope (sent as `?teamId=` on every request).
			teamId: z.string().default(""),
			baseUrl: z.string().default("https://api.vercel.com"),
			timeout: z.number().int().positive().default(15_000),
		})
		.default({}),
	posthog: z
		.object({
			enabled: z.boolean().default(false),
			// PUBLIC project key embedded in the page snippet — safe to expose.
			projectApiKey: z.string().default(""),
			// PRIVATE personal key for the read API — overlaid from vault slot
			// `posthog.personalApiKey`. Server-side only; never reaches the model.
			personalApiKey: z.string().default(""),
			// Numeric project id for the Query API (PostHog project settings).
			// `coerce` so the /settings form's all-digits→number coercion round-trips
			// back to a string instead of failing this schema at boot.
			projectId: z.coerce.string().default(""),
			// Ingestion/app host: https://us.i.posthog.com (or eu, or self-hosted).
			host: z.string().default("https://us.i.posthog.com"),
			timeout: z.number().int().positive().default(15_000),
		})
		.default({}),
});

export type ConfigSchema = z.infer<typeof configSchema>;
