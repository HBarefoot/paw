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
	getStrapiCredentials,
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

/**
 * Parse PAW_N8N_ENDPOINTS — either a JSON array `[{"name","url"}]` or a simple
 * `name=url,name2=url2` (comma/newline-separated) list.
 */
function parseN8nEndpoints(
	raw: string | undefined,
): Array<{ name: string; url: string }> {
	if (!raw || !raw.trim()) return [];
	const t = raw.trim();
	if (t.startsWith("[")) {
		try {
			const parsed = JSON.parse(t);
			if (Array.isArray(parsed)) {
				return parsed
					.filter(
						(e) => e && typeof e.name === "string" && typeof e.url === "string",
					)
					.map((e) => ({ name: e.name.trim(), url: e.url.trim() }));
			}
		} catch {
			/* fall through to pair parsing */
		}
	}
	return t
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => {
			const i = s.indexOf("=");
			return i > 0
				? { name: s.slice(0, i).trim(), url: s.slice(i + 1).trim() }
				: null;
		})
		.filter((e): e is { name: string; url: string } => !!e && !!e.url);
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
	const strapiCreds = getStrapiCredentials();

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
			apiKey: env.PAW_OLLAMA_API_KEY ?? ollamaConfig?.apiKey,
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
			port: env.PAW_WEB_PORT
				? Number(env.PAW_WEB_PORT)
				: env.PORT
					? Number(env.PORT)
					: undefined,
			// Relocate the canvas workspace (e.g. onto a persistent volume).
			canvas: env.PAW_CANVAS_ROOT ? { root: env.PAW_CANVAS_ROOT } : undefined,
		},
		// First-class n8n: configurable purely via env so it survives redeploys
		// even without a persisted config.json. PAW_N8N_TOKEN auto-enables it.
		n8n: env.PAW_N8N_TOKEN
			? {
					enabled: true,
					token: env.PAW_N8N_TOKEN,
					transport: env.PAW_N8N_TRANSPORT,
					endpoints: parseN8nEndpoints(env.PAW_N8N_ENDPOINTS),
				}
			: undefined,
		strapi: {
			url: env.PAW_STRAPI_URL ?? env.STRAPI_URL ?? strapiCreds?.url,
			token: env.PAW_STRAPI_TOKEN ?? env.STRAPI_API_TOKEN ?? strapiCreds?.token,
			// Auto-enable when a token is available
			enabled:
				!!(
					env.PAW_STRAPI_TOKEN ??
					env.STRAPI_API_TOKEN ??
					strapiCreds?.token
				) || undefined,
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
