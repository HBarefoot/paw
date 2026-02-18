import type { MiddlewareHandler, Context } from "hono";
import { getCookie } from "hono/cookie";
import type { WebAuthManager } from "../../security/web-auth.js";

const PUBLIC_ROUTES = new Set(["/login", "/login/setup", "/login/totp-setup", "/api/health"]);

function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.has(path);
}

function isApiRoute(path: string): boolean {
  return path.startsWith("/api/");
}

export interface AuthMiddlewareOptions {
  authManager: WebAuthManager;
  bearerToken?: string;
}

export function createAuthMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler {
  const { authManager, bearerToken } = options;

  return async (c: Context, next) => {
    const path = new URL(c.req.url).pathname;

    // Allow public routes
    if (isPublicRoute(path)) {
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

    // Check Bearer token for API access
    const authHeader = c.req.header("Authorization");
    if (bearerToken && authHeader === `Bearer ${bearerToken}`) {
      c.set("authMethod", "bearer");
      return next();
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
