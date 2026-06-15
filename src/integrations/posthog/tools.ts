import type { ToolDefinition, ToolResult } from "../../types/message.js";
import type { PostHogClient } from "./client.js";
import { POSTHOG_MAX_ROWS, type QueryResult } from "./types.js";

/**
 * PostHog tools — the agent's READ-ONLY view of published-page traffic.
 *
 * All metrics are HogQL queries through the Query API; there are no writes, so
 * nothing is approval-gated. Grouped under the on-demand `posthog` skill via
 * `plugin: "posthog"`. The personal API key never appears in any tool output —
 * it lives only in the server-side Bearer header inside the client.
 *
 * Tools: posthog_top_pages, posthog_pageviews, posthog_top_referrers,
 * posthog_event_counts, posthog_funnel, and a constrained read-only
 * posthog_query (HogQL escape hatch).
 */

/** Safe `timestamp >= …` clauses keyed by an allowlisted dateRange token. */
const RANGE_CLAUSE: Record<string, string> = {
	"24h": "timestamp >= now() - INTERVAL 24 HOUR",
	"7d": "timestamp >= now() - INTERVAL 7 DAY",
	"30d": "timestamp >= now() - INTERVAL 30 DAY",
	"90d": "timestamp >= now() - INTERVAL 90 DAY",
};
const DEFAULT_RANGE = "7d";

function rangeClause(input: unknown): string {
	const r = typeof input === "string" && input ? input : DEFAULT_RANGE;
	const clause = RANGE_CLAUSE[r];
	if (!clause)
		throw new Error(
			`invalid dateRange "${r}" — use one of ${Object.keys(RANGE_CLAUSE).join(", ")}`,
		);
	return clause;
}

