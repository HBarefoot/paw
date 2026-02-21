import { configSchema } from "./schema.js";
import { defaults } from "./defaults.js";
import { readConfigOverrides } from "./writer.js";
import {
	getAnthropicCredentials,
	getSlackCredentials,
	getStoredProvider,
	getOllamaConfig,
	getOpenAICredentials,
	getGeminiCredentials,
} from "../auth/credential-store.js";
import type { PawConfig } from "../types/config.js";

function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		const sv = source[key];
		const tv = target[key];
		if (
			sv !== undefined &&
			sv !== null &&
			typeof sv === "object" &&
			!Array.isArray(sv) &&
			typeof tv === "object" &&
			tv !== null
		) {
			result[key] = deepMerge(
				tv as Record<string, unknown>,
				sv as Record<string, unknown>,
			);
		} else if (sv !== undefined && sv !== "") {
			result[key] = sv;
		}
	}
	return result;
}

/** Reads from credential store + Claude CLI + env vars. */
function resolvedCredentials(): Record<string, unknown> {
	const env = process.env;
	const anthCreds = getAnthropicCredentials();
	const slackCreds = getSlackCredentials();
	const storedProvider = getStoredProvider();
	const ollamaConfig = getOllamaConfig();
	const openaiCreds = getOpenAICredentials();
	const geminiCreds = getGeminiCredentials();

	return {
		provider: env.PAW_PROVIDER ?? storedProvider,
		ai: {
			apiKey: anthCreds?.token ?? "",
			authMethod: anthCreds?.method ?? "api_key",
			model: env.PAW_AI_MODEL,
			maxTokens: env.PAW_AI_MAX_TOKENS
				? Number(env.PAW_AI_MAX_TOKENS)
				: undefined,
			maxToolRoundtrips: env.PAW_AI_MAX_ROUNDTRIPS
				? Number(env.PAW_AI_MAX_ROUNDTRIPS)
				: undefined,
		},
		ollama: {
			baseUrl: env.PAW_OLLAMA_BASE_URL ?? ollamaConfig?.baseUrl,
			model: env.PAW_OLLAMA_MODEL ?? ollamaConfig?.model,
		},
		openai: {
			apiKey: openaiCreds?.apiKey ?? "",
			model: env.PAW_OPENAI_MODEL ?? openaiCreds?.model,
			baseUrl: env.PAW_OPENAI_BASE_URL ?? openaiCreds?.baseUrl,
		},
		gemini: {
			apiKey: geminiCreds?.apiKey ?? "",
			model: env.PAW_GEMINI_MODEL ?? geminiCreds?.model,
		},
		slack: slackCreds
			? {
					botToken: slackCreds.botToken,
					appToken: slackCreds.appToken,
					signingSecret: slackCreds.signingSecret,
				}
			: undefined,
		webPilot: {
			headless:
				env.PAW_WEBPILOT_HEADLESS !== undefined
					? env.PAW_WEBPILOT_HEADLESS !== "false"
					: undefined,
			maxPages: env.PAW_WEBPILOT_MAX_PAGES
				? Number(env.PAW_WEBPILOT_MAX_PAGES)
				: undefined,
		},
		web: {
			enabled:
				env.PAW_WEB_ENABLED !== undefined
					? env.PAW_WEB_ENABLED === "true"
					: undefined,
			host: env.PAW_WEB_HOST,
			port: env.PAW_WEB_PORT ? Number(env.PAW_WEB_PORT) : undefined,
		},
		store: {
			dbPath: env.PAW_DB_PATH,
		},
		log: {
			level: env.PAW_LOG_LEVEL,
		},
	};
}

export function loadConfig(overrides?: Partial<PawConfig>): PawConfig {
	let merged = deepMerge(
		defaults as unknown as Record<string, unknown>,
		resolvedCredentials(),
	);

	// Read persisted config overrides from ~/.paw/config.json
	const fileOverrides = readConfigOverrides();
	if (Object.keys(fileOverrides).length > 0) {
		merged = deepMerge(merged, fileOverrides);
	}

	if (overrides) {
		merged = deepMerge(merged, overrides as unknown as Record<string, unknown>);
	}
	return configSchema.parse(merged);
}
