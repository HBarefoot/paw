/**
 * DDL generator for the agent's fenced yard (schema `canvas`).
 *
 * THE HARD RULE: the agent never composes SQL. Every statement here is built
 * from a Zod-VALIDATED spec — a closed set of column types, a closed set of
 * defaults, and slug-validated identifiers — never from an agent-supplied SQL
 * string. Identifiers are double-quoted, but only AFTER passing the slug guard,
 * so quoting is defense-in-depth rather than the primary control. Literal
 * defaults are encoded per-type (single quotes doubled), so a hostile value
 * like `'; DROP TABLE x; --` can only ever become an inert string literal.
 *
 * Pure module: no I/O, no DB. The executor (provisioner.ts) runs what this
 * emits. That split is what makes the generator snapshot- and injection-
 * testable without a live Postgres.
 */

import { z } from "zod";

/** The schema the agent may build in — always. The agent cannot choose another. */
export const YARD_SCHEMA = "canvas";

/** Closed set of column types the agent may use. */
export const COLUMN_TYPES = [
	"text",
	"integer",
	"numeric",
	"boolean",
	"timestamptz",
	"uuid",
	"jsonb",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

/** Whitelisted function defaults (the only non-literal defaults allowed). */
const FUNCTION_DEFAULTS = new Set(["now()", "gen_random_uuid()"]);

// Postgres identifiers: lowercase slug, must start with a letter, ≤63 bytes.
// Deliberately stricter than Postgres allows (no quotes/spaces/uppercase) so
// the surface the agent can name is small and predictable.
const SLUG_RE = /^[a-z][a-z0-9_]*$/;
const slug = (label: string) =>
	z
		.string()
		.min(1)
		.max(63)
		.refine((s) => SLUG_RE.test(s), {
			message: `${label} must be a lowercase slug (letters, digits, underscore; starting with a letter), ≤63 chars`,
		});

/** Columns added automatically to every table — agents cannot override these. */
export const RESERVED_COLUMNS = ["id", "created_at"] as const;
const RESERVED = new Set<string>(RESERVED_COLUMNS);

export const columnSpecSchema = z
	.object({
		name: slug("column name").refine((s) => !RESERVED.has(s), {
			message: `column name is reserved (auto-added): ${RESERVED_COLUMNS.join(", ")}`,
		}),
		type: z.enum(COLUMN_TYPES),
		required: z.boolean().optional(),
		// Scalar default; validated/encoded per-type below. Objects/arrays are
		// rejected (jsonb defaults pass as a JSON string).
		default: z.union([z.string(), z.number(), z.boolean()]).optional(),
	})
	.strict();
export type ColumnSpec = z.infer<typeof columnSpecSchema>;

export const indexSpecSchema = z
	.object({
		columns: z.array(slug("index column")).min(1).max(8),
		unique: z.boolean().optional(),
	})
	.strict();
export type IndexSpec = z.infer<typeof indexSpecSchema>;

export const tableSpecSchema = z
	.object({
		name: slug("table name"),
		columns: z.array(columnSpecSchema).min(1).max(64),
		indexes: z.array(indexSpecSchema).max(16).optional(),
	})
	.strict()
	.superRefine((spec, ctx) => {
		// No duplicate column names.
		const seen = new Set<string>();
		for (const c of spec.columns) {
			if (seen.has(c.name)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `duplicate column: ${c.name}`,
				});
			}
			seen.add(c.name);
		}
		// Index columns must reference a real column (a declared one, or a
		// reserved auto-column). This catches typos before they reach Postgres.
		const known = new Set<string>([...seen, ...RESERVED]);
		for (const idx of spec.indexes ?? []) {
			for (const col of idx.columns) {
				if (!known.has(col)) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `index references unknown column: ${col}`,
					});
				}
			}
		}
	});
export type TableSpec = z.infer<typeof tableSpecSchema>;

/** Quote a slug that has ALREADY passed the slug guard. Defense-in-depth. */
function q(ident: string): string {
	if (!SLUG_RE.test(ident)) {
		// Should be unreachable — every identifier is slug-validated upstream.
		throw new Error(`refusing to quote unvalidated identifier: ${ident}`);
	}
	return `"${ident}"`;
}

/** `"canvas"."<table>"` — always schema-qualified to the yard. */
function qualified(table: string): string {
	return `${q(YARD_SCHEMA)}.${q(table)}`;
}

/** Single-quote a string literal by doubling embedded quotes. */
function quoteLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Render a column default to SQL from the closed set. Either a whitelisted
 * function call, or a literal validated against the column's type. Throws with
 * a clear message on anything else — the value never reaches SQL unencoded.
 */
