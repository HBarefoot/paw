import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { redactString } from "../../src/observability/logger.js";
import { ToolLog } from "../../src/observability/tool-log.js";
import { AuditLogger } from "../../src/security/audit-log.js";

const TOOL_LOG_DDL = `CREATE TABLE IF NOT EXISTS tool_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, tool_name TEXT NOT NULL,
  plugin TEXT, input_preview TEXT, output_preview TEXT,
  is_error INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')))`;
const AUDIT_DDL = `CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, user_id INTEGER,
  details TEXT, ip_address TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`;

// A real installation token Paw's git/gh tools handle. It must NEVER be
// persisted to the tool_log or audit_log, even if a tool returns it in output.
const TOKEN = "ghs_SECRETtoken1234567890ABCDEFabcdef";

describe("redactString covers GitHub tokens", () => {
	test("masks ghs_/ghp_/gho_ tokens", () => {
		expect(redactString(`x ${TOKEN} y`)).not.toContain(TOKEN);
		expect(redactString("ghp_abcdefghijklmnopqrstuvwxyz0123")).toContain(
			"[REDACTED]",
		);
	});
});

describe("tool_log never stores a leaked token (regression — fails pre-fix)", () => {
	let db: Database;
	beforeEach(() => {
		db = new Database(":memory:");
		db.run(TOOL_LOG_DDL);
	});
	afterEach(() => db.close());

	test("a token in tool output is redacted in output_preview", () => {
		const log = new ToolLog(db);
		log.record({
			toolName: "gh",
			output: `authenticated as ${TOKEN}`,
			input: { repo: "owner/name", args: ["pr", "view"] },
		});
		const row = db
			.query("SELECT output_preview FROM tool_log LIMIT 1")
			.get() as { output_preview: string };
		expect(row.output_preview).not.toContain(TOKEN);
		expect(row.output_preview).toContain("[REDACTED]");
	});
});

describe("audit_log never stores a leaked token", () => {
	let db: Database;
	beforeEach(() => {
		db = new Database(":memory:");
		db.run(AUDIT_DDL);
	});
	afterEach(() => db.close());

	test("a token in audit details is redacted", () => {
		const audit = new AuditLogger(db);
		audit.log("git.exec", null, { note: `used ${TOKEN}`, token: TOKEN });
		const row = db.query("SELECT details FROM audit_log LIMIT 1").get() as {
			details: string;
		};
		expect(row.details).not.toContain(TOKEN);
	});
});
