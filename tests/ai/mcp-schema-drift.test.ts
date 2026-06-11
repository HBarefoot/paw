import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
	type DriftSinks,
	type SchemaDriftEvent,
	detectSchemaDrift,
	runSchemaDrift,
} from "../../src/ai/mcp-schema-drift.js";

function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
    CREATE TABLE mcp_tool_schemas (
      id TEXT PRIMARY KEY, server_name TEXT NOT NULL, tool_name TEXT NOT NULL,
      schema_hash TEXT NOT NULL, schema_json TEXT NOT NULL,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_changed TEXT, UNIQUE(server_name, tool_name)
    );
  `);
	return db;
}

interface Collector extends DriftSinks {
	events: SchemaDriftEvent[];
	notifications: Array<{ title: string; body: string; level: string }>;
	audits: Array<{ action: string; details: Record<string, unknown> }>;
	logs: string[];
}

function collector(): Collector {
	const events: SchemaDriftEvent[] = [];
	const notifications: Collector["notifications"] = [];
	const audits: Collector["audits"] = [];
	const logs: string[] = [];
	return {
		events,
		notifications,
		audits,
		logs,
		emit: (e) => events.push(e),
		notify: (n) => notifications.push(n),
		audit: (action, details) => audits.push({ action, details }),
		log: (m) => logs.push(m),
	};
}

const tool = (input_schema: Record<string, unknown>) => ({
	name: "mcp__n8n__archive_workflow",
	input_schema,
});

const BASE = {
	type: "object",
	properties: { id: { type: "string" }, force: { type: "boolean" } },
	required: ["id"],
};

describe("detectSchemaDrift", () => {
	test("first sighting inserts a baseline, emits no event", () => {
		const db = freshDb();
		const c = collector();
		const evs = detectSchemaDrift(db, "n8n", [tool(BASE)], c);
		expect(evs).toEqual([]);
		expect(c.notifications.length).toBe(0);
		const row = db
			.query("SELECT tool_name, schema_hash FROM mcp_tool_schemas")
			.get() as { tool_name: string; schema_hash: string };
		expect(row.tool_name).toBe("archive_workflow"); // prefix stripped
		expect(row.schema_hash).toHaveLength(64); // sha256 hex
	});

	test("identical schema with shuffled key order → no drift", () => {
		const db = freshDb();
		const c = collector();
		detectSchemaDrift(db, "n8n", [tool(BASE)], c);
		// Same content, keys inserted in a different order.
		const shuffled = {
			required: ["id"],
			properties: { force: { type: "boolean" }, id: { type: "string" } },
			type: "object",
		};
		const evs = detectSchemaDrift(db, "n8n", [tool(shuffled)], c);
		expect(evs).toEqual([]);
		expect(c.notifications.length).toBe(0);
	});

	test("property added → drift event with the added field", () => {
		const db = freshDb();
		const c = collector();
		detectSchemaDrift(db, "n8n", [tool(BASE)], c);
		const next = {
			type: "object",
			properties: {
				id: { type: "string" },
				force: { type: "boolean" },
				reason: { type: "string" },
			},
			required: ["id"],
		};
		const evs = detectSchemaDrift(db, "n8n", [tool(next)], c);
		expect(evs.length).toBe(1);
		expect(evs[0]).toMatchObject({
			tool: "archive_workflow",
			reason: "changed",
			added: ["reason"],
			removed: [],
			typeChanged: [],
			requiredChanged: false,
		});
		expect(c.notifications.length).toBe(1);
		expect(c.notifications[0].level).toBe("warning");
		expect(c.audits[0].action).toBe("mcp.schema.drift");
	});

	test("property removed and type changed → drift event", () => {
		const db = freshDb();
		const c = collector();
		detectSchemaDrift(db, "n8n", [tool(BASE)], c);
		const next = {
			type: "object",
			properties: { id: { type: "number" } }, // force removed, id type changed
			required: ["id"],
		};
		const evs = detectSchemaDrift(db, "n8n", [tool(next)], c);
		expect(evs.length).toBe(1);
		expect(evs[0].removed).toEqual(["force"]);
		expect(evs[0].typeChanged).toEqual(["id"]);
	});

	test("required[] change → drift event", () => {
		const db = freshDb();
		const c = collector();
		detectSchemaDrift(db, "n8n", [tool(BASE)], c);
		const next = {
			type: "object",
			properties: { id: { type: "string" }, force: { type: "boolean" } },
			required: ["id", "force"], // added force as required
		};
		const evs = detectSchemaDrift(db, "n8n", [tool(next)], c);
		expect(evs.length).toBe(1);
		expect(evs[0].requiredChanged).toBe(true);
		expect(evs[0].added).toEqual([]); // properties unchanged
	});

	test("tool disappearing from the list → removed event, snapshot dropped", () => {
		const db = freshDb();
		const c = collector();
		detectSchemaDrift(db, "n8n", [tool(BASE)], c);
		const evs = detectSchemaDrift(db, "n8n", [], c); // tool gone
		expect(evs.length).toBe(1);
		expect(evs[0]).toMatchObject({ tool: "archive_workflow", reason: "removed" });
		const count = db
			.query("SELECT COUNT(*) AS n FROM mcp_tool_schemas")
			.get() as { n: number };
		expect(count.n).toBe(0); // dropped → won't re-fire
	});

	test("two connects with a mutation between → exactly one notification", () => {
		const db = freshDb();
		const c = collector();
		detectSchemaDrift(db, "n8n", [tool(BASE)], c); // connect 1: baseline
		const mutated = {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		};
		detectSchemaDrift(db, "n8n", [tool(mutated)], c); // connect 2: changed
		// connect 3: same as 2 → no further drift
		detectSchemaDrift(db, "n8n", [tool(mutated)], c);
		expect(c.notifications.length).toBe(1);
	});
});

describe("runSchemaDrift (wrapper)", () => {
	test("a detection failure never throws — connect proceeds", () => {
		const db = freshDb();
		db.close(); // any query now throws
		const c = collector();
		let result: SchemaDriftEvent[] = [{ server: "x" } as SchemaDriftEvent];
		expect(() => {
			result = runSchemaDrift(db, "n8n", [tool(BASE)], c);
		}).not.toThrow();
		expect(result).toEqual([]);
		expect(c.logs.some((l) => l.includes("failed"))).toBe(true);
	});
});
