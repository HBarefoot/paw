import type { Database } from "bun:sqlite";
import type { ToolDefinition, ToolResult } from "../types/message.js";

interface ActionToolsConfig {
	database: Database;
}

const ACTION_TYPES = ["strapi", "hubspot", "tool"] as const;

/**
 * Tools that let the agent wire a canvas page's form/button to a real backend.
 * The agent declares a *binding* (named, typed, field-mapped destination); the
 * public POST /api/forms/:id endpoint routes submissions to that binding only —
 * it can never invoke arbitrary skills. This is the safety boundary.
 */
export function createActionTools(config: ActionToolsConfig): ToolDefinition[] {
	const db = config.database;

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
						"'strapi' (CMS content-type), 'hubspot' (CRM contact), or 'tool' (run a single allowlisted built-in tool with the mapped fields as its input).",
				},
				config: {
					type: "object",
					description:
						"Target config. strapi: { contentType: 'leads' }. hubspot: {} (uses configured token). tool: { tool: 'the_tool_name' } — the single tool this action may invoke (still subject to the sandbox permission check).",
					additionalProperties: true,
				},
				requireAuth: {
					type: "boolean",
					description:
						"Require an authenticated session to submit. Defaults to TRUE for 'tool' actions (the public receiver refuses anonymous submits) and FALSE for strapi/hubspot lead capture. Set true for any mutation touching money/PII.",
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

	return [create, list, del];
}
