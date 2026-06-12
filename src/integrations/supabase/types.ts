/**
 * Supabase integration types. The agent talks to a project's PostgREST API
 * (`/rest/v1`) authenticated with the service-role key, which is overlaid from
 * the vault (slot `supabase.serviceKey`) and never reaches the model.
 *
 * Filters use a small, typed operator subset mapped onto PostgREST query params
 * — we deliberately do NOT expose raw query strings, so the agent can't smuggle
 * arbitrary PostgREST expressions.
 */

export interface SupabaseClientConfig {
	url: string;
	serviceKey: string;
	timeout?: number;
}

/** The PostgREST operators the agent is allowed to use. */
export type SupabaseFilterOp = "eq" | "neq" | "gt" | "lt" | "like" | "in";

export const SUPABASE_FILTER_OPS: SupabaseFilterOp[] = [
	"eq",
	"neq",
	"gt",
	"lt",
	"like",
	"in",
];

export interface SupabaseFilter {
	column: string;
	op: SupabaseFilterOp;
	/** Scalar for most ops; an array (or comma list) for `in`. */
	value: unknown;
}

export class SupabaseError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly statusText: string,
	) {
		super(message);
		this.name = "SupabaseError";
	}
}

export class SupabaseTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SupabaseTimeoutError";
	}
}
