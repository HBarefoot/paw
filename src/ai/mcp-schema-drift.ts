import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

// MCP is a trust boundary: when an upstream server changes a tool's input
// schema, Paw otherwise finds out only at runtime as an opaque tool failure
// (this bit n8n's archive_workflow / update_workflow). This module snapshots
// each tool's schema at connect/refresh time and raises a notification on
// drift — deliberately scoped to snapshot-and-diff, no nightly CI / live ping.

export interface SchemaDriftEvent {
	server: string;
	tool: string;
	reason: "changed" | "removed";
	/** Top-level properties present now but not before. */
	added: string[];
	/** Top-level properties present before but not now. */
	removed: string[];
	/** Top-level properties whose `type` changed. */
	typeChanged: string[];
	/** Whether the `required` array changed. */
	requiredChanged: boolean;
}

/** Side-effect collaborators, injected so the detector stays pure + testable. */
export interface DriftSinks {
	notify: (n: {
		title: string;
		body: string;
		level: "info" | "warning";
		url?: string;
	}) => void;
	audit: (action: string, details: Record<string, unknown>) => void;
	emit: (event: SchemaDriftEvent) => void;
	log?: (message: string, meta?: Record<string, unknown>) => void;
}

interface ToolLike {
	name: string;
	input_schema?: Record<string, unknown>;
}

/**
 * Stable, sorted-key JSON serialization so reordered object keys can't fake a
 * drift. Arrays keep their order (order is meaningful, e.g. `required`).
 */
