import type { Database } from "bun:sqlite";
import { sanitizePromptText } from "../ai/system-prompt.js";
import {
	type SchemaIntrospector,
	assertCanvasTable,
} from "../integrations/supabase/client.js";
import type { ToolDefinition, ToolResult } from "../types/message.js";

interface ActionToolsConfig {
	database: Database;
	/**
	 * Resolve the Supabase CRUD client (or null when the integration is off).
	 * A getter, not the client itself, because action tools are constructed
	 * before the Supabase integration boots — it is read lazily at call time.
	 */
	getSupabase?: () => SchemaIntrospector | null;
}

const ACTION_TYPES = ["strapi", "hubspot", "tool", "supabase"] as const;

/**
 * Tools that let the agent wire a canvas page's form/button to a real backend.
 * The agent declares a *binding* (named, typed, field-mapped destination); the
 * public POST /api/forms/:id endpoint routes submissions to that binding only —
 * it can never invoke arbitrary skills. This is the safety boundary.
 */
export function createActionTools(config: ActionToolsConfig): ToolDefinition[] {
	const db = config.database;
	const getSupabase = config.getSupabase ?? (() => null);

	const create: ToolDefinition = {
		name: "canvas_action_create",
		description:
			"Wire a canvas form/button to a real backend so submissions are routed to a CRM/CMS. " +
			"Declares a typed binding and returns a submitUrl + a sample <form> to embed in the canvas page. " +
			"Use this BEFORE writing a page whose form must actually capture data (e.g. a sales-campaign lead form). " +
			"Then write the page's <form action=submitUrl method=post> with <input name> matching the fieldMap keys.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Human label, e.g. 'Engram franchise leads'",
				},
				type: {
					type: "string",
					enum: [...ACTION_TYPES],
					description:
						"'strapi' (CMS content-type), 'hubspot' (CRM contact), 'tool' (run a single allowlisted built-in tool with the mapped fields as its input), or 'supabase' (insert a row into one of YOUR tables in the canvas yard — make it first with supabase_create_table).",
				},
				config: {
					type: "object",
					description:
						"Target config. strapi: { contentType: 'leads' }. hubspot: {} (uses configured token). tool: { tool: 'the_tool_name' } — the single tool this action may invoke (still subject to the sandbox permission check). supabase: { table: 'leads' } — a table you already created in the canvas schema; the fieldMap destinations must be its column names.",
					additionalProperties: true,
				},
				requireAuth: {
					type: "boolean",
					description:
						"Require an authenticated session to submit. Defaults to TRUE for 'tool' actions (the public receiver refuses anonymous submits) and FALSE for strapi/hubspot/supabase lead capture. Set true for any mutation touching money/PII.",
				},
				fieldMap: {
					type: "object",
					description:
						"Maps incoming form field name -> destination field. ONLY mapped fields are stored/forwarded. " +
						"e.g. hubspot: { email:'email', name:'firstname' }; strapi: { email:'email', message:'message' }.",
					additionalProperties: { type: "string" },
				},
				redirectUrl: {
					type: "string",
					description:
						"Optional URL to redirect to after a successful submit (thank-you page).",
				},
				honeypotField: {
					type: "string",
					description:
						"Optional hidden field name; submissions with it filled are silently dropped (spam).",
				},
				description: { type: "string" },
			},
			required: ["name", "type", "fieldMap"],
		},
		handler: async (input): Promise<ToolResult> => {
			const type = input.type as string;
			if (!ACTION_TYPES.includes(type as (typeof ACTION_TYPES)[number])) {
				return {
					content: `Error: type must be one of ${ACTION_TYPES.join(", ")}`,
					is_error: true,
				};
			}
			const fieldMap = (input.fieldMap as Record<string, string>) ?? {};
			if (!fieldMap || Object.keys(fieldMap).length === 0) {
				return {
					content: "Error: fieldMap must map at least one field",
					is_error: true,
				};
			}
			const cfg = (input.config as Record<string, unknown>) ?? {};
			if (type === "strapi" && !cfg.contentType) {
				return {
					content: "Error: strapi actions require config.contentType",
					is_error: true,
				};
			}
			if (type === "tool" && !cfg.tool) {
				return {
					content:
						"Error: tool actions require config.tool (the single tool name to invoke)",
					is_error: true,
				};
			}
			if (type === "supabase") {
				const table = typeof cfg.table === "string" ? cfg.table.trim() : "";
				if (!table) {
					return {
						content:
							"Error: supabase actions require config.table (a table you created in the canvas schema)",
						is_error: true,
					};
				}
				cfg.table = table;
				const sb = getSupabase();
				if (!sb) {
					return {
						content:
							"Error: the Supabase integration is not enabled, so a form cannot be wired to a Supabase table.",
						is_error: true,
					};
				}
				// Validate AT CREATION that the target is a real table inside the
				// canvas yard (it is re-checked at every submission too). Fails the
				// binding rather than letting a form point at a missing/out-of-fence
				// table and only discovering it when leads arrive.
				try {
					await assertCanvasTable(sb, table);
				} catch (err) {
					return {
						content: `Error: ${err instanceof Error ? err.message : String(err)}`,
						is_error: true,
					};
				}
			}
			// Safe default: 'tool' actions require auth unless explicitly opted out;
			// strapi/hubspot lead capture is public by default.
			const requireAuth =
				typeof input.requireAuth === "boolean"
					? input.requireAuth
					: type === "tool";
			const id = crypto.randomUUID().replace(/-/g, "");
			db.run(
				`INSERT INTO canvas_actions (id, name, description, type, config_json, field_map_json, redirect_url, honeypot_field, require_auth)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id,
					String(input.name),
					String(input.description ?? ""),
					type,
					JSON.stringify(cfg),
					JSON.stringify(fieldMap),
					(input.redirectUrl as string) ?? null,
					(input.honeypotField as string) ?? null,
					requireAuth ? 1 : 0,
				],
			);
			const submitUrl = `/api/forms/${id}`;
			const inputs = Object.keys(fieldMap)
				.map((f) => `  <input name="${f}" placeholder="${f}" required>`)
				.join("\n");
			const honeypot = input.honeypotField
				? `\n  <input type="text" name="${input.honeypotField}" style="display:none" tabindex="-1" autocomplete="off">`
				: "";
			const embedHint = `<form action="${submitUrl}" method="post">\n${inputs}${honeypot}\n  <button type="submit">Submit</button>\n</form>\n<!-- or fetch(submitUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}) -->`;
			return {
				content: JSON.stringify({
					actionId: id,
					submitUrl,
					fields: Object.keys(fieldMap),
					embedHint,
				}),
			};
		},
	};

	const list: ToolDefinition = {
		name: "canvas_action_list",
		description: "List existing canvas action bindings (form→backend wirings).",
		plugin: "kernel",
		input_schema: { type: "object", properties: {} },
		handler: async (): Promise<ToolResult> => {
			const rows = db
				.query<
					{
						id: string;
						name: string;
						type: string;
						submit_count: number;
						active: number;
					},
					[]
				>(
					"SELECT id, name, type, submit_count, active FROM canvas_actions ORDER BY created_at DESC LIMIT 100",
				)
				.all();
			return {
				content: JSON.stringify(
					rows.map((r) => ({
						actionId: r.id,
						submitUrl: `/api/forms/${r.id}`,
						name: r.name,
						type: r.type,
						submissions: r.submit_count,
						active: !!r.active,
					})),
				),
			};
		},
	};

	const SUBMISSION_STATUSES = ["received", "routed", "failed"] as const;

	const submissionsList: ToolDefinition = {
		name: "canvas_submissions_list",
		description:
			"Read recent rows from the durable form-submission inbox (the same rows shown on the /submissions page). Use this to inspect what was captured and WHY a routing failed — not just how many. Returns each row's timestamp, action, mapped field data, status (received/routed/failed), and target_ref (the destination id on success, or the structured error on failure). Filter by actionId and/or status.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: {
				actionId: {
					type: "string",
					description: "Only submissions for this action binding.",
				},
				status: {
					type: "string",
					enum: [...SUBMISSION_STATUSES],
					description:
						"Only submissions with this status. 'failed' surfaces the routing error in target_ref.",
				},
				limit: {
					type: "number",
					description: "Max rows to return (default 20, max 100).",
				},
			},
		},
		handler: async (input): Promise<ToolResult> => {
			const limit = Math.min(Math.max(1, Number(input.limit) || 20), 100);
			const where: string[] = [];
			const params: (string | number)[] = [];
			if (typeof input.actionId === "string" && input.actionId) {
				where.push("s.action_id = ?");
				params.push(input.actionId);
			}
			if (
				typeof input.status === "string" &&
				(SUBMISSION_STATUSES as readonly string[]).includes(input.status)
			) {
				where.push("s.status = ?");
				params.push(input.status);
			}
			const rows = db
				.query<
					{
						created_at: string;
						action_id: string;
						action_name: string | null;
						type: string | null;
						status: string;
						target_ref: string | null;
						data_json: string;
					},
					(string | number)[]
				>(
					`SELECT s.created_at, s.action_id, a.name AS action_name, a.type,
					        s.status, s.target_ref, s.data_json
					   FROM canvas_submissions s
					   LEFT JOIN canvas_actions a ON a.id = s.action_id
					   ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
					  ORDER BY s.created_at DESC, s.id DESC
					  LIMIT ?`,
				)
				.all(...params, limit);
			// Submission data + target_ref carry untrusted, externally-supplied
			// content back into the model's context — run every string through
			// sanitizePromptText (the same strip the system prompt uses) so a
			// crafted field value can't smuggle markup/control chars or injection.
			const submissions = rows.map((r) => {
				let data: Record<string, unknown> = {};
				try {
					data = JSON.parse(r.data_json || "{}") as Record<string, unknown>;
				} catch {
					data = {};
				}
				const safeData: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(data)) {
					safeData[sanitizePromptText(k)] =
						typeof v === "string" ? sanitizePromptText(v) : v;
				}
				return {
					timestamp: r.created_at,
					actionId: r.action_id,
					action: r.action_name ? sanitizePromptText(r.action_name) : null,
					type: r.type,
					status: r.status,
					targetRef: r.target_ref ? sanitizePromptText(r.target_ref) : null,
					data: safeData,
				};
			});
			return { content: JSON.stringify({ submissions }) };
		},
	};

	const del: ToolDefinition = {
		name: "canvas_action_delete",
		description: "Delete a canvas action binding by id.",
		plugin: "kernel",
		input_schema: {
			type: "object",
			properties: { actionId: { type: "string" } },
			required: ["actionId"],
		},
		handler: async (input): Promise<ToolResult> => {
			const res = db.run("DELETE FROM canvas_actions WHERE id = ?", [
				String(input.actionId),
			]);
			return { content: JSON.stringify({ deleted: res.changes > 0 }) };
		},
	};

	return [create, list, submissionsList, del];
}
