import type { PawConfig } from "../types/config.js";

export const defaults: PawConfig = {
	provider: "claude",
	ai: {
		apiKey: "",
		authMethod: "api_key",
		model: "claude-sonnet-4-5-20250929",
		maxTokens: 4096,
		maxToolRoundtrips: 50,
		promptCache: true,
		fallback: [],
	},
	ollama: {
		baseUrl: "http://localhost:11434",
		model: "llama3.1",
		apiKey: "",
		maxToolRoundtrips: 50,
		requestTimeoutMs: 300_000,
	},
	openai: {
		apiKey: "",
		model: "gpt-4o",
		maxTokens: 4096,
		maxToolRoundtrips: 50,
		baseUrl: "https://api.openai.com/v1",
	},
	gemini: {
		apiKey: "",
		model: "gemini-2.0-flash",
		maxTokens: 4096,
		maxToolRoundtrips: 50,
	},
	memory: {
		enabled: true,
		embeddingModel: "Xenova/all-MiniLM-L6-v2",
		vectorWeight: 0.7,
		ftsWeight: 0.3,
		autoExtract: true,
		maxRecallResults: 10,
		decayRate: 0.995,
		decayThresholdDays: 7,
	},
	approvals: {
		ttlHours: 24,
	},
	hooks: {
		denyTools: [],
		requireApprovalTools: [],
	},
	api: {
		bearerToken: "",
	},
	cron: {
		enabled: true,
		tickIntervalMs: 60_000,
	},
	tasks: {
		enabled: true,
		escalationIntervalMs: 300_000,
		escalationDedupeHours: 6,
	},
	heartbeat: {
		enabled: true,
		intervalMinutes: 30,
		triggerAiOnFailure: true,
		workspacePath: ".",
	},
	security: {
		enforcePermissions: true,
		requireApproval: false,
		allowUnapprovedExternal: false,
		pairingCodeTtlMinutes: 10,
		rateLimiting: {
			enabled: true,
			maxRequestsPerMinute: 30,
		},
		allowedUsers: [],
		blockedUsers: [],
		ownerUserIds: [],
		trustedRelayApps: [],
	},
	web: {
		enabled: false,
		host: "127.0.0.1",
		port: 3000,
		username: "admin",
		password: "",
		tls: {
			enabled: false,
			certFile: "",
			keyFile: "",
		},
		session: {
			maxAgeMinutes: 480,
			idleTimeoutMinutes: 60,
		},
		canvas: {
			enabled: true,
			root: "./data/canvas",
		},
	},
	workspace: {
		path: ".",
		maxFileSize: 1_048_576,
		maxOutputLength: 10_000,
		execTimeout: 30_000,
	},
	slack: {
		botToken: "",
		appToken: "",
		signingSecret: "",
		notifyChannel: "",
	},
	webPilot: {
		headless: true,
		maxPages: 3,
		defaultTimeout: 30_000,
	},
	agent: {
		name: "Paw",
		systemPrompt: "",
	},
	routing: {
		enabled: false,
		rules: [],
	},
	store: {
		dbPath: "./data/paw.db",
		messageHistoryLimit: 20,
		messagePruneKeepLast: 500,
	},
	log: {
		level: "info",
	},
	strapi: {
		enabled: false,
		url: "",
		token: "",
		timeout: 10_000,
	},
	hubspot: {
		enabled: false,
		token: "",
		timeout: 10_000,
	},
	// No seeded agent presets — the agent list is controlled entirely by the
	// user's config (~/.paw/config.json) and the Config UI. (Previously this
	// seeded an "icp-discovery" preset, but deepMerge never removes keys so it
	// could not be deleted from the UI; see src/config/loader.ts deepMerge.)
	agents: {},
	mcpServers: {},
	n8n: {
		enabled: false,
		token: "",
		transport: "sse",
		endpoints: [],
	},
	github: {
		enabled: false,
		appId: "",
		installationId: "",
		privateKey: "",
		webhookSecret: "",
		baseUrl: "https://api.github.com",
		repoAllowlist: [],
		token: "",
		protectedBranches: ["main"],
		autoInvestigateCi: true,
	},
	supabase: {
		enabled: false,
		url: "",
		serviceKey: "",
		builderDsn: "",
		timeout: 10_000,
	},
	wordpress: {
		enabled: false,
		url: "",
		username: "",
		appPassword: "",
		timeout: 10_000,
	},
	vercel: {
		enabled: false,
		token: "",
		teamId: "",
		baseUrl: "https://api.vercel.com",
		timeout: 15_000,
	},
	posthog: {
		enabled: false,
		projectApiKey: "",
		personalApiKey: "",
		projectId: "",
		host: "https://us.i.posthog.com",
		timeout: 15_000,
	},
};
