import type { Logger } from "../types/plugin.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

let globalLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
	globalLevel = level;
}

const SECRET_KEY_PATTERN =
	/^(api[_-]?key|token|password|passwd|secret|authorization|bearer|access[_-]?token|refresh[_-]?token|signing[_-]?secret|bot[_-]?token|app[_-]?token|client[_-]?secret|private[_-]?key|credentials|cookie|session[_-]?id)$/i;

const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi;
const SK_PATTERN = /\b(sk-[a-zA-Z0-9_-]{10,})\b/g;
const XO_PATTERN = /\b(xox[abprs]-[a-zA-Z0-9-]{10,})\b/g;
// GitHub tokens: classic/fine-grained PAT (ghp_), OAuth (gho_), user-to-server
// (ghu_), server-to-server / installation (ghs_), refresh (ghr_). Installation
// tokens reaching `git push`/`gh` output must never land in logs/audit.
const GH_TOKEN_PATTERN = /\bgh[opsru]_[A-Za-z0-9_]{20,}\b/g;

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

/** Mask secret-shaped substrings (bearer/sk-/xox-/GitHub tokens) in a string.
 *  Exported so non-console sinks (tool-log, audit) can reuse the same masking. */
export function redactString(value: string): string {
	if (value.length === 0) return value;
	return value
		.replace(BEARER_PATTERN, `$1${REDACTED}`)
		.replace(SK_PATTERN, REDACTED)
		.replace(XO_PATTERN, REDACTED)
		.replace(GH_TOKEN_PATTERN, REDACTED);
}

/** Deep-redact secret-keyed fields + secret-shaped strings in an object/array.
 *  Exported for reuse by the audit logger. */
export function redact(value: unknown, depth = 0): unknown {
	if (depth > MAX_DEPTH) return REDACTED;
	if (value == null) return value;
	if (typeof value === "string") return redactString(value);
	if (typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (SECRET_KEY_PATTERN.test(k)) {
			out[k] = REDACTED;
		} else {
			out[k] = redact(v, depth + 1);
		}
	}
	return out;
}

export function createLogger(prefix: string): Logger {
	const log = (
		level: LogLevel,
		msg: string,
		data?: Record<string, unknown>,
	) => {
		if (LEVELS[level] < LEVELS[globalLevel]) return;

		const safeData = data
			? (redact(data) as Record<string, unknown>)
			: undefined;

		const entry = {
			ts: new Date().toISOString(),
			level,
			scope: prefix,
			msg: redactString(msg),
			...safeData,
		};
		const line = JSON.stringify(entry);

		if (level === "error") {
			console.error(line);
		} else if (level === "warn") {
			console.warn(line);
		} else {
			console.log(line);
		}
	};

	return {
		info: (msg, data?) => log("info", msg, data),
		warn: (msg, data?) => log("warn", msg, data),
		error: (msg, data?) => log("error", msg, data),
		debug: (msg, data?) => log("debug", msg, data),
	};
}
