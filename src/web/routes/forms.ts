import { type Context, Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { ToolResult } from "../../types/message.js";

// The public canvas form receiver, extracted from createWebApp so it can be
// driven by app-level tests (Hono `app.request`) with injected fakes — no live
// Strapi/HubSpot/tool execution. Behavior is identical to the inline version:
// a canvas <form> POSTs here; the bound action routes the (field-allowlisted)
// payload to its declared destination (Strapi / HubSpot / a single allowlisted
// tool). Never runs arbitrary skills — a 'tool' action invokes ONLY the one
// tool named in its config, and still goes through the sandbox permission check
// (ToolRegistry.execute). Abuse is bounded by rate-limit + honeypot + field
// allowlist; sensitive actions set require_auth so this PUBLIC receiver refuses
// anonymous submits.

/** Minimal structural shapes so tests can pass plain-object fakes. */
interface StrapiLike {
	create(
		contentType: string,
		data: Record<string, unknown>,
	): Promise<{ data?: { documentId?: unknown; id?: unknown } }>;
}
interface HubspotLike {
	createContact(data: Record<string, unknown>): Promise<{ id: unknown }>;
}
interface ToolRunner {
	execute(name: string, input: Record<string, unknown>): Promise<ToolResult>;
}

export interface FormReceiverDeps {
	db: Database;
	/** kernel.toolRegistryPublic — applies the sandbox permission check. */
	toolRegistry: ToolRunner;
	/** kernel.strapi (null when not configured). */
	strapi: StrapiLike | null;
	/** kernel.hubspotClient (null when not configured). */
	hubspotClient: HubspotLike | null;
	/** True when the request carries a valid session cookie or bearer token. */
	isAuthenticated: (c: Context) => boolean;
	/** Resolve the client IP (respects trustedProxy config). */
	getClientIp: (c: Context) => string;
}

interface ActionRow {
	id: string;
	type: string;
	config_json: string;
	field_map_json: string;
	redirect_url: string | null;
	honeypot_field: string | null;
	secret: string | null;
	require_auth: number;
}

const FORM_CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, X-Paw-Form-Secret",
};

/**
 * Build the form-receiver sub-app. Mount it from createWebApp with
 * `app.route("/", createFormReceiver({…}))` BEFORE the session-auth middleware
 * so it stays public (the require_auth gate is per-action, via isAuthenticated).
 */
