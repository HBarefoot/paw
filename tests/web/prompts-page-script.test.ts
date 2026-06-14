import { describe, expect, test } from "bun:test";
import { getPromptsScript } from "../../src/web/views/prompts-page.js";

// The prompts page ships its client JS as a template literal (same
// inline-script-template-trap as chat.tsx). getPromptsScript() returns the
// cooked browser JS; compiling it with `new Function` catches a mis-cooked
// escape that would blank the page, without a browser.
describe("prompts page client script", () => {
	const script = getPromptsScript();

	test("cooked script parses (no SyntaxError from the template trap)", () => {
		expect(() => new Function(script)).not.toThrow();
	});

	test("duplicatePrompt creates a copy via POST with a (copy) title", () => {
		expect(script).toContain("function duplicatePrompt(");
		const start = script.indexOf("function duplicatePrompt(");
		const body = script.slice(start, start + 700);
		// Reads the already-rendered edit inputs (no extra GET) and POSTs a new row.
		expect(body).toContain('document.getElementById("edit-body-" + id)');
		expect(body).toContain('"/api/prompts"');
		expect(body).toContain('method: "POST"');
		expect(body).toContain('title + " (copy)"');
	});

	test("inline edit still persists via PUT (regression guard)", () => {
		// savePrompt(id) targets /api/prompts/:id with PUT; the page is the home
		// for full inline edit (the chat picker only links here).
		expect(script).toContain('"/api/prompts/" + encodeURIComponent(id)');
		expect(script).toContain('method = id ? "PUT" : "POST"');
	});
});
