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

	test("editor saves via POST (new) or PUT (edit)", () => {
		expect(script).toContain("function savePromptFrom(");
		expect(script).toContain('"/api/prompts/" + encodeURIComponent(id)');
		expect(script).toContain('var method = id ? "PUT" : "POST"');
	});

	test("duplicatePrompt creates a (copy) via POST from card data", () => {
		expect(script).toContain("function duplicatePrompt(");
		const start = script.indexOf("function duplicatePrompt(");
		const body = script.slice(start, start + 600);
		expect(body).toContain('"/api/prompts"');
		expect(body).toContain('method: "POST"');
		expect(body).toContain('"data-title") + " (copy)"');
	});

	test("the design card grid is driven by client-side tag + text filter", () => {
		expect(script).toContain("function filterPrompts(");
		expect(script).toContain("function selectTag(");
	});
});