export function createFormReceiver(deps: FormReceiverDeps): Hono {
	const { db, toolRegistry, strapi, hubspotClient, isAuthenticated, getClientIp } =
		deps;

	// Per-action + per-IP submission rate limiting (in-memory, sliding window).
	const formRateLimit = new Map<string, { count: number; resetAt: number }>();
	function checkFormRate(key: string, limit: number, windowMs: number): boolean {
		const now = Date.now();
		const e = formRateLimit.get(key);
		if (!e || now > e.resetAt) {
			formRateLimit.set(key, { count: 1, resetAt: now + windowMs });
			return true;
		}
		if (e.count >= limit) return false;
		e.count++;
		return true;
	}

	const app = new Hono();

	app.options("/api/forms/:actionId", (c) => c.body(null, 204, FORM_CORS));

	app.post("/api/forms/:actionId", async (c) => {
		const actionId = c.req.param("actionId");
		const action = db
			.prepare("SELECT * FROM canvas_actions WHERE id = ? AND active = 1")
			.get(actionId) as ActionRow | undefined;
		if (!action) return c.json({ error: "Unknown form" }, 404, FORM_CORS);

		const ip = getClientIp(c);
		if (
			!checkFormRate(`a:${actionId}`, 120, 60_000) ||
			!checkFormRate(`ip:${actionId}:${ip}`, 20, 60_000)
		) {
			return c.json({ error: "Too many submissions" }, 429, FORM_CORS);
		}

		// Tiered trust: this receiver is PUBLIC (pre-auth), so an action flagged
		// require_auth must present a valid session/bearer before it runs. This is
		// what lets a 'tool' action safely drive mutations from an (authed) app
		// space without exposing them to the open internet.
		if (action.require_auth && !isAuthenticated(c)) {
			return c.json({ error: "Authentication required" }, 401, FORM_CORS);
		}

		// Parse JSON or form-encoded body
		let raw: Record<string, unknown> = {};
		const ct = c.req.header("Content-Type") ?? "";
		try {
			if (ct.includes("application/json")) {
				raw = (await c.req.json()) as Record<string, unknown>;
			} else {
				raw = (await c.req.parseBody()) as Record<string, unknown>;
			}
		} catch {
			raw = {};
		}

		// Honeypot — silently accept & drop suspected bots
		if (
			action.honeypot_field &&
			String(raw[action.honeypot_field] ?? "").trim() !== ""
		) {
			return c.json({ ok: true }, 200, FORM_CORS);
		}
		// Optional shared secret
		if (action.secret) {
			const provided =
				c.req.header("x-paw-form-secret") ?? String(raw._secret ?? "");
			if (provided !== action.secret)
				return c.json({ error: "Forbidden" }, 403, FORM_CORS);
		}

		// Field allowlist via field_map (only mapped fields are kept/forwarded)
		const fieldMap = JSON.parse(action.field_map_json || "{}") as Record<
			string,
			string
		>;
		const mapped: Record<string, unknown> = {};
		for (const [incoming, dest] of Object.entries(fieldMap)) {
			const v = raw[incoming];
			if (v !== undefined && v !== null && v !== "") {
				mapped[dest] = typeof v === "string" ? v.slice(0, 5000) : v;
			}
		}

		// Durable inbox first (no lead lost even if the external call fails)
		const ins = db.run(
			"INSERT INTO canvas_submissions (action_id, data_json, status, ip, user_agent) VALUES (?, ?, 'received', ?, ?)",
			[
				actionId,
				JSON.stringify(mapped),
				ip,
				(c.req.header("User-Agent") ?? "").slice(0, 300),
			],
		);
		const submissionId = Number(ins.lastInsertRowid);
		db.run(
			"UPDATE canvas_actions SET submit_count = submit_count + 1, updated_at = datetime('now') WHERE id = ?",
			[actionId],
		);

		// Route to the declared destination
		let status = "failed";
		let targetRef = "";
		try {
			const cfg = JSON.parse(action.config_json || "{}") as {
				contentType?: string;
				tool?: string;
			};
			if (action.type === "strapi") {
				if (!strapi) throw new Error("Strapi not configured");
				const res = await strapi.create(String(cfg.contentType), mapped);
				targetRef = `strapi:${res?.data?.documentId ?? res?.data?.id ?? "ok"}`;
				status = "routed";
			} else if (action.type === "hubspot") {
				if (!hubspotClient) throw new Error("HubSpot not configured");
				const res = await hubspotClient.createContact(mapped);
				targetRef = `hubspot:${res.id}`;
				status = "routed";
			} else if (action.type === "tool") {
				// Run the ONE tool this action declared, with the mapped fields as
				// input. ToolRegistry.execute applies the sandbox permission check,
				// so a denied tool fails here rather than running unchecked.
				const toolName = String(cfg.tool ?? "");
				if (!toolName) throw new Error("tool action missing config.tool");
				const res = await toolRegistry.execute(toolName, mapped);
				if (res.is_error) {
					throw new Error(
						typeof res.content === "string" ? res.content : "tool failed",
					);
				}
				targetRef = `tool:${toolName}`;
				status = "routed";
			} else {
				throw new Error(`Unknown action type: ${action.type}`);
			}
		} catch (err) {
			targetRef = (err instanceof Error ? err.message : String(err)).slice(
				0,
				300,
			);
		}
		db.run(
			"UPDATE canvas_submissions SET status = ?, target_ref = ? WHERE id = ?",
			[status, targetRef, submissionId],
		);

		if (action.redirect_url && status === "routed") {
			return c.redirect(action.redirect_url, 303);
		}
		return c.json({ ok: status === "routed", status }, 200, FORM_CORS);
	});

	return app;
}
