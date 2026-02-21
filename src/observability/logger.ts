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

export function createLogger(prefix: string): Logger {
	const log = (
		level: LogLevel,
		msg: string,
		data?: Record<string, unknown>,
	) => {
		if (LEVELS[level] < LEVELS[globalLevel]) return;

		const entry = {
			ts: new Date().toISOString(),
			level,
			scope: prefix,
			msg,
			...data,
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
