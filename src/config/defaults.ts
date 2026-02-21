import type { PawConfig } from "../types/config.js";

export const defaults: PawConfig = {
	provider: "claude",
	ai: {
		apiKey: "",
		authMethod: "api_key",
		model: "claude-sonnet-4-5-20250929",
		maxTokens: 4096,
		maxToolRoundtrips: 10,
	},
	ollama: {
		baseUrl: "http://localhost:11434",
		model: "llama3.1",
		maxToolRoundtrips: 10,
		requestTimeoutMs: 300_000,
	},
	openai: {
		apiKey: "",
		model: "gpt-4o",
		maxTokens: 4096,
		maxToolRoundtrips: 10,
		baseUrl: "https://api.openai.com/v1",
	},
	gemini: {
		apiKey: "",
		model: "gemini-2.0-flash",
		maxTokens: 4096,
		maxToolRoundtrips: 10,
	},
	memory: {
		enabled: true,
		embeddingModel: "Xenova/all-MiniLM-L6-v2",
		vectorWeight: 0.7,
		ftsWeight: 0.3,
		autoExtract: true,
		maxRecallResults: 10,
	},
	cron: {
		enabled: true,
		tickIntervalMs: 60_000,
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
		pairingCodeTtlMinutes: 10,
		rateLimiting: {
			enabled: true,
			maxRequestsPerMinute: 30,
		},
		allowedUsers: [],
		blockedUsers: [],
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
	store: {
		dbPath: "./data/paw.db",
		messageHistoryLimit: 20,
	},
	log: {
		level: "info",
	},
	mcpServers: {},
};
