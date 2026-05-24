import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AIProvider, ChatMessage } from "../ai/base-provider.js";
import type { Logger } from "../types/plugin.js";
import {
	safeWorkspacePath,
	validateExternalUrl,
} from "../security/url-guard.js";

export interface ProactiveEvalResult {
	shouldAct: boolean;
	reason: string;
	dataChanged: boolean;
}

/** Maximum bytes to read from a data source before truncating. */
const MAX_SOURCE_BYTES = 256 * 1024; // 256 KiB

/**
 * Evaluate whether a proactive trigger should fire.
 * Fetches data from the source, checks if it changed,
 * and optionally asks the AI if action is warranted.
 */
export async function evaluateProactiveTrigger(opts: {
	condition: string;
	dataSource?: string;
	lastDataHash?: string | null;
	provider: AIProvider;
	logger: Logger;
	workspacePath: string;
}): Promise<ProactiveEvalResult & { newHash?: string }> {
	const { condition, dataSource, lastDataHash, provider, logger, workspacePath } = opts;

	// Step 1: Fetch data from source (if provided)
	let data: string | null = null;
	let newHash: string | undefined;

	if (dataSource) {
		try {
			data = await fetchDataSource(dataSource, workspacePath);
			newHash = hashData(data);

			// If hash hasn't changed, no need to evaluate
			if (lastDataHash && newHash === lastDataHash) {
				return {
					shouldAct: false,
					reason: "Data unchanged since last check",
					dataChanged: false,
					newHash,
				};
			}
		} catch (err) {
			logger.warn("Proactive trigger: failed to fetch data source", {
				dataSource,
				error: String(err),
			});
			return {
				shouldAct: false,
				reason: `Failed to fetch data source: ${String(err)}`,
				dataChanged: false,
			};
		}
	}

	// Step 2: Ask the AI whether to act
	const evalPrompt = buildEvalPrompt(condition, data);
	try {
		const messages: ChatMessage[] = [{ role: "user", content: evalPrompt }];
		const response = await provider.chat(
			messages,
			"You evaluate conditions and respond with YES or NO followed by a brief reason. Be concise.",
		);

		const text = response.text.trim();
		const shouldAct = /^yes\b/i.test(text);
		const reason = text.replace(/^(yes|no)[:\s]*/i, "").trim() || text;

		return {
			shouldAct,
			reason,
			dataChanged: newHash !== lastDataHash,
			newHash,
		};
	} catch (err) {
		logger.warn("Proactive trigger: AI evaluation failed", {
			error: String(err),
		});
		return {
			shouldAct: false,
			reason: `AI evaluation failed: ${String(err)}`,
			dataChanged: false,
			newHash,
		};
	}
}

async function fetchDataSource(
	source: string,
	workspacePath: string,
): Promise<string> {
	// URL source — validate scheme and block private/loopback/metadata hosts.
	if (/^https?:\/\//i.test(source)) {
		const check = validateExternalUrl(source);
		if (!check.ok || !check.url) {
			throw new Error(`Blocked URL: ${check.reason}`);
		}
		const response = await fetch(check.url, {
			signal: AbortSignal.timeout(15_000),
			redirect: "error",
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		return truncate(await response.text());
	}

	// file:// URLs are converted to a plain workspace-relative path.
	const raw = source.startsWith("file://")
		? source.slice("file://".length)
		: source;

	const safe = safeWorkspacePath(raw, workspacePath);
	if (!safe.ok || !safe.path) {
		throw new Error(`Blocked file source: ${safe.reason ?? "invalid path"}`);
	}
	return truncate(readFileSync(safe.path, "utf-8"));
}

function truncate(data: string): string {
	if (data.length <= MAX_SOURCE_BYTES) return data;
	return data.slice(0, MAX_SOURCE_BYTES) + "\n...(truncated by size limit)";
}

function hashData(data: string): string {
	return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function buildEvalPrompt(condition: string, data: string | null): string {
	let prompt = `Evaluate the following condition and decide if action should be taken.\n\nCondition: ${condition}`;
	if (data) {
		// Truncate data to avoid token overflow
		const truncated =
			data.length > 5000 ? data.slice(0, 5000) + "\n...(truncated)" : data;
		prompt += `\n\nCurrent data:\n${truncated}`;
	}
	prompt +=
		"\n\nRespond with YES or NO followed by a brief reason. Example: YES: The price dropped below the threshold.";
	return prompt;
}
