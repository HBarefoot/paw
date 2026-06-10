import {
	mkdirSync,
	existsSync,
	readFileSync,
	writeFileSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { configSchema } from "./schema.js";

// PAW_CONFIG_DIR relocates config + credentials (e.g. onto a persistent volume
// like /data/.paw on Railway). Defaults to ~/.paw.
const CONFIG_DIR = process.env.PAW_CONFIG_DIR || join(homedir(), ".paw");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** In-memory config cache, keyed on file mtime so external edits are caught. */
let configCache: Record<string, unknown> | null = null;
let configCacheMtimeMs = -1;
const EMPTY: Record<string, unknown> = Object.freeze({});

export function getConfigOverridesPath(): string {
	return CONFIG_FILE;
}

export function readConfigOverrides(): Record<string, unknown> {
	if (!existsSync(CONFIG_FILE)) {
		configCache = null;
		configCacheMtimeMs = -1;
		return EMPTY;
	}

	let mtimeMs = 0;
	try {
		mtimeMs = statSync(CONFIG_FILE).mtimeMs;
	} catch {
		return configCache ?? EMPTY;
	}

	if (configCache && mtimeMs === configCacheMtimeMs) {
		return configCache;
	}

	try {
		configCache = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
		configCacheMtimeMs = mtimeMs;
		return configCache!;
	} catch {
		return configCache ?? EMPTY;
	}
}

export function saveConfigOverrides(overrides: Record<string, unknown>): void {
	configCache = null;
	configCacheMtimeMs = -1;
	const existing = readConfigOverrides();
	const merged = deepMergeOverrides(existing, overrides);

	// Never persist the DB path: it's a deployment/infra concern driven by
	// PAW_DB_PATH + defaults. Baking it into config.json (e.g. the default
	// "./data/paw.db") would shadow PAW_DB_PATH and send the DB off-volume on
	// Railway, wiping sessions each redeploy. Strip it (and an emptied store).
	if (merged.store && typeof merged.store === "object") {
		const store = merged.store as Record<string, unknown>;
		delete store.dbPath;
		if (Object.keys(store).length === 0) delete merged.store;
	}

	mkdirSync(CONFIG_DIR, { recursive: true });
	writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
	try {
		configCacheMtimeMs = statSync(CONFIG_FILE).mtimeMs;
	} catch {
		configCacheMtimeMs = -1;
	}
	configCache = merged;
}

function deepMergeOverrides(
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
			result[key] = deepMergeOverrides(
				tv as Record<string, unknown>,
				sv as Record<string, unknown>,
			);
		} else if (sv !== undefined) {
			result[key] = sv;
		}
	}
	return result;
}
