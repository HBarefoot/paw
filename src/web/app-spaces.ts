// "App spaces" turn the canvas workspace into a host for real applications
// (e.g. an operations console) without bending the public `/api/canvas/preview`
// sketch surface into a production host. App files live under a reserved
// `apps/<space>/` namespace inside the canvas root and are written with the
// SAME canvas tools (canvas_write/read/...). What differs is the SERVING +
// SECURITY posture: app spaces are authed by default, get a tight per-space
// CSP, and are excluded from the canvas-wide clear/template wipe.
//
// This is plain server-side TypeScript (NOT a served-to-browser inline script),
// so regex literals here are fine — the template-literal backslash trap only
// applies to scripts shipped inside template literals (see canvas-serve.ts).

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { relative, resolve } from "node:path";

/** Reserved top-level folder under the canvas root that holds app spaces. */
export const APP_NAMESPACE = "apps";

export interface AppSpaceManifest {
	/**
	 * Reserved for a future "publish this space" capability. v1 always serves
	 * app spaces behind session auth regardless of this value — see the
	 * `/api/app/:space/*` route. Defaults to "auth" (private).
	 */
	visibility: "auth" | "public";
	/** When true (default), the canvas-wide clear/template wipe skips this space. */
	protected: boolean;
	/** Optional CSP directive overrides merged over the strict app base. */
	csp?: Record<string, string>;
}

const DEFAULT_MANIFEST: AppSpaceManifest = {
	visibility: "auth",
	protected: true,
};

/** Space names are a single safe path segment: letters, digits, dash, underscore. */
export function isValidSpaceName(space: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(space);
}

/**
 * Read `apps/<space>/.app.json`, falling back to safe private defaults
 * (authed + protected) on any missing/invalid manifest. Best-effort: never
 * throws.
 */
export function readAppManifest(
	canvasRoot: string,
	space: string,
): AppSpaceManifest {
	if (!isValidSpaceName(space)) return { ...DEFAULT_MANIFEST };
	const appsRoot = resolve(canvasRoot, APP_NAMESPACE);
	const file = resolve(appsRoot, space, ".app.json");
	// Containment guard (defense in depth; isValidSpaceName already blocks `..`).
	if (relative(appsRoot, file).startsWith("..")) return { ...DEFAULT_MANIFEST };
	try {
		const parsed = JSON.parse(
			readFileSync(file, "utf-8"),
		) as Partial<AppSpaceManifest>;
		return {
			visibility: parsed.visibility === "public" ? "public" : "auth",
			protected: parsed.protected !== false, // default true
			csp:
				parsed.csp &&
				typeof parsed.csp === "object" &&
				!Array.isArray(parsed.csp)
					? parsed.csp
					: undefined,
		};
	} catch {
		return { ...DEFAULT_MANIFEST };
	}
}

/** Extract the `<space>` segment from an `/api/app/<space>/...` path, or null. */
export function spaceFromAppPath(path: string): string | null {
	const m = /^\/api\/app\/([^/]+)/.exec(path);
	if (!m) return null;
	let space: string;
	try {
		space = decodeURIComponent(m[1]);
	} catch {
		return null;
	}
	return isValidSpaceName(space) ? space : null;
}

/**
 * Is this canvas-root-relative path inside a *protected* app space? Used to
 * shield app spaces from the canvas-wide clear/template wipe.
 */
export function isProtectedAppPath(
	canvasRoot: string,
	relPath: string,
): boolean {
	const parts = relPath.split(/[/\\]+/).filter(Boolean);
	if (parts[0] !== APP_NAMESPACE || parts.length < 2) return false;
	const space = parts[1];
	if (!isValidSpaceName(space)) return false;
	return readAppManifest(canvasRoot, space).protected;
}

/**
 * Wipe the canvas root but PRESERVE protected app spaces (`apps/<space>` whose
 * manifest has protected:true). A production app console living in the canvas
 * must survive a "clear canvas" / "apply template" click; removing an app space
 * is an explicit, targeted op (canvas_delete on its folder).
 */
export function clearCanvasPreservingApps(canvasRoot: string): void {
	if (!existsSync(canvasRoot)) {
		mkdirSync(canvasRoot, { recursive: true });
		return;
	}
	for (const entry of readdirSync(canvasRoot)) {
		if (entry === APP_NAMESPACE) {
			const appsDir = resolve(canvasRoot, APP_NAMESPACE);
			for (const space of readdirSync(appsDir)) {
				if (!isProtectedAppPath(canvasRoot, `${APP_NAMESPACE}/${space}`)) {
					rmSync(resolve(appsDir, space), { recursive: true, force: true });
				}
			}
		} else {
			rmSync(resolve(canvasRoot, entry), { recursive: true, force: true });
		}
	}
	mkdirSync(canvasRoot, { recursive: true });
}

/** List the app spaces (top-level folders under `apps/`) in the canvas root. */
export function listAppSpaces(canvasRoot: string): string[] {
	const appsRoot = resolve(canvasRoot, APP_NAMESPACE);
	if (!existsSync(appsRoot)) return [];
	try {
		return readdirSync(appsRoot)
			.filter((name) => {
				if (!isValidSpaceName(name)) return false;
				try {
					return statSync(resolve(appsRoot, name)).isDirectory();
				} catch {
					return false;
				}
			})
			.sort();
	} catch {
		return [];
	}
}

// Strict baseline CSP for app pages. Unlike the permissive preview CSP, this
// drops 'unsafe-eval' (app pages ship PRECOMPILED JS — no in-browser Babel) and
// the `img-src *` wildcard. 'unsafe-inline' stays because the injected runtime
// shim is an inline <script>. Same-origin only otherwise; data files + forms
// are same-origin fetches covered by connect-src 'self'.
const STRICT_APP_CSP: Record<string, string> = {
	"default-src": "'self'",
	"script-src": "'self' 'unsafe-inline'",
	"style-src": "'self' 'unsafe-inline'",
	"img-src": "'self' data: blob:",
	"font-src": "'self' data:",
	"connect-src": "'self'",
	"frame-ancestors": "'self'",
	"base-uri": "'self'",
	"form-action": "'self'",
};

/**
 * Build the app-space CSP string, merging optional per-space manifest overrides
 * over the strict baseline. Override values are length-capped to avoid a
 * malformed manifest blowing out the header.
 */
export function buildAppCsp(override?: Record<string, string>): string {
	const merged: Record<string, string> = { ...STRICT_APP_CSP };
	if (override) {
		for (const [k, v] of Object.entries(override)) {
			if (typeof v === "string" && v.length > 0 && v.length < 500) {
				merged[k.toLowerCase()] = v;
			}
		}
	}
	return `${Object.entries(merged)
		.map(([k, v]) => `${k} ${v}`)
		.join("; ")};`;
}
