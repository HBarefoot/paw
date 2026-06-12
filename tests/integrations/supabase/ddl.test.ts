import { describe, expect, test } from "bun:test";
import {
	generateAddColumn,
	generateCreateTable,
	renderDefault,
} from "../../../src/integrations/supabase/ddl.js";

// The DDL generator is the heart of "safe by construction": prove that valid
// specs produce schema-qualified, RLS-forced, idempotent DDL, and that hostile
// or malformed specs are rejected at validation BEFORE any SQL is built.

describe("generateCreateTable — DDL snapshot", () => {
	const gen = generateCreateTable({
		name: "waitlist_signups",
		columns: [
			{ name: "email", type: "text", required: true },
			{ name: "referrer", type: "text" },
			{ name: "score", type: "integer", default: 0 },
		],
		indexes: [{ columns: ["email"], unique: true }],
	});
	const sql = gen.statements.join("\n");

	test("schema-qualifies every object to the canvas yard", () => {
		expect(sql).toContain('"canvas"."waitlist_signups"');
		// never an unqualified or public-qualified table.
		expect(sql).not.toContain('"public"."waitlist_signups"');
		expect(sql).not.toMatch(/create table if not exists "waitlist_signups"/);
	});

	test("is idempotent (IF NOT EXISTS) and forces Row Level Security", () => {
		expect(sql).toContain("create table if not exists");
		expect(sql).toContain(
			'alter table "canvas"."waitlist_signups" enable row level security;',
		);
	});

	test("auto-adds id + created_at and the requested columns", () => {
		expect(sql).toContain('"id" uuid primary key default gen_random_uuid()');
		expect(sql).toContain('"created_at" timestamptz not null default now()');
		expect(sql).toContain('"email" text not null');
		expect(sql).toContain('"referrer" text');
		expect(sql).toContain('"score" integer default 0');
	});

	test("emits the requested index, schema-qualified and unique", () => {
		expect(sql).toContain(
			'create unique index if not exists "waitlist_signups_email_uniq" on "canvas"."waitlist_signups" ("email")',
		);
	});

	test("returns the resolved shape (incl. auto columns)", () => {
		expect(gen.shape.schema).toBe("canvas");
		expect(gen.shape.table).toBe("waitlist_signups");
		expect(gen.shape.columns.map((c) => c.name)).toEqual([
			"id",
			"created_at",
			"email",
			"referrer",
			"score",
		]);
	});
});

describe("generateCreateTable — spec validation", () => {
	test("rejects an invalid column type with a clear message", () => {
		expect(() =>
			generateCreateTable({
				name: "t",
				columns: [{ name: "c", type: "varchar" }],
			}),
		).toThrow(/Invalid (enum|option)|expected one of|type/i);
	});

	test("rejects a non-slug table name", () => {
		expect(() =>
			generateCreateTable({
				name: "Bad Name",
				columns: [{ name: "c", type: "text" }],
			}),
		).toThrow(/slug/i);
	});

	test("rejects a reserved column name (id/created_at are auto-added)", () => {
		expect(() =>
			generateCreateTable({
				name: "t",
				columns: [{ name: "id", type: "uuid" }],
			}),
		).toThrow(/reserved/i);
	});

	test("rejects duplicate columns", () => {
		expect(() =>
			generateCreateTable({
				name: "t",
				columns: [
					{ name: "a", type: "text" },
					{ name: "a", type: "integer" },
				],
			}),
		).toThrow(/duplicate/i);
	});

	test("rejects an index over a column that doesn't exist", () => {
		expect(() =>
			generateCreateTable({
				name: "t",
				columns: [{ name: "a", type: "text" }],
				indexes: [{ columns: ["nope"] }],
			}),
		).toThrow(/unknown column/i);
	});

	test("requires at least one column", () => {
		expect(() => generateCreateTable({ name: "t", columns: [] })).toThrow();
	});

	test("rejects unknown spec keys (strict)", () => {
		expect(() =>
			generateCreateTable({
				name: "t",
				columns: [{ name: "a", type: "text" }],
				rawSql: "DROP TABLE x", // an attacker-ish extra field
			}),
		).toThrow();
	});
});

describe("SQL-injection attempts are rejected at validation, never built", () => {
	const HOSTILE = '"x" text); drop table canvas.users; --';

	test("hostile column name fails the slug guard (no DDL produced)", () => {
		let built = false;
		try {
			generateCreateTable({
				name: "t",
				columns: [{ name: HOSTILE, type: "text" }],
			});
			built = true;
		} catch (err) {
			expect(String(err)).toMatch(/slug/i);
		}
		expect(built).toBe(false);
	});

	test("hostile table name fails the slug guard", () => {
		expect(() =>
			generateCreateTable({
				name: HOSTILE,
				columns: [{ name: "a", type: "text" }],
			}),
		).toThrow(/slug/i);
	});

	test("a string default never executes — it is encoded as a literal", () => {
		const gen = generateCreateTable({
			name: "t",
			columns: [
				{ name: "note", type: "text", default: "'); DROP TABLE x; --" },
			],
		});
		const sql = gen.statements.join("\n");
		// The quotes are doubled => inert string literal, not a statement break.
		expect(sql).toContain("default '''); DROP TABLE x; --'");
		expect(sql).not.toContain("DROP TABLE x;\n");
	});
});

describe("renderDefault — closed default set, type-checked literals", () => {
	test("whitelisted function defaults only where they make sense", () => {
		expect(renderDefault("timestamptz", "now()")).toBe("now()");
		expect(renderDefault("uuid", "gen_random_uuid()")).toBe(
			"gen_random_uuid()",
		);
		expect(() => renderDefault("text", "now()")).toThrow(); // now() not a text literal-fn
		expect(() => renderDefault("integer", "gen_random_uuid()")).toThrow();
	});

	test("type-checked literals", () => {
		expect(renderDefault("integer", 5)).toBe("5");
		expect(renderDefault("boolean", true)).toBe("true");
		expect(renderDefault("numeric", "3.14")).toBe("3.14");
		expect(renderDefault("text", "hi")).toBe("'hi'");
		expect(renderDefault("jsonb", '{"a":1}')).toBe(`'{"a":1}'::jsonb`);
	});

	test("rejects literals that don't match the type", () => {
		expect(() => renderDefault("integer", "not-a-number")).toThrow(/integer/i);
		expect(() => renderDefault("boolean", "maybe")).toThrow(/boolean/i);
		expect(() => renderDefault("uuid", "nope")).toThrow(/uuid/i);
		expect(() => renderDefault("jsonb", "{bad json}")).toThrow(/json/i);
	});
});

describe("generateAddColumn — additive ALTER", () => {
	test("schema-qualified ADD COLUMN IF NOT EXISTS", () => {
		const gen = generateAddColumn("waitlist_signups", {
			name: "source",
			type: "text",
		});
		expect(gen.statements[0]).toBe(
			'alter table "canvas"."waitlist_signups" add column if not exists "source" text;',
		);
		expect(gen.column).toEqual({
			name: "source",
			type: "text",
			required: false,
			default: null,
		});
	});

	test("rejects a hostile column name", () => {
		expect(() =>
			generateAddColumn("t", { name: '"x"; drop table y', type: "text" }),
		).toThrow(/slug/i);
	});
});
