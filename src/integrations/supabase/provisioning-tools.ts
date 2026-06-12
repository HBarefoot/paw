/**
 * Typed provisioning tools — the agent builds its OWN tables in the `canvas`
 * yard from VALIDATED specs, never from SQL strings. The model fills a typed
 * spec (closed type/default enums, slug identifiers); ddl.ts turns that into
 * DDL; the builder-DSN executor runs it. Grouped under the same on-demand
 * `supabase` skill via `plugin: "supabase"`.
 *
 * Safety: the spec is Zod-validated BEFORE any SQL is built, so a hostile
 * identifier (`"x" text; DROP TABLE y`) is rejected at the schema boundary and
 * never reaches the generator. Destructive ops (DROP / ALTER TYPE / TRUNCATE)
 * are intentionally absent — they stay operator-only.
 */

import { ZodError } from "zod";
import type { ToolDefinition, ToolResult } from "../../types/message.js";
import {
	COLUMN_TYPES,
	RESERVED_COLUMNS,
	YARD_SCHEMA,
	generateAddColumn,
	generateCreateTable,
} from "./ddl.js";
import type { DdlExecutor } from "./provisioner.js";

export interface SupabaseProvisioningDeps {
	/** Runs generator-built DDL over the scoped paw_builder connection. */
	exec: DdlExecutor;
	/** Records a security-audit entry (action, details) — every DDL is logged. */
	audit?: (action: string, details: Record<string, unknown>) => void;
}

/** Turn a ZodError into a single, agent-readable message. */
function formatZodError(err: ZodError): string {
	return err.issues
		.map((i) => {
			const path = i.path.length ? `${i.path.join(".")}: ` : "";
			return `${path}${i.message}`;
		})
		.join("; ");
}

const columnSchemaJson = {
	type: "object",
	properties: {
		name: {
			type: "string",
			description: `Column name (lowercase slug). Reserved/auto-added names are rejected: ${RESERVED_COLUMNS.join(", ")}.`,
		},
		type: {
			type: "string",
			enum: [...COLUMN_TYPES],
			description: "One of the closed set of column types.",
		},
		required: {
			type: "boolean",
			description: "NOT NULL when true.",
		},
		default: {
			description:
				"Optional default. Either a whitelisted function (now() for timestamptz, gen_random_uuid() for uuid) or a literal valid for the column type.",
		},
	},
	required: ["name", "type"],
} as const;

export function createSupabaseProvisioningTools(
	deps: SupabaseProvisioningDeps,
): ToolDefinition[] {
	const audit = deps.audit ?? (() => {});

	const createTable: ToolDefinition = {
		name: "supabase_create_table",
		description: [
			`Create a table in the agent's '${YARD_SCHEMA}' schema (the only schema you can provision in — you cannot choose another).`,
			"Every table automatically gets 'id uuid primary key default gen_random_uuid()' and 'created_at timestamptz default now()', and has Row Level Security ENABLED.",
			"Define your other columns with the typed spec (closed type set; defaults from a closed set).",
			"This is additive and idempotent (CREATE TABLE IF NOT EXISTS).",
			"There is deliberately NO drop/rename/alter-type/truncate tool — destructive schema changes are operator-only, so if you need one, explain that to the user instead of improvising.",
		].join(" "),
		plugin: "supabase",
		input_schema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: `Table name (lowercase slug). Created in schema '${YARD_SCHEMA}'.`,
				},
				columns: {
					type: "array",
					items: columnSchemaJson,
					description:
						"Your columns (id and created_at are added automatically — do not include them).",
				},
				indexes: {
					type: "array",
					description: "Optional indexes over existing columns.",
					items: {
						type: "object",
						properties: {
							columns: {
								type: "array",
								items: { type: "string" },
								description: "Columns to index (must exist on the table).",
							},
							unique: {
								type: "boolean",
								description: "UNIQUE index when true.",
							},
						},
						required: ["columns"],
					},
				},
			},
			required: ["name", "columns"],
		},
		handler: async (input): Promise<ToolResult> => {
			let generated: ReturnType<typeof generateCreateTable>;
			try {
				generated = generateCreateTable({
					name: input.name,
					columns: input.columns,
					indexes: input.indexes,
				});
			} catch (err) {
				if (err instanceof ZodError) {
					return {
						content: `Invalid table spec: ${formatZodError(err)}`,
						is_error: true,
					};
				}
				return {
					content: `Invalid table spec: ${err instanceof Error ? err.message : String(err)}`,
					is_error: true,
				};
			}

			const details = {
				schema: YARD_SCHEMA,
				table: generated.shape.table,
				statements: generated.statements,
			};
			try {
				await deps.exec.exec(generated.statements);
				audit("supabase.provision.create_table.ok", details);
				return {
					content: JSON.stringify({
						created: true,
						schema: generated.shape.schema,
						table: generated.shape.table,
						shape: generated.shape,
						statements: generated.statements,
					}),
				};
			} catch (err) {
				audit("supabase.provision.create_table.fail", {
					...details,
					error: err instanceof Error ? err.message : String(err),
				});
				return {
					content: `Supabase DDL failed: ${err instanceof Error ? err.message : String(err)}`,
					is_error: true,
				};
			}
		},
	};

	const addColumn: ToolDefinition = {
		name: "supabase_add_column",
		description: `Add a column to an existing table in the '${YARD_SCHEMA}' schema. Additive only (ADD COLUMN IF NOT EXISTS) — it cannot drop, rename, or change a column's type (those are operator-only). Same typed spec as supabase_create_table's columns.`,
		plugin: "supabase",
		input_schema: {
			type: "object",
			properties: {
				table: {
					type: "string",
					description: `Existing table name in schema '${YARD_SCHEMA}'.`,
				},
				column: columnSchemaJson,
			},
			required: ["table", "column"],
		},
		handler: async (input): Promise<ToolResult> => {
			let generated: ReturnType<typeof generateAddColumn>;
			try {
				generated = generateAddColumn(input.table, input.column);
			} catch (err) {
				if (err instanceof ZodError) {
					return {
						content: `Invalid column spec: ${formatZodError(err)}`,
						is_error: true,
					};
				}
				return {
					content: `Invalid column spec: ${err instanceof Error ? err.message : String(err)}`,
					is_error: true,
				};
			}

			const details = {
				schema: YARD_SCHEMA,
				table: generated.table,
				statements: generated.statements,
			};
			try {
				await deps.exec.exec(generated.statements);
				audit("supabase.provision.add_column.ok", details);
				return {
					content: JSON.stringify({
						added: true,
						schema: YARD_SCHEMA,
						table: generated.table,
						column: generated.column,
						statements: generated.statements,
					}),
				};
			} catch (err) {
				audit("supabase.provision.add_column.fail", {
					...details,
					error: err instanceof Error ? err.message : String(err),
				});
				return {
					content: `Supabase DDL failed: ${err instanceof Error ? err.message : String(err)}`,
					is_error: true,
				};
			}
		},
	};

	return [createTable, addColumn];
}