export function renderDefault(type: ColumnType, raw: unknown): string {
	// Whitelisted function defaults — only where they make sense.
	if (typeof raw === "string" && FUNCTION_DEFAULTS.has(raw)) {
		if (raw === "now()") {
			if (type !== "timestamptz") {
				throw new Error("default now() is only valid for a timestamptz column");
			}
			return "now()";
		}
		// gen_random_uuid()
		if (type !== "uuid") {
			throw new Error(
				"default gen_random_uuid() is only valid for a uuid column",
			);
		}
		return "gen_random_uuid()";
	}

	switch (type) {
		case "text": {
			return quoteLiteral(String(raw));
		}
		case "integer": {
			const n = typeof raw === "number" ? raw : Number(String(raw).trim());
			if (!Number.isInteger(n)) {
				throw new Error(`integer default must be a whole number, got: ${raw}`);
			}
			return String(n);
		}
		case "numeric": {
			const n = typeof raw === "number" ? raw : Number(String(raw).trim());
			if (!Number.isFinite(n)) {
				throw new Error(`numeric default must be a number, got: ${raw}`);
			}
			return String(n);
		}
		case "boolean": {
			if (typeof raw === "boolean") return raw ? "true" : "false";
			const s = String(raw).trim().toLowerCase();
			if (s === "true") return "true";
			if (s === "false") return "false";
			throw new Error(`boolean default must be true or false, got: ${raw}`);
		}
		case "uuid": {
			const s = String(raw).trim();
			if (!UUID_RE.test(s)) {
				throw new Error(
					`uuid default must be a UUID or gen_random_uuid(), got: ${raw}`,
				);
			}
			return `${quoteLiteral(s)}::uuid`;
		}
		case "timestamptz": {
			const s = String(raw).trim();
			if (Number.isNaN(Date.parse(s))) {
				throw new Error(
					`timestamptz default must be an ISO timestamp or now(), got: ${raw}`,
				);
			}
			return `${quoteLiteral(s)}::timestamptz`;
		}
		case "jsonb": {
			let json: string;
			try {
				// Accept a JSON string; re-serialize to canonical form.
				json = JSON.stringify(JSON.parse(String(raw)));
			} catch {
				throw new Error(`jsonb default must be valid JSON, got: ${raw}`);
			}
			return `${quoteLiteral(json)}::jsonb`;
		}
		default: {
			// Exhaustiveness guard.
			throw new Error(`unsupported column type: ${type as string}`);
		}
	}
}

/** A column's resolved SQL definition fragment, e.g. `"email" text not null`. */
function columnDefinition(col: ColumnSpec): string {
	const parts = [q(col.name), col.type];
	if (col.required) parts.push("not null");
	if (col.default !== undefined) {
		parts.push(`default ${renderDefault(col.type, col.default)}`);
	}
	return parts.join(" ");
}

/** The shape a created/altered table ends up with (echoed back to the agent). */
export interface TableShape {
	schema: string;
	table: string;
	columns: Array<{
		name: string;
		type: string;
		required: boolean;
		default: string | null;
	}>;
}

export interface GeneratedDdl {
	statements: string[];
	shape: TableShape;
}

/**
 * Generate the statements for a CREATE TABLE in the yard. Always:
 *   - adds `id uuid primary key default gen_random_uuid()` + `created_at
 *     timestamptz default now()` (reserved; agents can't override),
 *   - `CREATE TABLE IF NOT EXISTS`,
 *   - `ENABLE ROW LEVEL SECURITY` (forced, every table),
 *   - any requested indexes (IF NOT EXISTS).
 */
export function generateCreateTable(input: unknown): GeneratedDdl {
	const spec = tableSpecSchema.parse(input);

	const reserved: ColumnSpec[] = [
		{ name: "id", type: "uuid", required: true, default: "gen_random_uuid()" },
		{
			name: "created_at",
			type: "timestamptz",
			required: true,
			default: "now()",
		},
	];
	const allColumns = [...reserved, ...spec.columns];

	const colDefs = [
		`${q("id")} uuid primary key default gen_random_uuid()`,
		`${q("created_at")} timestamptz not null default now()`,
		...spec.columns.map(columnDefinition),
	];

	const statements: string[] = [
		`create table if not exists ${qualified(spec.name)} (\n  ${colDefs.join(",\n  ")}\n);`,
		`alter table ${qualified(spec.name)} enable row level security;`,
	];

	for (const idx of spec.indexes ?? []) {
		const idxName = indexName(spec.name, idx.columns, idx.unique ?? false);
		const cols = idx.columns.map(q).join(", ");
		const unique = idx.unique ? "unique " : "";
		statements.push(
			`create ${unique}index if not exists ${q(idxName)} on ${qualified(spec.name)} (${cols});`,
		);
	}

	return { statements, shape: shapeOf(spec.name, allColumns) };
}

/** Generate an additive ALTER TABLE ADD COLUMN for an existing yard table. */
export function generateAddColumn(
	tableInput: unknown,
	columnInput: unknown,
): {
	statements: string[];
	table: string;
	column: TableShape["columns"][number];
} {
	const table = slug("table name").parse(tableInput);
	const col = columnSpecSchema.parse(columnInput);
	const statements = [
		`alter table ${qualified(table)} add column if not exists ${columnDefinition(col)};`,
	];
	return {
		statements,
		table,
		column: {
			name: col.name,
			type: col.type,
			required: !!col.required,
			default:
				col.default !== undefined ? renderDefault(col.type, col.default) : null,
		},
	};
}

/** Deterministic, slug-safe index name from table + columns. */
function indexName(table: string, columns: string[], unique: boolean): string {
	const base = `${table}_${columns.join("_")}_${unique ? "uniq" : "idx"}`;
	// Keep within the 63-byte identifier limit.
	return base.slice(0, 63);
}

function shapeOf(table: string, columns: ColumnSpec[]): TableShape {
	return {
		schema: YARD_SCHEMA,
		table,
		columns: columns.map((c) => ({
			name: c.name,
			type: c.type,
			required: !!c.required,
			default:
				c.default !== undefined ? renderDefault(c.type, c.default) : null,
		})),
	};
}
