export interface PawConfig {
	provider: "claude" | "ollama" | "openai" | "gemini";
	ai: {
		apiKey: string;
		authMethod: "api_key" | "oauth";
		model: string;
		maxTokens: number;
		maxToolRoundtrips: number;
		/** Optional image-understanding route (mirrors the Zod schema). When set,
		 * image-bearing turns are served by this provider/model. */
		vision?: {
			provider: "claude" | "ollama" | "openai" | "gemini";
			model: string;
			enabled: boolean;
		};
	};
	ollama: {
		baseUrl: string;
		model: string;
		apiKey: string;
		maxToolRoundtrips: number;
		requestTimeoutMs: number;
	};
	openai: {
		apiKey: string;
		model: string;
		maxTokens: number;
		maxToolRoundtrips: number;
		baseUrl: string;
	};
	gemini: {
		apiKey: string;
		model: string;
		maxTokens: number;
		maxToolRoundtrips: number;
	};
	memory: {
		enabled: boolean;
		embeddingModel: string;
		vectorWeight: number;
		ftsWeight: number;
		autoExtract: boolean;
		maxRecallResults: number;
		decayRate: number;
		decayThresholdDays: number;
	};
	cron: {
		enabled: boolean;
		tickIntervalMs: number;
	};
	heartbeat: {
		enabled: boolean;
		intervalMinutes: number;
		triggerAiOnFailure: boolean;
		workspacePath: string;
	};
	security: {
		enforcePermissions: boolean;
		requireApproval: boolean;
		pairingCodeTtlMinutes: number;
		rateLimiting: {
			enabled: boolean;
			maxRequestsPerMinute: number;
		};
		allowedUsers: string[];
		blockedUsers: string[];
	};
	web: {
		enabled: boolean;
		host: string;
		port: number;
		authToken?: string;
		username: string;
		password: string;
		tls: {
			enabled: boolean;
			certFile: string;
			keyFile: string;
		};
		session: {
			maxAgeMinutes: number;
			idleTimeoutMinutes: number;
		};
		canvas: {
			enabled: boolean;
			root: string;
		};
		trustedProxy: boolean;
	};
	workspace: {
		path: string;
		maxFileSize: number;
		maxOutputLength: number;
		execTimeout: number;
		allowedCommands?: string[];
	};
	slack: {
		botToken: string;
		appToken: string;
		signingSecret: string;
		notifyChannel: string;
	};
	webPilot: {
		headless: boolean;
		maxPages: number;
		defaultTimeout: number;
	};
	agent: {
		name: string;
		systemPrompt: string;
	};
	routing: {
		enabled: boolean;
		rules: Array<{
			match: {
				taskType?:
					| "classification"
					| "extraction"
					| "summarization"
					| "reasoning"
					| "coding"
					| "general";
				skillName?: string;
				agentName?: string;
			};
			provider: "claude" | "ollama" | "openai" | "gemini";
			model?: string;
		}>;
	};
	store: {
		dbPath: string;
		customSqlitePath?: string;
		messageHistoryLimit: number;
	};
	log: {
		level: "debug" | "info" | "warn" | "error";
	};
	agents: Record<
		string,
		{
			description: string;
			systemPrompt: string;
			skills: string[];
			provider?: "claude" | "ollama" | "openai" | "gemini";
			maxRoundtrips?: number;
			memoryScope?: string;
		}
	>;
	strapi: {
		enabled: boolean;
		url: string;
		token: string;
		timeout: number;
	};
	hubspot: {
		enabled: boolean;
		token: string;
		timeout: number;
	};
	mcpServers: Record<
		string,
		{
			command?: string;
			args?: string[];
			env?: Record<string, string>;
			url?: string;
			transport?: "stdio" | "sse" | "http";
			authToken?: string;
			headers?: Record<string, string>;
		}
	>;
	n8n: {
		enabled: boolean;
		token: string;
		transport: "sse" | "http";
		endpoints: Array<{ name: string; url: string }>;
	};
	github: {
		enabled: boolean;
		appId: string;
		installationId: string;
		privateKey: string;
		webhookSecret: string;
		baseUrl: string;
		repoAllowlist: string[];
		autoInvestigateCi: boolean;
	};
	supabase: {
		enabled: boolean;
		url: string;
		serviceKey: string;
		timeout: number;
	};
	wordpress: {
		enabled: boolean;
		url: string;
		username: string;
		appPassword: string;
		timeout: number;
	};
}