function canonical(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const keys = Object.keys(obj).sort();
		return `{${keys
			.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function hashSchema(schema: unknown): string {
	return createHash("sha256").update(canonical(schema)).digest("hex");
}

type SchemaShape = {
	properties?: Record<string, { type?: unknown } | undefined>;
	required?: unknown;
};

/** Shallow, top-level diff (NOT a full JSON-schema differ). */
function shallowDiff(
	oldSchema: unknown,
	newSchema: unknown,
): Pick<
	SchemaDriftEvent,
	"added" | "removed" | "typeChanged" | "requiredChanged"
> {
	const o = (oldSchema ?? {}) as SchemaShape;
	const n = (newSchema ?? {}) as SchemaShape;
	const oldProps = o.properties ?? {};
	const newProps = n.properties ?? {};
	const oldKeys = Object.keys(oldProps);
	const newKeys = Object.keys(newProps);
	const oldSet = new Set(oldKeys);
	const newSet = new Set(newKeys);

	const added = newKeys.filter((k) => !oldSet.has(k));
	const removed = oldKeys.filter((k) => !newSet.has(k));
	const typeChanged = newKeys.filter(
		(k) => oldSet.has(k) && oldProps[k]?.type !== newProps[k]?.type,
	);

	const reqArr = (v: unknown): string =>
		JSON.stringify(
			(Array.isArray(v) ? v.map(String) : []).slice().sort(),
		);
	const requiredChanged = reqArr(o.required) !== reqArr(n.required);

	return { added, removed, typeChanged, requiredChanged };
}

function summarize(e: SchemaDriftEvent): string {
	if (e.reason === "removed") return "tool removed from the server";
	const parts: string[] = [];
	if (e.added.length) parts.push(`added: ${e.added.join(", ")}`);
	if (e.removed.length) parts.push(`removed: ${e.removed.join(", ")}`);
	if (e.typeChanged.length) parts.push(`type changed: ${e.typeChanged.join(", ")}`);
	if (e.requiredChanged) parts.push("required[] changed");
	return parts.length ? parts.join("; ") : "schema changed";
}

function fire(sinks: DriftSinks, e: SchemaDriftEvent): void {
	const body = `${e.server}/${e.tool}: ${summarize(e)}`;
	sinks.emit(e);
	sinks.audit("mcp.schema.drift", { ...e });
	sinks.notify({
		title: `MCP schema drift: ${e.server}/${e.tool}`,
		body,
		level: "warning",
		url: "/mcp",
	});
	sinks.log?.(`MCP schema drift: ${body}`);
}

interface StoredRow {
	schema_hash: string;
	schema_json: string;
}

/**
 * Compare each tool's current input schema against the stored snapshot for
 * `serverName`, updating snapshots and raising drift events for changed/removed
 * tools. New tools are recorded silently (no event). Returns the drift events.
 *
 * Cheap: one indexed SELECT + hash compare per tool. Must run inside a
 * try/catch at the call site — see {@link runSchemaDrift}.
 */
export function detectSchemaDrift(
	db: Database,
	serverName: string,
	tools: ToolLike[],
	sinks: DriftSinks,
): SchemaDriftEvent[] {
	const events: SchemaDriftEvent[] = [];
	const prefix = `mcp__${serverName}__`;
	const seen = new Set<string>();

	const selectStmt = db.prepare(
		"SELECT schema_hash, schema_json FROM mcp_tool_schemas WHERE server_name = ? AND tool_name = ?",
	);

	for (const tool of tools) {
		const toolName = tool.name.startsWith(prefix)
			? tool.name.slice(prefix.length)
			: tool.name;
		seen.add(toolName);
		const schema = tool.input_schema ?? {};
		const hash = hashSchema(schema);
		const json = JSON.stringify(schema);

		const row = selectStmt.get(serverName, toolName) as StoredRow | undefined;
		if (!row) {
			db.run(
				"INSERT INTO mcp_tool_schemas (id, server_name, tool_name, schema_hash, schema_json) VALUES (?, ?, ?, ?, ?)",
				[randomUUID(), serverName, toolName, hash, json],
			);
			sinks.log?.(`MCP schema baseline recorded: ${serverName}/${toolName}`);
			continue;
		}
		if (row.schema_hash === hash) {
			db.run(
				"UPDATE mcp_tool_schemas SET last_seen = datetime('now') WHERE server_name = ? AND tool_name = ?",
				[serverName, toolName],
			);
			continue;
		}

		// Changed.
		let oldSchema: unknown = {};
		try {
			oldSchema = JSON.parse(row.schema_json || "{}");
		} catch {
			oldSchema = {};
		}
		db.run(
			"UPDATE mcp_tool_schemas SET schema_hash = ?, schema_json = ?, last_seen = datetime('now'), last_changed = datetime('now') WHERE server_name = ? AND tool_name = ?",
			[hash, json, serverName, toolName],
		);
		const e: SchemaDriftEvent = {
			server: serverName,
			tool: toolName,
			reason: "changed",
			...shallowDiff(oldSchema, schema),
		};
		events.push(e);
		fire(sinks, e);
	}

	// Tools previously stored for this server but absent from the current list.
	const stored = db
		.query<{ tool_name: string }, [string]>(
			"SELECT tool_name FROM mcp_tool_schemas WHERE server_name = ?",
		)
		.all(serverName);
	for (const { tool_name } of stored) {
		if (seen.has(tool_name)) continue;
		// Drop the snapshot so the removal fires exactly once (a later reappearance
		// is treated as a fresh baseline — no event).
		db.run(
			"DELETE FROM mcp_tool_schemas WHERE server_name = ? AND tool_name = ?",
			[serverName, tool_name],
		);
		const e: SchemaDriftEvent = {
			server: serverName,
			tool: tool_name,
			reason: "removed",
			added: [],
			removed: [],
			typeChanged: [],
			requiredChanged: false,
		};
		events.push(e);
		fire(sinks, e);
	}

	return events;
}

/**
 * try/catch wrapper used by the kernel — drift detection must NEVER block or
 * fail an MCP connect. A detection failure is a logged warning, nothing more.
 */
export function runSchemaDrift(
	db: Database,
	serverName: string,
	tools: ToolLike[],
	sinks: DriftSinks,
): SchemaDriftEvent[] {
	try {
		return detectSchemaDrift(db, serverName, tools, sinks);
	} catch (err) {
		sinks.log?.("MCP schema-drift detection failed (ignored)", {
			server: serverName,
			error: err instanceof Error ? err.message : String(err),
		});
		return [];
	}
}
