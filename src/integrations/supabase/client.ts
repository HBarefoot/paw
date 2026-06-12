/**
 * Minimal Supabase client over PostgREST (`/rest/v1`) using the service-role
 * key. Mirrors the StrapiClient/HubSpotClient shape (fetch + AbortController
 * timeout + typed errors). Filters are expressed with a typed operator subset
 * (eq/neq/gt/lt/like/in) mapped to PostgREST query params — never a raw query
 * string. Destructive ops (update/delete) require non-empty filters.
 */

import {
	type SupabaseClientConfig,
	SupabaseError,
	type SupabaseFilter,
	SupabaseTimeoutError,
} from "./types.js";

/** Minimal shape of the PostgREST OpenAPI/swagger doc we read for introspection. */
interface OpenApiProp {
	type?: string;
	format?: string;
}
interface OpenApiSchema {
	properties?: Record<string, OpenApiProp>;
}
interface OpenApiDoc {
	definitions?: Record<string, OpenApiSchema>;
	components?: { schemas?: Record<string, OpenApiSchema> };
}

/** PostgREST identifiers (table / function / column names). Defense-in-depth. */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifier(kind: string, name: string): string {
	if (!IDENTIFIER_RE.test(name)) {
		throw new Error(`Invalid Supabase ${kind} "${name}".`);
	}
	return name;
}

export class SupabaseClient {
	private readonly baseUrl: string;
	private readonly serviceKey: string;
	private readonly timeout: number;

	constructor(config: SupabaseClientConfig) {
		if (!config.url) throw new Error("Supabase url is required.");
		if (!config.serviceKey) throw new Error("Supabase serviceKey is required.");
		// REST root, trailing slash stripped: <url>/rest/v1
		this.baseUrl = `${config.url.replace(/\/+$/, "")}/rest/v1`;
		this.serviceKey = config.serviceKey;
		this.timeout = config.timeout ?? 10_000;
	}

	/** Read rows. `columns` defaults to all; `filters`/`limit` optional. */
	async select(
		table: string,
		opts: {
			columns?: string[];
			filters?: SupabaseFilter[];
			limit?: number;
		} = {},
	): Promise<unknown[]> {
		assertIdentifier("table", table);
		const parts: string[] = [];
		const cols = (opts.columns ?? []).map((c) => assertIdentifier("column", c));
		parts.push(`select=${cols.length ? cols.join(",") : "*"}`);
		parts.push(...encodeFilters(opts.filters ?? []));
		if (opts.limit !== undefined) parts.push(`limit=${Number(opts.limit)}`);
		const url = `${this.baseUrl}/${table}?${parts.join("&")}`;
		return this.request<unknown[]>(url, "GET");
	}

	/** Insert one or many rows; returns the inserted representation. */
	async insert(
		table: string,
		rows: Record<string, unknown> | Record<string, unknown>[],
	): Promise<unknown[]> {
		assertIdentifier("table", table);
		const url = `${this.baseUrl}/${table}`;
		return this.request<unknown[]>(url, "POST", rows, {
			Prefer: "return=representation",
		});
	}

	/** Update rows matching `filters` (REQUIRED) with `values`. */
	async update(
		table: string,
		filters: SupabaseFilter[],
		values: Record<string, unknown>,
	): Promise<unknown[]> {
		assertIdentifier("table", table);
		assertFilters("update", filters);
		const url = `${this.baseUrl}/${table}?${encodeFilters(filters).join("&")}`;
		return this.request<unknown[]>(url, "PATCH", values, {
			Prefer: "return=representation",
		});
	}

	/** Delete rows matching `filters` (REQUIRED). */
	async delete(table: string, filters: SupabaseFilter[]): Promise<unknown[]> {
		assertIdentifier("table", table);
		assertFilters("delete", filters);
		const url = `${this.baseUrl}/${table}?${encodeFilters(filters).join("&")}`;
		return this.request<unknown[]>(url, "DELETE", undefined, {
			Prefer: "return=representation",
		});
	}

	/** Call a Postgres function via PostgREST RPC. */
	async rpc(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
		assertIdentifier("function", fn);
		const url = `${this.baseUrl}/rpc/${fn}`;
		return this.request<unknown>(url, "POST", args);
	}

