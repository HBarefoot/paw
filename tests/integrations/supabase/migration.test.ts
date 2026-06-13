import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Parse-check the operator-applied migration WITHOUT a live database: assert the
// structural invariants that make the "fenced yard" a fence. A real Postgres
// parser is overkill (and pulls a dep that doesn't model role/grant DDL well);
// these checks are the documented gate that the role stays least-privilege and
// the file never regresses into a wider grant or a committed credential.

const MIGRATION_PATH = fileURLToPath(
	new URL(
		"../../../src/integrations/supabase/migrations/001_canvas_yard.sql",
		import.meta.url,
	),
);
const sql = readFileSync(MIGRATION_PATH, "utf8");
// Normalize whitespace for forgiving substring/regex matching.
const flat = sql.replace(/\s+/g, " ").toLowerCase();
// Same, but with `--` line comments stripped — for checks that scan actual
// statements (so prose in comments can't trip a grant/keyword matcher).
const code = sql
	.replace(/--[^\n]*/g, "")
	.replace(/\s+/g, " ")
	.toLowerCase();

describe("001_canvas_yard.sql — structural validity", () => {
	test("balanced parentheses and a closed dollar-quoted block", () => {
		const opens = (sql.match(/\(/g) ?? []).length;
		const closes = (sql.match(/\)/g) ?? []).length;
		expect(opens).toBe(closes);
		// The DO $$ ... $$ block must open and close evenly.
		const dollars = (sql.match(/\$\$/g) ?? []).length;
		expect(dollars % 2).toBe(0);
		expect(dollars).toBeGreaterThanOrEqual(2);
	});

	test("statements are terminated (no dangling final statement)", () => {
		// Strip comments + dollar-quoted bodies, then the remaining non-empty
		// trimmed text must end in a semicolon.
		const stripped = sql
			.replace(/--[^\n]*/g, "")
			.replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
			.trim();
		expect(stripped.endsWith(";")).toBe(true);
	});

	test("creates the canvas schema", () => {
		expect(flat).toContain("create schema if not exists canvas");
	});

	test("creates paw_builder as a non-escalating login role", () => {
		expect(flat).toContain("create role paw_builder login");
		// NOSUPERUSER is set at CREATE time (allowed: issuper=false needs only
		// CREATEROLE). The CREATEDB/CREATEROLE guards are re-asserted via ALTER.
		expect(flat).toMatch(
			/create role paw_builder login nosuperuser nocreatedb nocreaterole/,
		);
		expect(flat).toMatch(/alter role paw_builder nocreatedb nocreaterole/);
	});

	test("never ALTERs the superuser attribute (hosted-Supabase compat)", () => {
		// REGRESSION: `alter role ... [no]superuser` fails on Supabase with 42501
		// (the project's postgres role is not a true superuser, and changing the
		// SUPERUSER attribute — even to NO — requires real superuser), which would
		// abort the whole migration. Non-superuser-ness is set at CREATE time and
		// verified via pg_roles (rolsuper = f), never re-applied via ALTER ROLE.
		expect(code).not.toMatch(/alter\s+role[^;]*\bnosuperuser\b/);
		expect(code).not.toMatch(/alter\s+role[^;]*\bsuperuser\b/);
	});

	test("grants USAGE + CREATE on canvas ONLY", () => {
		expect(flat).toContain(
			"grant usage, create on schema canvas to paw_builder",
		);
	});

	test("never grants paw_builder anything on a privileged schema", () => {
		// No GRANT ... to paw_builder targeting public/auth/storage/graphql_public.
		const grantsToBuilder = [
			...code.matchAll(/grant[^;]*?to[^;]*?paw_builder/g),
		].map((m) => m[0]);
		for (const g of grantsToBuilder) {
			for (const forbidden of ["public", "auth", "storage", "graphql_public"]) {
				expect(g).not.toContain(`schema ${forbidden}`);
			}
		}
		// And the only schema paw_builder may CREATE in is `canvas`.
		const createGrants = grantsToBuilder.filter((g) => g.includes("create"));
		for (const g of createGrants) {
			expect(g).toContain("canvas");
		}
	});

	test("explicitly revokes public-schema access from paw_builder", () => {
		expect(flat).toContain("revoke all on schema public from paw_builder");
	});

	test("does NOT broadly rewrite PUBLIC pseudo-role grants (non-invasive)", () => {
		// Guard against re-introducing the invasive database-wide revoke.
		expect(flat).not.toContain("revoke all on schema public from public");
	});

	test("sets sane default privileges for the CRUD roles, not anon", () => {
		expect(flat).toMatch(/alter default privileges for role paw_builder/);
		// CRUD roles get table rights…
		const defaultPrivBlock = flat.slice(
			flat.indexOf("alter default privileges"),
		);
		expect(defaultPrivBlock).toContain("to service_role");
		expect(defaultPrivBlock).toContain("authenticated");
		// …anon does NOT (v1 pages are write-only).
		expect(defaultPrivBlock).not.toMatch(/on tables to [^;]*\banon\b/);
	});

	test("contains no committed password literal", () => {
		// The role is created WITHOUT a password; a password must never be baked in.
		expect(flat).not.toMatch(/create role paw_builder[^;]*password/);
		expect(flat).not.toMatch(/password\s+'[^']+'/);
	});
});
