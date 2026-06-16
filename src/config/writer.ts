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
// like /data/.paw on Railway). Defaults to ~/.paw. Resolved at call time (not
// module load) so tests can redirect it to a temp dir and stay hermetic against
// a developer's real ~/.paw/config.json; in production PAW_CONFIG_DIR is fixed
// for the process, so behavior is identical.
function configDir(): string {
	return process.env.PAW_CONFIG_DIR || join(homedir(), ".paw");
}
function configFile(): string {
	return join(configDir(), "config.json");
}

/** In-memory config cache, keyed on file mtime so external edits are caught. */
let configCache: Record<string, unknown> | null = null;
let configCacheMtimeMs = -1;
const EMPTY: Record<string, unknown> = Object.freeze({});

export function getConfigOverridesPath(): string {
	return configFile();
}

export function readConfigOverrides(): Record<string, unknown> {
	const CONFIG_FILE = configFile();
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
	writeOverridesObject(merged);
}

/**
 * Replace the subtree at a dotted `path` WHOLESALE — no deep-merge against disk.
 * Unlike `saveConfigOverrides` (which unions keys and so can never remove one),
 * this lets a caller that already holds the complete desired subtree express
 * removals: e.g. `replaceConfigOverride("mcpServers", map)` persists exactly
 * `map`, dropping any server no longer present. Other top-level keys are left
 * untouched. The `store.dbPath` infra guard still applies on write.
 */
export function replaceConfigOverride(path: string, value: unknown): void {
	configCache = null;
	configCacheMtimeMs = -1;
	const next = { ...readConfigOverrides() };
	setAtPath(next, path, value);
	writeOverridesObject(next);
}

/** Remove the key at a dotted `path` and persist (wholesale; no re-merge). */
export function deleteConfigOverride(path: string): void {
	configCache = null;
	configCacheMtimeMs = -1;
	const next = { ...readConfigOverrides() };
	deleteAtPath(next, path);
	writeOverridesObject(next);
}

/** Strip the infra-only DB path, then write + refresh the cache. Shared by all writers. */
function writeOverridesObject(obj: Record<string, unknown>): void {
	// Never persist the DB path: it's a deployment/infra concern driven by
	// PAW_DB_PATH + defaults. Baking it into config.json (e.g. the default
	// "./data/paw.db") would shadow PAW_DB_PATH and send the DB off-volume on
	// Railway, wiping sessions each redeploy. Strip it (and an emptied store).
	if (obj.store && typeof obj.store === "object") {
		const store = obj.store as Record<string, unknown>;
		delete store.dbPath;
		if (Object.keys(store).length === 0) delete obj.store;
	}

	// Same infra rule for the persistent playbooks root: driven by
	// PAW_PLAYBOOKS_ROOT (applied after the file merge). Persisting it would let a
	// stale config.json push authored playbooks off the /data volume, wiping them
	// on redeploy. Strip it (and an emptied workspace).
	if (obj.workspace && typeof obj.workspace === "object") {
		const ws = obj.workspace as Record<string, unknown>;
		delete ws.playbooksRoot;
		if (Object.keys(ws).length === 0) delete obj.workspace;
	}

	const CONFIG_FILE = configFile();
	mkdirSync(configDir(), { recursive: true });
	writeFileSync(CONFIG_FILE, JSON.stringify(obj, null, 2), "utf-8");
	try {
		configCacheMtimeMs = statSync(CONFIG_FILE).mtimeMs;
	} catch {
		configCacheMtimeMs = -1;
	}
	configCache = obj;
}

function setAtPath(
	obj: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const keys = path.split(".");
	let cur = obj;
	for (let i = 0; i < keys.length - 1; i++) {
		const k = keys[i];
		if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
		cur = cur[k] as Record<string, unknown>;
	}
	cur[keys[keys.length - 1]] = value;
}

function deleteAtPath(obj: Record<string, unknown>, path: string): void {
	const keys = path.split(".");
	let cur = obj;
	for (let i = 0; i < keys.length - 1; i++) {
		const k = keys[i];
		if (typeof cur[k] !== "object" || cur[k] === null) return; // nothing to delete
		cur = cur[k] as Record<string, unknown>;
	}
	delete cur[keys[keys.length - 1]];
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
