import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The canvas portrait's inline JS lives inside a template literal in
 * src/web/app.ts (`c.html(`…`)`). Backslashes in that script are processed by the
 * template literal BEFORE the browser sees it — so a regex like /^\[(...)\]/ is
 * served as /^[(...)]/ (invalid → the whole script throws SyntaxError). This test
 * reproduces the template "cook" and parses the result, catching that class of bug.
 */
function extractPortraitScript(src: string): string {
	const open = src.indexOf("(function(){\n          var face=document.getElementById");
	if (open < 0) throw new Error("portrait IIFE not found");
	const close = src.indexOf("})();</script>", open);
	if (close < 0) throw new Error("portrait IIFE end not found");
	return src.slice(open, close + "})();".length);
}

describe("canvas portrait inline script", () => {
	const src = readFileSync(
		new URL("../../src/web/app.ts", import.meta.url),
		"utf8",
	);
	const raw = extractPortraitScript(src);

	it("parses after the template literal cooks its escapes (no stripped-backslash regexes)", () => {
		// Stub server-injected ${...} expressions with a number, then let JS cook
		// the escapes exactly as the runtime template literal would.
		const stubbed = raw.replace(/\$\{[^}]*\}/g, "0");
		// biome-ignore lint/security/noGlobalEval: test-only — cooking the template
		const cooked = eval("`" + stubbed + "`") as string;
		expect(() => new Function(cooked)).not.toThrow();
	});
});
