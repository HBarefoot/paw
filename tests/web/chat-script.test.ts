import { describe, expect, test } from "bun:test";
import { getChatScript } from "../../src/web/views/chat.js";

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
});
