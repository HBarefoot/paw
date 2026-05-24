/**
 * URL and filesystem path guards to prevent SSRF and path-traversal
 * when fetching data from AI-controllable sources (proactive triggers,
 * MCP HTTP servers, etc.).
 */

import { existsSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";

// Private, loopback, link-local, multicast, and cloud metadata ranges.
const PRIVATE_IP_PATTERNS: RegExp[] = [
	/^127\./,
	/^10\./,
	/^172\.(1[6-9]|2\d|3[0-1])\./,
	/^192\.168\./,
	/^169\.254\./, // AWS/GCP/Azure metadata + link-local
	/^0\./,
	/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
	/^localhost$/i,
	/^\[?::1\]?$/,
	/^\[?::\]?$/,
	/^\[?fc[0-9a-f]{2}:/i,
	/^\[?fd[0-9a-f]{2}:/i,
	/^\[?fe80:/i,
	/^\[?::ffff:/i,
];

export function isPrivateHost(hostname: string): boolean {
	if (!hostname) return true;
	const h = hostname.replace(/^\[|\]$/g, "");
	return PRIVATE_IP_PATTERNS.some((p) => p.test(h));
}

export interface UrlGuardOptions {
	/** Schemes permitted for outbound fetch. Default: http, https. */
	allowedSchemes?: string[];
	/** Bypass the private-host block. Default: false. */
	allowPrivate?: boolean;
}

export interface UrlGuardResult {
	ok: boolean;
	url?: URL;
	reason?: string;
}

/**
 * Validate an AI-controllable URL before fetch. Returns `ok: false` with
 * a human-readable reason when the URL must not be fetched.
 */
export function validateExternalUrl(
	raw: string,
	opts?: UrlGuardOptions,
): UrlGuardResult {
	const allowedSchemes = opts?.allowedSchemes ?? ["http:", "https:"];
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, reason: "Malformed URL" };
	}

	if (!allowedSchemes.includes(url.protocol)) {
		return {
			ok: false,
			reason: `Scheme not allowed: ${url.protocol}. Allowed: ${allowedSchemes.join(", ")}`,
		};
	}

	if (url.username || url.password) {
		return { ok: false, reason: "URLs with embedded credentials are not allowed" };
	}

	if (!opts?.allowPrivate && isPrivateHost(url.hostname)) {
		return {
			ok: false,
			reason: `Host is private/internal/loopback: ${url.hostname}`,
		};
	}

	return { ok: true, url };
}

export interface SafePathResult {
	ok: boolean;
	path?: string;
	reason?: string;
}

/**
 * Resolve a user/AI-supplied path relative to a workspace root, and
 * reject anything that escapes the workspace (including via symlinks
 * or NUL injection).
 */
export function safeWorkspacePath(
	path: string,
	workspace: string,
): SafePathResult {
	if (!path) return { ok: false, reason: "Empty path" };
	if (path.includes("\0")) return { ok: false, reason: "Null byte in path" };

	const root = resolve(workspace);
	const resolved = resolve(root, path);
	const rel = relative(root, resolved);
	if (rel.startsWith("..") || rel === "") {
		return { ok: false, reason: "Path is outside workspace" };
	}

	if (existsSync(resolved)) {
		try {
			const real = realpathSync(resolved);
			const realRel = relative(root, real);
			if (realRel.startsWith("..")) {
				return { ok: false, reason: "Symlink escapes workspace" };
			}
			return { ok: true, path: real };
		} catch {
			return { ok: false, reason: "Unable to resolve real path" };
		}
	}

	return { ok: true, path: resolved };
}
