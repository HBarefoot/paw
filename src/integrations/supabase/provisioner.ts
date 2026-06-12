/**
 * DDL executor for the fenced yard. Opens a direct Postgres connection over the
 * scoped `paw_builder` DSN (Bun's built-in client — zero extra dependencies)
 * and runs the statements the generator (ddl.ts) produced, inside ONE
 * transaction so a multi-statement create (table + RLS + indexes) is atomic.
 *
 * Why a direct connection and not the Supabase management/query API: the
 * management API needs an account-level PAT that can touch any project — that
 * would defeat the blast-radius separation. The `paw_builder` role's privileges
 * are confined to schema `canvas` by Postgres itself (see migration 001), so
 * even though `unsafe()` runs a pre-built string, that string can only ever do
 * what `paw_builder` is granted — and it is only ever fed VALIDATED, generator-
 * built DDL, never agent SQL.
 */

import { SQL } from "bun";

/** Minimal seam the provisioning tools depend on — mockable in tests. */
export interface DdlExecutor {
	/** Run all statements in a single transaction; rolls back on any error. */
	exec(statements: string[]): Promise<void>;
	/** Close the underlying connection pool. */
	close(): Promise<void>;
}

export class SupabaseProvisioner implements DdlExecutor {
	private readonly sql: SQL;

	constructor(dsn: string, opts: { max?: number; timeout?: number } = {}) {
		if (!dsn) throw new Error("Supabase builderDsn is required.");
		this.sql = new SQL({
			url: dsn,
			// Schema changes are rare and serialized — a tiny pool is plenty and
			// keeps the scoped role's connection footprint minimal.
			max: opts.max ?? 1,
			// Seconds (Bun.sql units). Fail fast rather than hang a tool call.
			connectionTimeout: Math.ceil((opts.timeout ?? 10_000) / 1000),
		});
	}

	async exec(statements: string[]): Promise<void> {
		await this.sql.begin(async (tx) => {
			for (const statement of statements) {
				await tx.unsafe(statement);
			}
		});
	}

	async close(): Promise<void> {
		await this.sql.end();
	}
}
