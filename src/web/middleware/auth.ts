import type { MiddlewareHandler, Context } from "hono";
import { getCookie } from "hono/cookie";
import type { WebAuthManager } from "../../security/web-auth.js";

const PUBLIC_ROUTES = new Set([
	"/login",
	"/login/setup",
	"/login/totp-setup",
	"/api/health",
	"/paw-logo.jpg",
	"/favicon.png",
	"/favicon.ico",
]);
const PUBLIC_PREFIXES = [
	"/api/canvas/events",
	"/api/canvas/files",
	"/api/canvas/preview/",
	"/canvas/share/",
	// Brand tokens + logo assets are embedded by (public) canvas pages.
	"/api/brand/tokens.css",
	"/api/brand/asset/",
	// Brand identity + app-chrome theme for the console + pre-auth screens.
	"/api/brand/ui",
	"/api/brand/theme.css",
	// GitHub App webhook — authenticated by HMAC signature, not a session.
	"/api/github/webhook",
];

function isPublicRoute(path: string): boolean {
	if (PUBLIC_ROUTES.has(path)) return true;
	return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isApiRoute(path: string): boolean {
	return path.startsWith("/api/");
}

/** Timing-safe comparison to prevent token length/content leaking via timing */
function timingSafeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	const encoder = new TextEncoder();
	const bufA = encoder.encode(a);
	const bufB = encoder.encode(b);
	return crypto.subtle.timingSafeEqual(bufA, bufB);
}

export interface AuthMiddlewareOptions {
	authManager: WebAuthManager;
	bearerToken?: string;
}

export function createAuthMiddleware(
	options: AuthMiddlewareOptions,
): MiddlewareHandler {
	const { authManager, bearerToken } = options;

	return async (c: Context, next) => {
		const path = new URL(c.req.url).pathname;

		// Allow public routes (but mark as unauthenticated for downstream handlers)
		if (isPublicRoute(path)) {
			c.set("authenticated", false);
			return next();
		}

		// Allow POST to login
		if (path === "/login" && c.req.method === "POST") {
			return next();
		}

		// Allow POST to TOTP setup
		if (path === "/login/totp-setup" && c.req.method === "POST") {
			return next();
		}

		// Allow logout
		if (path === "/logout") {
			return next();
		}

		// Check Bearer token for API access (timing-safe comparison)
		const authHeader = c.req.header("Authorization");
		if (bearerToken && authHeader?.startsWith("Bearer ")) {
			const provided = authHeader.slice(7);
			if (timingSafeCompare(provided, bearerToken)) {
				c.set("authMethod", "bearer");
				c.set("authenticated", true);
				return next();
			}
		}

		// If no admins exist yet, allow access to setup
		if (!authManager.hasAdmins()) {
			return next();
		}

		// Check session cookie
		const sessionToken = getCookie(c, "paw_session");
		if (sessionToken) {
			const session = authManager.validateSession(sessionToken);
			if (session) {
				const admin = authManager.getAdmin(session.user_id);
				if (admin) {
					c.set("session", session);
					c.set("admin", admin);
					c.set("authMethod", "session");
					c.set("authenticated", true);
					return next();
				}
			}
		}

		// Not authenticated
		if (isApiRoute(path)) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		// Redirect pages to login
		return c.redirect("/login");
	};
}