	/**
	 * Introspect the exposed schemas via PostgREST's OpenAPI document at the REST
	 * root (`<url>/rest/v1/`). Returns the tables/views on each requested schema
	 * with their columns + types — so the agent can discover what exists instead
	 * of guessing names into 404s. Read-only; queries the root, so it never
	 * touches the table-identifier guard, and `information_schema` stays
	 * unreachable (PostgREST doesn't expose it and dotted names are rejected).
	 *
	 * Each schema is fetched separately via PostgREST's `Accept-Profile` header
	 * (the root OpenAPI doc describes one schema at a time). `public` plus the
	 * agent's yard (`canvas`) by default. A schema that isn't exposed yet (e.g.
	 * `canvas` before the operator flips the dashboard setting) is skipped rather
	 * than failing the whole listing, so the tool degrades gracefully.
	 */
	async listTables(schemas: string[] = ["public", "canvas"]): Promise<{
		tables: Array<{
			schema: string;
			name: string;
			columns: Array<{ name: string; type: string }>;
		}>;
	}> {
		const tables: Array<{
			schema: string;
			name: string;
			columns: Array<{ name: string; type: string }>;
		}> = [];
		for (const schema of schemas) {
			let doc: OpenApiDoc;
			try {
				// `public` is the default profile; only send the header for others so
				// an old PostgREST without profile support keeps working for public.
				const headers =
					schema === "public" ? undefined : { "Accept-Profile": schema };
				doc = await this.request<OpenApiDoc>(
					`${this.baseUrl}/`,
					"GET",
					undefined,
					headers,
				);
			} catch {
				// Schema not exposed (406) or unreachable — skip it, keep the rest.
				continue;
			}
			// PostgREST v2 swagger uses `definitions`; OpenAPI 3 uses
			// `components.schemas`. Each key is an exposed table/view; RPC functions
			// live under `paths` (/rpc/*), not here.
			const defs: Record<string, OpenApiSchema> = {
				...(doc?.definitions ?? {}),
				...(doc?.components?.schemas ?? {}),
			};
			for (const [name, def] of Object.entries(defs)) {
				const props = def?.properties ?? {};
				const columns = Object.entries(props).map(([col, p]) => ({
					name: col,
					// `format` carries the Postgres type (e.g. uuid, timestamp with
					// time zone); `type` is the coarser JSON type — prefer format.
					type: String(p?.format ?? p?.type ?? "unknown"),
				}));
				tables.push({ schema, name, columns });
			}
		}
		return { tables };
	}

	private async request<T>(
		url: string,
		method: string,
		body?: unknown,
		extraHeaders?: Record<string, string>,
	): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);
		try {
			const res = await fetch(url, {
				method,
				signal: controller.signal,
				redirect: "error",
				headers: {
					apikey: this.serviceKey,
					Authorization: `Bearer ${this.serviceKey}`,
					"Content-Type": "application/json",
					...extraHeaders,
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new SupabaseError(
					`Supabase ${method} ${url} failed: ${res.status} ${res.statusText}${
						text ? ` — ${text.slice(0, 300)}` : ""
					}`,
					res.status,
					res.statusText,
				);
			}
			// DELETE/empty bodies can return no content.
			const raw = await res.text();
			return (raw ? JSON.parse(raw) : null) as T;
		} catch (err) {
			if (err instanceof SupabaseError) throw err;
			if (err instanceof DOMException && err.name === "AbortError") {
				throw new SupabaseTimeoutError(
					`Supabase request timed out after ${this.timeout}ms: ${method} ${url}`,
				);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}
}

function assertFilters(
	op: string,
	filters: SupabaseFilter[] | undefined,
): void {
	if (!filters || filters.length === 0) {
		throw new Error(
			`Supabase ${op} requires at least one filter — refusing an unfiltered ${op} (it would affect every row).`,
		);
	}
}

/** Map the typed filter subset to PostgREST `column=op.value` query params. */
function encodeFilters(filters: SupabaseFilter[]): string[] {
	return filters.map((f) => {
		const col = assertIdentifier("column", f.column);
		if (f.op === "in") {
			const vals = Array.isArray(f.value) ? f.value : [f.value];
			const list = vals.map((v) => encodeURIComponent(String(v))).join(",");
			return `${col}=in.(${list})`;
		}
		return `${col}=${f.op}.${encodeURIComponent(String(f.value))}`;
	});
}
