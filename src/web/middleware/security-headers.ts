import { secureHeaders } from "hono/secure-headers";
import type { MiddlewareHandler } from "hono";

export function createSecurityHeaders(tlsEnabled = false): MiddlewareHandler {
	return async (c, next) => {
		const path = c.req.path;

		// Canvas preview serves user-generated content inside an iframe — use
		// a permissive policy so arbitrary HTML/CSS/JS works, but keep it
		// sandboxed to the same origin.
		if (path.startsWith("/api/canvas/preview/")) {
			c.header("X-Content-Type-Options", "nosniff");
			c.header("Referrer-Policy", "strict-origin-when-cross-origin");
			// No X-Frame-Options → allow embedding in our own iframe
			// Permissive CSP for user-generated canvas content
			c.header(
				"Content-Security-Policy",
				"default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; img-src * data: blob:; font-src * data:; connect-src 'self';",
			);
			if (tlsEnabled) {
				c.header(
					"Strict-Transport-Security",
					"max-age=31536000; includeSubDomains",
				);
			}
			return next();
		}

		// Public brand assets are embedded BY canvas pages, which render in a
		// sandboxed null-origin iframe. The default `Cross-Origin-Resource-Policy:
		// same-origin` blocks those loads (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin),
		// so brand colors/logo never applied. Serve them cross-origin.
		if (
			path === "/api/brand/tokens.css" ||
			path === "/api/brand/theme.css" ||
			path.startsWith("/api/brand/asset/")
		) {
			const handler = secureHeaders({
				crossOriginResourcePolicy: "cross-origin",
				xContentTypeOptions: "nosniff",
				referrerPolicy: "strict-origin-when-cross-origin",
				...(tlsEnabled
					? { strictTransportSecurity: "max-age=31536000; includeSubDomains" }
					: {}),
			});
			return handler(c, next);
		}

		// Canvas page itself needs to embed the preview iframe (SAMEORIGIN)
		// and connect to the SSE stream.
		if (path === "/canvas" || path.startsWith("/api/canvas/")) {
			const handler = secureHeaders({
				contentSecurityPolicy: {
					defaultSrc: ["'self'"],
					scriptSrc: ["'self'", "'unsafe-inline'"],
					styleSrc: [
						"'self'",
						"'unsafe-inline'",
						"https://fonts.googleapis.com",
					],
					imgSrc: ["'self'", "data:"],
					fontSrc: ["'self'", "https://fonts.gstatic.com"],
					connectSrc: ["'self'"],
					frameSrc: ["'self'"],
				},
				xFrameOptions: "SAMEORIGIN",
				xContentTypeOptions: "nosniff",
				referrerPolicy: "strict-origin-when-cross-origin",
				...(tlsEnabled
					? { strictTransportSecurity: "max-age=31536000; includeSubDomains" }
					: {}),
			});
			return handler(c, next);
		}

		// Default headers for all other routes
		const handler = secureHeaders({
			contentSecurityPolicy: {
				defaultSrc: ["'self'"],
				scriptSrc: [
					"'self'",
					"'unsafe-inline'",
					"https://static.cloudflareinsights.com",
				],
				styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
				imgSrc: ["'self'", "data:"],
				fontSrc: ["'self'", "https://fonts.gstatic.com"],
				connectSrc: ["'self'", "https://cloudflareinsights.com"],
			},
			xFrameOptions: "DENY",
			xContentTypeOptions: "nosniff",
			referrerPolicy: "strict-origin-when-cross-origin",
			...(tlsEnabled
				? { strictTransportSecurity: "max-age=31536000; includeSubDomains" }
				: {}),
		});
		return handler(c, next);
	};
}
