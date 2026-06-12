import { describe, expect, test } from "bun:test";
import type { DdlExecutor } from "../../../src/integrations/supabase/provisioner.js";
import { createSupabaseProvisioningTools } from "../../../src/integrations/supabase/provisioning-tools.js";
import type { ToolDefinition } from "../../../src/types/message.js";

// Tools wired to a MOCKED executor (no live Postgres). Prove: a valid spec
// reaches the executor as generator-built DDL, audits, and returns the shape; a
// bad/hostile spec is rejected at the boundary and the executor is NEVER called;
// an executor failure surfaces as a tool error and a .fail audit.

interface ExecCall {
	statements: string[];
}
function fakeExecutor(opts: { fail?: string } = {}): {
	exec: DdlExecutor;
	calls: ExecCall[];
} {
	const calls: ExecCall[] = [];
	const exec: DdlExecutor = {
		async exec(statements) {
			calls.push({ statements });
			if (opts.fail) throw new Error(opts.fail);
		},
		async close() {},
	};
	return { exec, calls };
}

function makeTools(opts: { fail?: string } = {}) {
	const { exec, calls } = fakeExecutor(opts);
	const audits: Array<{ action: string; details: Record<string, unknown> }> =
		[];
	const tools = createSupabaseProvisioningTools({
		exec,
		audit: (action, details) => audits.push({ action, details }),
	});
	const get = (name: string) =>
		tools.find((t) => t.name === name) as ToolDefinition;
	return { calls, audits, get };
}

describe("supabase_create_table tool", () => {
	test("valid spec → executes generated DDL, audits ok, returns shape", async () => {
		const { calls, audits, get } = makeTools();
		const out = await get("supabase_create_table").handler({
			name: "leads",
			columns: [{ name: "email", type: "text", required: true }],
		});
		expect(out.is_error).toBeFalsy();
		const body = JSON.parse(out.content as string);
		expect(body.created).toBe(true);
		expect(body.schema).toBe("canvas");
		expect(body.shape.columns.map((c: { name: string }) => c.name)).toEqual([
			"id",
			"created_at",
			"email",
		]);
		// Exactly the generated statements were executed (RLS forced).
		expect(calls).toHaveLength(1);
		const sql = calls[0].statements.join("\n");
		expect(sql).toContain('create table if not exists "canvas"."leads"');
		expect(sql).toContain("enable row level security");
		// Audit recorded the generated statements.
		expect(audits[0].action).toBe("supabase.provision.create_table.ok");
		expect(audits[0].details.statements).toEqual(calls[0].statements);
	});

	test("invalid spec → tool error, executor NOT called", async () => {
		const { calls, audits, get } = makeTools();
		const out = await get("supabase_create_table").handler({
			name: "leads",
			columns: [{ name: "c", type: "varchar" }], // not in the closed type set
		});
		expect(out.is_error).toBe(true);
		expect(out.content).toMatch(/invalid table spec/i);
		expect(calls).toHaveLength(0);
		expect(audits).toHaveLength(0);
	});

	test("injection via column name → rejected, never reaches executor", async () => {
		const { calls, get } = makeTools();
		const out = await get("supabase_create_table").handler({
			name: "leads",
			columns: [
				{ name: '"x" text); drop table canvas.users; --', type: "text" },
			],
		});
		expect(out.is_error).toBe(true);
		expect(out.content).toMatch(/slug/i);
		expect(calls).toHaveLength(0);
	});

	test("executor failure → tool error + .fail audit", async () => {
		const { calls, audits, get } = makeTools({
			fail: "permission denied for schema public",
		});
		const out = await get("supabase_create_table").handler({
			name: "leads",
			columns: [{ name: "email", type: "text" }],
		});
		expect(out.is_error).toBe(true);
		expect(out.content).toMatch(/permission denied/i);
		expect(calls).toHaveLength(1); // it tried
		expect(audits[0].action).toBe("supabase.provision.create_table.fail");
		expect(audits[0].details.error).toMatch(/permission denied/i);
	});
});

describe("supabase_add_column tool", () => {
	test("valid → additive ALTER executed + audited", async () => {
		const { calls, audits, get } = makeTools();
		const out = await get("supabase_add_column").handler({
			table: "leads",
			column: { name: "source", type: "text" },
		});
		expect(out.is_error).toBeFalsy();
		expect(calls[0].statements[0]).toContain(
			'alter table "canvas"."leads" add column if not exists "source" text',
		);
		expect(audits[0].action).toBe("supabase.provision.add_column.ok");
	});

	test("invalid column → error, executor untouched", async () => {
		const { calls, get } = makeTools();
		const out = await get("supabase_add_column").handler({
			table: "leads",
			column: { name: "x", type: "jsonb", default: "{not json}" },
		});
		expect(out.is_error).toBe(true);
		expect(calls).toHaveLength(0);
	});
});

describe("no destructive tools are exposed", () => {
	test("only create_table + add_column (no drop/truncate/alter-type)", () => {
		const { get: _g } = makeTools();
		const { exec } = fakeExecutor();
		const names = createSupabaseProvisioningTools({ exec }).map((t) => t.name);
		expect(names.sort()).toEqual([
			"supabase_add_column",
			"supabase_create_table",
		]);
		expect(names.some((n) => /drop|truncate|alter_type/.test(n))).toBe(false);
	});

	test("group under the on-demand `supabase` skill", () => {
		const { exec } = fakeExecutor();
		for (const t of createSupabaseProvisioningTools({ exec })) {
			expect(t.plugin).toBe("supabase");
		}
	});
});
