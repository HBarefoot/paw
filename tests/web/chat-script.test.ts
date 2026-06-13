import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getChatScript } from "../../src/web/views/chat.js";

const CHAT_SRC = readFileSync(
	fileURLToPath(new URL("../../src/web/views/chat.tsx", import.meta.url)),
	"utf8",
);

// The chat client is a giant template literal served verbatim as /js/chat.js.
// Backslashes/escapes are "cooked" once when the literal is evaluated (the
// recurring inline-script-template-trap), so a bad escape or stray regex ships
// a script that fails to parse and blanks the chat. getChatScript() returns the
// already-cooked browser JS; compiling it with `new Function` catches that
// whole failure class without a browser.
describe("chat client script", () => {
	const script = getChatScript();

	test("cooked script parses (no SyntaxError from the template trap)", () => {
		// new Function compiles the body; a mis-cooked escape throws SyntaxError.
		expect(() => new Function(script)).not.toThrow();
	});

	test("pinned Home tab wiring is present", () => {
		// The portrait now lives in a pinned Home tab backed by /api/canvas/preview/__home__,
		// never clobbered by the agent writing index.html.
		expect(script).toContain('CANVAS_HOME_PATH = "__home__"');
		expect(script).toContain("pinned: true");
		expect(script).toContain('label: "Home"');
		// Live portrait reactions target the Home path, not index.html.
		expect(script).toContain("t.path !== CANVAS_HOME_PATH");
		// The Home tab can't be closed.
		expect(script).toContain("if (canvasTabs[idx].pinned) return;");
	});

	test("canvas toolbar has no redundant Home breadcrumb (one Home = the tab)", () => {
		// The toolbar's current-file label was ALWAYS a duplicate of the active tab
		// ("Home on top of Home"); removed. The tab strip is the file indicator.
		expect(CHAT_SRC).not.toContain('id="current-file"');
		expect(script).not.toContain('getElementById("current-file")');
		expect(script).not.toContain("canvasCurrentFile.textContent");
		// The active-path tracker + the pinned Home tab are untouched.
		expect(script).toContain("canvasCurrentFileName");
		expect(script).toContain('label: "Home"');
	});

	test("persisted canvas sessions load history (no blanket canvas- block)", () => {
		// Regression: the old guard early-returned for ANY id starting with
		// "canvas-", so selecting a persisted [CANVAS MODE] session from the
		// dropdown rendered nothing. History now loads for any session present in
		// the (persisted-only) dropdown.
		expect(script).toContain("function sessionIsListed(");
		expect(script).toContain("if (!sessionIsListed(sid)) return;");
		// The old blanket prefix guards must be gone.
		expect(script).not.toContain('sid.indexOf("canvas-") === 0) return');
		expect(script).not.toContain('!sessionId.startsWith("canvas-")');
	});

	test("prompt picker builds DOM nodes, not an HTML string (pawModal escapes strings)", () => {
		// Regression: pawModal._show escapes a string body via textContent, so the
		// old `'<div class="prompt-pick-list">' + items` string rendered the markup
		// as literal text and the rows were unclickable. The picker must be built
		// from real DOM nodes and passed as a Node.
		expect(script).not.toContain('<div class="prompt-pick" data-pid="');
		expect(script).not.toContain('<div class="prompt-pick-list">');
		// Built via DOM + passed as a Node, with Cancel as a structured action.
		expect(script).toContain('list.className = "prompt-pick-list"');
		expect(script).toContain("row.dataset.pid = p.id");
		expect(script).toContain('pawModal._show("Insert a prompt", list, [');
		expect(script).toContain('label: "Cancel"');
		// The per-row click still records usage and inserts the body.
		expect(script).toContain('/use", { method: "POST" }');
	});
});