/** Validate a URL path so it can be safely single-quoted into HogQL. */
function safePath(input: unknown): string {
	const p = String(input);
	if (!/^[\w\-./?=&%#:~]*$/.test(p))
		throw new Error(`invalid path filter "${p}"`);
	return p;
}

/** Validate an event name so it can be safely single-quoted into HogQL. */
function safeEvent(input: unknown): string {
	const n = String(input);
	if (!/^[\w$.\- ]+$/.test(n)) throw new Error(`invalid event name "${n}"`);
	return n;
}

function clampLimit(input: unknown, def = 20): number {
	const n = Math.floor(Number(input));
	if (!Number.isFinite(n) || n <= 0) return def;
	return Math.min(n, POSTHOG_MAX_ROWS);
}

/** Shape a QueryResult's rows into column-keyed objects for the model. */
function rowsToObjects(qr: QueryResult): Array<Record<string, unknown>> {
	return qr.results.map((row) => {
		const obj: Record<string, unknown> = {};
		qr.columns.forEach((col, i) => {
			obj[col] = row[i];
		});
		return obj;
	});
}

/**
 * Enforce read-only HogQL for the freeform query tool: must start with
 * SELECT/WITH, must contain no mutating/DDL keyword, and gets a LIMIT appended
 * when one is absent so it can never run unbounded.
 */
export function guardReadOnlyHogQL(raw: string): string {
	const sql = raw.trim().replace(/;+\s*$/, "");
	if (!/^(select|with)\b/i.test(sql))
		throw new Error("only read-only SELECT/WITH queries are allowed");
	if (
		/\b(insert|update|delete|alter|drop|create|truncate|attach|detach|grant|revoke|optimize|system|set)\b/i.test(
			sql,
		)
	)
		throw new Error("the query contains a non-read-only keyword");
	return /\blimit\b/i.test(sql) ? sql : `${sql} LIMIT ${POSTHOG_MAX_ROWS}`;
}

export function createPostHogTools(client: PostHogClient): ToolDefinition[] {
	const errResult = (err: unknown): ToolResult => ({
		content: `PostHog error: ${err instanceof Error ? err.message : String(err)}`,
		is_error: true,
	});

	const range: Record<string, unknown> = {
		dateRange: {
			type: "string",
			enum: ["24h", "7d", "30d", "90d"],
			description: "Lookback window. Default 7d.",
		},
	};

	const topPages: ToolDefinition = {
		name: "posthog_top_pages",
		description:
			"Most-viewed pages of the published site over a window. Returns [{ path, views }] ranked by pageviews. Use this to see what's actually getting traffic.",
		plugin: "posthog",
		input_schema: {
			type: "object",
			properties: {
				...range,
				limit: { type: "number", description: "Max rows (default 20)." },
			},
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const qr = await client.query(
					`SELECT properties.$pathname AS path, count() AS views
					 FROM events WHERE event = '$pageview' AND ${rangeClause(input.dateRange)}
					 GROUP BY path ORDER BY views DESC LIMIT ${clampLimit(input.limit)}`,
				);
				return { content: JSON.stringify({ pages: rowsToObjects(qr) }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const pageviews: ToolDefinition = {
		name: "posthog_pageviews",
		description:
			"Daily pageview counts over a window, optionally filtered to a single path. Returns [{ day, views }] for trend analysis.",
		plugin: "posthog",
		input_schema: {
			type: "object",
			properties: {
				...range,
				path: {
					type: "string",
					description: "Optional exact pathname filter, e.g. /pricing.",
				},
			},
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const filter =
					input.path !== undefined && input.path !== ""
						? ` AND properties.$pathname = '${safePath(input.path)}'`
						: "";
				const qr = await client.query(
					`SELECT toDate(timestamp) AS day, count() AS views
					 FROM events WHERE event = '$pageview' AND ${rangeClause(input.dateRange)}${filter}
					 GROUP BY day ORDER BY day LIMIT ${POSTHOG_MAX_ROWS}`,
				);
				return { content: JSON.stringify({ days: rowsToObjects(qr) }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const topReferrers: ToolDefinition = {
		name: "posthog_top_referrers",
		description:
			"Top referring domains driving pageviews over a window. Returns [{ referrer, views }] — where your traffic comes from.",
		plugin: "posthog",
		input_schema: {
			type: "object",
			properties: {
				...range,
				limit: { type: "number", description: "Max rows (default 20)." },
			},
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const qr = await client.query(
					`SELECT properties.$referring_domain AS referrer, count() AS views
					 FROM events WHERE event = '$pageview' AND ${rangeClause(input.dateRange)}
					 GROUP BY referrer ORDER BY views DESC LIMIT ${clampLimit(input.limit)}`,
				);
				return { content: JSON.stringify({ referrers: rowsToObjects(qr) }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const eventCounts: ToolDefinition = {
		name: "posthog_event_counts",
		description:
			"Event volume over a window. With no name, returns the top events as [{ event, count }]; with a name, returns just that event's count. Use to check custom conversion events (signups, clicks, …).",
		plugin: "posthog",
		input_schema: {
			type: "object",
			properties: {
				...range,
				name: {
					type: "string",
					description: "Optional exact event name to count.",
				},
				limit: { type: "number", description: "Max rows (default 20)." },
			},
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const filter =
					input.name !== undefined && input.name !== ""
						? ` AND event = '${safeEvent(input.name)}'`
						: "";
				const qr = await client.query(
					`SELECT event, count() AS count
					 FROM events WHERE ${rangeClause(input.dateRange)}${filter}
					 GROUP BY event ORDER BY count DESC LIMIT ${clampLimit(input.limit)}`,
				);
				return { content: JSON.stringify({ events: rowsToObjects(qr) }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const funnel: ToolDefinition = {
		name: "posthog_funnel",
		description:
			"Approximate funnel over page paths: unique visitors who viewed each step's path within the window, in the given order. Returns [{ step, path, visitors }]. NOTE: per-step volume (not strictly sequential) — good for spotting the biggest drop-off.",
		plugin: "posthog",
		input_schema: {
			type: "object",
			properties: {
				...range,
				steps: {
					type: "array",
					items: { type: "string" },
					description:
						"Ordered list of page paths, e.g. ['/', '/pricing', '/signup'].",
				},
			},
			required: ["steps"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const steps = Array.isArray(input.steps)
					? (input.steps as unknown[]).map((s) => safePath(s))
					: [];
				if (steps.length === 0)
					throw new Error("steps must be a non-empty array of paths");
				if (steps.length > 10) throw new Error("at most 10 funnel steps");
				const clause = rangeClause(input.dateRange);
				const out: Array<{ step: number; path: string; visitors: number }> = [];
				for (let i = 0; i < steps.length; i++) {
					const qr = await client.query(
						`SELECT count(DISTINCT person_id) AS visitors
						 FROM events WHERE event = '$pageview' AND ${clause}
						 AND properties.$pathname = '${steps[i]}' LIMIT 1`,
					);
					const visitors = Number(qr.results[0]?.[0] ?? 0);
					out.push({ step: i + 1, path: steps[i], visitors });
				}
				return { content: JSON.stringify({ funnel: out }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const query: ToolDefinition = {
		name: "posthog_query",
		description:
			"Run a read-only HogQL (SQL-like) query against your PostHog events for metrics not covered by the other tools. SELECT/WITH only — writes and DDL are rejected, and a LIMIT is enforced. Returns { columns, rows }. The main table is `events` (columns include event, timestamp, person_id, and properties.$pathname / properties.$referring_domain).",
		plugin: "posthog",
		input_schema: {
			type: "object",
			properties: {
				sql: { type: "string", description: "A read-only HogQL SELECT query." },
			},
			required: ["sql"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const safe = guardReadOnlyHogQL(String(input.sql ?? ""));
				const qr = await client.query(safe);
				return {
					content: JSON.stringify({ columns: qr.columns, rows: qr.results }),
				};
			} catch (err) {
				return errResult(err);
			}
		},
	};

	return [topPages, pageviews, topReferrers, eventCounts, funnel, query];
}
