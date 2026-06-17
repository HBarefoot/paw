import type { ToolDefinition, ToolResult } from "../../types/message.js";
import type { SupabaseClient } from "./client.js";
import { SUPABASE_FILTER_OPS, type SupabaseFilter } from "./types.js";

export interface SupabaseToolDeps {
	/** Records a security-audit entry for write actions (action, details). */
	audit?: (action: string, details: Record<string, unknown>) => void;
}

/**
 * Supabase tools (PostgREST). Grouped under the on-demand `supabase` skill via
 * `plugin: "supabase"`. Reads (`select`) are ungated; mutations
 * (insert/update/delete/rpc) are audited, and update/delete REQUIRE filters so
 * the agent can never wipe a whole table.
 */
export function createSupabaseTools(
	client: SupabaseClient,
	deps: SupabaseToolDeps = {},
): ToolDefinition[] {
	const audit = deps.audit ?? (() => {});

	async function audited<T>(
		action: string,
		details: Record<string, unknown>,
		fn: () => Promise<T>,
	): Promise<T> {
		try {
			const result = await fn();
			audit(`${action}.ok`, details);
			return result;
		} catch (err) {
			audit(`${action}.fail`, {
				...details,
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	}

	const errResult = (err: unknown): ToolResult => ({
		content: `Supabase error: ${err instanceof Error ? err.message : String(err)}`,
		is_error: true,
	});

	// Shared JSON Schema for the typed filter subset.
	const filterSchema = {
		type: "array",
		description:
			'Filters combined with AND. Each filter is { "column": "status", "op": "eq", "value": "new" }; op ∈ eq,neq,gt,lt,like,in. No raw query strings.',
		items: {
			type: "object",
			properties: {
				column: { type: "string", description: "Column name." },
				op: {
					type: "string",
					enum: SUPABASE_FILTER_OPS,
					description:
						"Operator: eq, neq, gt, lt, like (use * as wildcard), or in.",
				},
				value: {
					description:
						"Comparison value. For the 'in' operator pass an array of values.",
				},
			},
			required: ["column", "op", "value"],
		},
	} as const;

	const asFilters = (input: Record<string, unknown>): SupabaseFilter[] =>
		(input.filters as SupabaseFilter[] | undefined) ?? [];

	const asSchema = (input: Record<string, unknown>): string | undefined =>
		(input.schema as string | undefined) || undefined;

	// Shared JSON Schema for the optional schema/profile selector. Mirrors how
	// insert was pinned to the canvas yard in #88; omit for the public schema.
	const schemaProp = {
		type: "string",
		description:
			"Non-default PostgREST schema to target, e.g. 'canvas' (the agent's own provisioned tables). Omit for the public schema.",
	} as const;

	// Shape a write (insert/update/delete) result so a zero-row write can't read
	// as success. With `Prefer: return=representation` a write that matched/created
	// nothing returns [] — surface `affected` explicitly and, on 0, an unmissable
	// note so the model never reports a phantom "done." Stays a normal result.
	const writeResult = (rows: unknown, zeroNote: string): ToolResult => {
		const list = Array.isArray(rows) ? rows : [];
		const payload: Record<string, unknown> = {
			rows: list,
			affected: list.length,
		};
		if (list.length === 0) payload.note = zeroNote;
		return { content: JSON.stringify(payload) };
	};

	const select: ToolDefinition = {
		name: "supabase_select",
		description:
			'Read rows from a Supabase table via PostgREST. Optionally pick columns, apply filters, and cap the row count. Each filter is { "column": "status", "op": "eq", "value": "new" }; op ∈ eq,neq,gt,lt,like,in. Pass schema:"canvas" to read the agent\'s own tables.',
		plugin: "supabase",
		input_schema: {
			type: "object",
			properties: {
				table: { type: "string", description: "Table name." },
				columns: {
					type: "array",
					items: { type: "string" },
					description: "Columns to return (default: all).",
				},
				filters: filterSchema,
				limit: { type: "number", description: "Max rows to return." },
				schema: schemaProp,
			},
			required: ["table"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const rows = await client.select(input.table as string, {
					columns: input.columns as string[] | undefined,
					filters: asFilters(input),
					limit: input.limit as number | undefined,
					schema: asSchema(input),
				});
				return { content: JSON.stringify({ rows }) };
			} catch (err) {
				// PGRST205 = unknown table. Point the agent at introspection instead
				// of letting it guess table names into more 404s.
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("PGRST205")) {
					return {
						content: `Supabase error: ${msg} — use supabase_list_tables to see the available tables.`,
						is_error: true,
					};
				}
				return errResult(err);
			}
		},
	};

	const insert: ToolDefinition = {
		name: "supabase_insert",
		description:
			'Insert one or more rows into a Supabase table. Returns { rows, affected }. Pass schema:"canvas" to write to the agent\'s own tables (omit for public).',
		plugin: "supabase",
		input_schema: {
			type: "object",
			properties: {
				table: { type: "string", description: "Table name." },
				rows: {
					type: "array",
					items: { type: "object" },
					description: "Rows to insert (array of column→value objects).",
				},
				schema: schemaProp,
			},
			required: ["table", "rows"],
		},
		handler: async (input): Promise<ToolResult> => {
			const table = input.table as string;
			try {
				const rows = await audited("supabase.insert", { table }, () =>
					client.insert(table, input.rows as Record<string, unknown>[], {
						schema: asSchema(input),
					}),
				);
				return writeResult(
					rows,
					"0 rows were inserted — nothing landed. Check the schema (canvas vs public) and that the row data is valid.",
				);
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const update: ToolDefinition = {
		name: "supabase_update",
		description:
			'Update rows in a Supabase table that match the given filters. Filters are REQUIRED — an unfiltered update is refused. Each filter is { "column": "status", "op": "eq", "value": "new" }; op ∈ eq,neq,gt,lt,like,in. Returns { rows, affected }; affected:0 means nothing matched. Pass schema:"canvas" for the agent\'s own tables.',
		plugin: "supabase",
		input_schema: {
			type: "object",
			properties: {
				table: { type: "string", description: "Table name." },
				filters: filterSchema,
				values: {
					type: "object",
					description: "Column→value map to set on matching rows.",
				},
				schema: schemaProp,
			},
			required: ["table", "filters", "values"],
		},
		handler: async (input): Promise<ToolResult> => {
			const table = input.table as string;
			try {
				const rows = await audited("supabase.update", { table }, () =>
					client.update(
						table,
						asFilters(input),
						input.values as Record<string, unknown>,
						{ schema: asSchema(input) },
					),
				);
				return writeResult(
					rows,
					"0 rows matched the filter — nothing was written/updated. Check the filter and the schema (canvas vs public).",
				);
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const del: ToolDefinition = {
		name: "supabase_delete",
		description:
			'Delete rows from a Supabase table that match the given filters. Filters are REQUIRED — an unfiltered delete is refused. Each filter is { "column": "status", "op": "eq", "value": "new" }; op ∈ eq,neq,gt,lt,like,in. Returns { rows, affected }; affected:0 means nothing matched. Pass schema:"canvas" for the agent\'s own tables.',
		plugin: "supabase",
		input_schema: {
			type: "object",
			properties: {
				table: { type: "string", description: "Table name." },
				filters: filterSchema,
				schema: schemaProp,
			},
			required: ["table", "filters"],
		},
		handler: async (input): Promise<ToolResult> => {
			const table = input.table as string;
			try {
				const rows = await audited("supabase.delete", { table }, () =>
					client.delete(table, asFilters(input), { schema: asSchema(input) }),
				);
				return writeResult(
					rows,
					"0 rows matched the filter — nothing was written/updated. Check the filter and the schema (canvas vs public).",
				);
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const listTables: ToolDefinition = {
		name: "supabase_list_tables",
		description:
			"List the tables/views exposed by the Supabase project, with their columns and types (parsed from PostgREST's OpenAPI document). Covers both the `public` schema and the agent's `canvas` yard (where supabase_create_table builds). Each table is tagged with its `schema`. Call this first to discover what exists instead of guessing table names.",
		plugin: "supabase",
		input_schema: { type: "object", properties: {} },
		handler: async (): Promise<ToolResult> => {
			try {
				const res = await client.listTables();
				if (res.tables.length === 0) {
					return {
						content: JSON.stringify({
							tables: [],
							note: "No tables are exposed on the public or canvas schemas. Use supabase_create_table to provision one in the canvas yard.",
						}),
					};
				}
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const rpc: ToolDefinition = {
		name: "supabase_rpc",
		description:
			"Call a Postgres function exposed via Supabase PostgREST RPC, with named arguments.",
		plugin: "supabase",
		input_schema: {
			type: "object",
			properties: {
				function: { type: "string", description: "Function name." },
				args: {
					type: "object",
					description: "Named arguments for the function.",
				},
			},
			required: ["function"],
		},
		handler: async (input): Promise<ToolResult> => {
			const fn = input.function as string;
			try {
				const result = await audited("supabase.rpc", { function: fn }, () =>
					client.rpc(fn, (input.args as Record<string, unknown>) ?? {}),
				);
				return { content: JSON.stringify({ result }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	return [select, listTables, insert, update, del, rpc];
}
