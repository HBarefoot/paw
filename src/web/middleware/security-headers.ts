import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
	buildAppCsp,
	readAppManifest,
	spaceFromAppPath,
} from "../app-spaces.js";

export interface SecurityHeaderOptions {
	/** Canvas root, needed to read per-space CSP overrides for /api/app/ pages. */
	canvasRoot?: string;
}

export function createSecurityHeaders(
	tlsEnabled = false,
	opts: SecurityHeaderOptions = {},
): MiddlewareHandler {
	return async (c, next) => {
		const path = c.req.path;

		// App spaces serve PRODUCTION app surfaces (financials, PII). Strict CSP:
		// no 'unsafe-eval' (pages ship precompiled — no in-browser Babel), no
		// `img-src *`; same-origin only. Optional per-space overrides from the
		// app manifest (apps/<space>/.app.json `csp`) are merged in.
		if (path.startsWith("/api/app/")) {
			const space = opts.canvasRoot ? spaceFromAppPath(path) : null;
			const override =
				space && opts.canvasRoot
					? readAppManifest(opts.canvasRoot, space).csp
					: undefined;
			c.header("X-Content-Type-Options", "nosniff");
			c.header("Referrer-Policy", "strict-origin-when-cross-origin");
			c.header("X-Frame-Options", "SAMEORIGIN");
			c.header("Content-Security-Policy", buildAppCsp(override));
			if (tlsEnabled) {
				c.header(
					"Strict-Transport-Security",
					"max-age=31536000; includeSubDomains",
				);
			}
			return next();
		}

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

		// The live companion (/companion) is framed inside the same-origin chat
		// page's pinned Home tab. The default X-Frame-Options: DENY blocks that,
		// so allow SAMEORIGIN framing with a CSP that lets it load its modules
		// (script-src 'self' + the inline bootstrap) and fetch /api/ops/feed.
		if (path === "/companion") {
			c.header("X-Content-Type-Options", "nosniff");
			c.header("Referrer-Policy", "strict-origin-when-cross-origin");
			c.header("X-Frame-Options", "SAMEORIGIN");
			c.header(
				"Content-Security-Policy",
				// Cloudflare auto-injects its analytics beacon into proxied HTML; allow
				// it here (matching the default app CSP below) so it doesn't throw a CSP
				// error on the framed companion. Everything else stays same-origin only.
				"default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'self';",
			);
			if (tlsEnabled) {
				c.header(
					"Strict-Transport-Security",
					"max-age=31536000; includeSubDomains",
				);
			}
			return next();
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
