import { z } from "zod";

export const configSchema = z.object({
	provider: z.enum(["claude", "ollama", "openai", "gemini"]).default("claude"),
	ai: z.object({
		apiKey: z.string().default(""),
		authMethod: z.enum(["api_key", "oauth"]).default("api_key"),
		model: z.string().default("claude-sonnet-4-5-20250929"),
		maxTokens: z.number().int().positive().default(4096),
		maxToolRoundtrips: z.number().int().positive().default(50),
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
		requireApproval: z.boolean().default(false),
		pairingCodeTtlMinutes: z.number().int().positive().default(10),
		rateLimiting: z.object({
			enabled: z.boolean().default(true),
			maxRequestsPerMinute: z.number().int().positive().default(30),
		}),
		allowedUsers: z.array(z.string()).default([]),
		blockedUsers: z.array(z.string()).default([]),
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
});

export type ConfigSchema = z.infer<typeof configSchema>;
