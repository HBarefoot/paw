import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	cleanLeakedSessionTitles,
	extractCanvasRequest,
	sessionTitleFromContent,
} from "../../src/store/session-title.js";

// A realistic canvas message: the [CANVAS MODE] system prompt with the real ask
// buried at "User request:", followed by an attached-data section.
const CANVAS_MSG = [
	"[CANVAS MODE] You are working in a live canvas environment.",
	"You MUST use the canvas_write tool to create/update files (HTML, CSS, JS).",
	"REQUIRED OUTPUT FORMAT:",
	"1. Call the canvas_write tool with the complete file content.",
	"",
	"User request: Build a sales landing page for Martinez Roofing",
	"",
	"--- Attached Data ---",
	"contacts.csv: 200 rows",
].join("\n");

describe("session title — no internal [CANVAS MODE] leak", () => {
	test("extractCanvasRequest pulls the user request from a canvas message", () => {
		expect(extractCanvasRequest(CANVAS_MSG)).toBe(
			"Build a sales landing page for Martinez Roofing",
		);
		// non-canvas → null; attachments-only canvas → "" (caller falls back)
		expect(extractCanvasRequest("just a normal message")).toBeNull();
		expect(
			extractCanvasRequest(
				"[CANVAS MODE] x\n\nUser request: (see attached files)",
			),
		).toBe("");
	});

	test("sessionTitleFromContent never surfaces the system prompt", () => {
		const title = sessionTitleFromContent(CANVAS_MSG);
		expect(title).toBe("Build a sales landing page for Martinez Roofing");
		expect(title).not.toContain("[CANVAS MODE]");
		expect(title).not.toContain("canvas_write");
		// attachments-only canvas → a clean generic label
		expect(
			sessionTitleFromContent(
				"[CANVAS MODE] x\n\nUser request: (see attached files)",
			),
		).toBe("Canvas session");
	});

	test("plain messages pass through, collapsed + capped at 80", () => {
		expect(sessionTitleFromContent("Fix the lead form")).toBe(
			"Fix the lead form",
		);
		const long = "a".repeat(120);
		const t = sessionTitleFromContent(long);
		expect(t.length).toBe(80); // 79 chars + ellipsis
		expect(t.endsWith("…")).toBe(true);
		expect(sessionTitleFromContent("  multi   space\n\nline ")).toBe(
			"multi space line",
		);
	});

	test("cleanLeakedSessionTitles re-titles leaked rows from the first message", () => {
		const db = new Database(":memory:");
		db.exec(`
			CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, updated_at TEXT);
			CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT,
				content TEXT, created_at TEXT);
		`);
		// leaked canvas session + its first user message (the full prompt)
		db.run("INSERT INTO sessions (id, title) VALUES ('s1', ?)", [
			CANVAS_MSG.slice(0, 80),
		]);
		db.run(
			"INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('m1','s1','user',?, '2026-01-01')",
			[CANVAS_MSG],
		);
		// a clean session must be left untouched
		db.run("INSERT INTO sessions (id, title) VALUES ('s2', 'Daily briefing')");

		cleanLeakedSessionTitles(db);

		const s1 = db.query("SELECT title FROM sessions WHERE id='s1'").get() as {
			title: string;
		};
		expect(s1.title).toBe("Build a sales landing page for Martinez Roofing");
		const s2 = db.query("SELECT title FROM sessions WHERE id='s2'").get() as {
			title: string;
		};
		expect(s2.title).toBe("Daily briefing");

		// idempotent: a second run is a no-op (no rows match [CANVAS MODE]%)
		cleanLeakedSessionTitles(db);
		expect(
			(
				db.query("SELECT title FROM sessions WHERE id='s1'").get() as {
					title: string;
				}
			).title,
		).toBe("Build a sales landing page for Martinez Roofing");
	});
});
