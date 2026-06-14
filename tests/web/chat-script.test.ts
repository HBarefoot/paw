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

	test("memory citation viewer builds DOM nodes, not an HTML string", () => {
		// Same pawModal trap: the memory popover passed an HTML string body, so it
		// rendered <div>/<code> as literal text. Now built from DOM nodes.
		expect(script).not.toContain("<div style='max-height");
		expect(script).not.toContain('"ID: <code>"');
		expect(script).toContain('idCode = document.createElement("code")');
		expect(script).toContain("idCode.textContent = id");
		expect(script).toContain(
			'pawModal.alert("Memory " + id.slice(0, 6), panel)',
		);
	});

	test("export-format prompt is plain text, no <code> markup", () => {
		// pawModal.prompt sets its message via textContent; the <code> tags showed
		// as literal markup. The hint is plain text now.
		expect(script).not.toContain("<code>md</code>");
		expect(script).toContain("Choose format: md (default), html, or json.");
	});

	test("shared composer/message-action helpers are defined", () => {
		// Copy/Quote/Edit on message bubbles reuse one canonical set of helpers.
		expect(script).toContain("function insertIntoComposer(");
		expect(script).toContain("function buildQuote(");
		expect(script).toContain("function copyToClipboard(");
		expect(script).toContain("function addMessageActions(");
	});

	test("buildQuote uses the > prefix and split/join, not a regex literal", () => {
		// The quote format is "> " per line. Inside this template literal a regex
		// literal would be a cooking hazard (inline-script-template-trap), so the
		// helper splits/joins on newlines instead.
		const start = script.indexOf("function buildQuote(");
		expect(start).toBeGreaterThan(-1);
		const body = script.slice(start, start + 300);
		expect(body).toContain('"> "');
		expect(body).toContain(".split(");
		expect(body).toContain(".join(");
		// No regex literal (e.g. /.../g) inside the helper.
		expect(/\/[^/\n]+\/[a-z]*/.test(body)).toBe(false);
	});

	test("openPrompts inserts via the shared helper (no inline composer mutation)", () => {
		// The picker row-click was refactored onto insertIntoComposer so PR2 can
		// reuse the same insertion path for insert-as-quote.
		expect(script).toContain("insertIntoComposer(body)");
	});

	test("Edit action is gated to the user's own messages", () => {
		// addMessageActions only adds the Edit button under a role === "user" check;
		// assistant bubbles get Copy/Quote only.
		const start = script.indexOf("function addMessageActions(");
		expect(start).toBeGreaterThan(-1);
		const body = script.slice(start, start + 1400);
		expect(body).toContain('role === "user"');
		const editIdx = body.indexOf('"Edit"');
		const guardIdx = body.indexOf('role === "user"');
		expect(editIdx).toBeGreaterThan(-1);
		// The Edit button is created after (inside) the role guard.
		expect(editIdx).toBeGreaterThan(guardIdx);
	});

	test("Copy moved off the feedback bar into the unified action row", () => {
		// Regression: the feedback bar no longer builds its own Copy button (it
		// would duplicate the .msg-actions Copy). The bar keeps Retry/Fork/ratings.
		expect(script).toContain('row.className = "msg-actions"');
		const fbStart = script.indexOf("function addFeedbackButtons(");
		expect(fbStart).toBeGreaterThan(-1);
		const fbEnd = script.indexOf("function ", fbStart + 1);
		const fbBody = script.slice(fbStart, fbEnd > -1 ? fbEnd : fbStart + 2000);
		expect(fbBody).not.toContain("copyBtn");
		expect(fbBody).toContain("retryBtn");
	});

	test("prompt picker rows expose insert-as-quote / copy / duplicate / edit-link", () => {
		// PR2: each picker row keeps its primary insert-raw click and adds a
		// secondary action set, still built from DOM nodes (pawModal escape trap).
		expect(script).toContain('actions.className = "prompt-pick-actions"');
		// Insert as quote reuses PR1's buildQuote + insertIntoComposer.
		expect(script).toContain('quoteBtn.textContent = "Insert as quote"');
		expect(script).toContain("insertIntoComposer(buildQuote(body))");
		// Copy body reuses the shared clipboard helper.
		expect(script).toContain('copyBtn.textContent = "Copy body"');
		expect(script).toContain("copyToClipboard(p.body");
		// Duplicate POSTs a (copy) of the prompt to the library.
		expect(script).toContain('dupBtn.textContent = "Duplicate"');
		expect(script).toContain('(p.title || "Untitled") + " (copy)"');
		// Edit links out to the Prompts page (no inline edit in the modal).
		expect(script).toContain('editLink.href = "/prompts"');
	});

	test("picker secondary actions stop propagation so the row insert doesn't also fire", () => {
		const start = script.indexOf('actions.className = "prompt-pick-actions"');
		expect(start).toBeGreaterThan(-1);
		const body = script.slice(start, start + 1600);
		expect(body).toContain("ev.stopPropagation()");
	});
});
