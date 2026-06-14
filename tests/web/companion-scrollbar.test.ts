import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// feat/companion-scrollbar — the companion iframe had no scrollbar styling, so
// its scroll areas (skill inbox, ops feed) showed the chunky OS-default bar.
// Add a thin, rounded, brand-tinted, theme-aware scrollbar. These assertions
// fail on the pre-change stylesheet (no ::-webkit-scrollbar rules at all).
const CSS = readFileSync(
	new URL("../../src/web/public/companion/styles.css", import.meta.url),
	"utf8",
);

/** Body of the first `<selector> { … }` rule (no nested braces in this sheet). */
function ruleBody(css: string, selector: string): string {
	const i = css.indexOf(`${selector} {`);
	if (i === -1) throw new Error(`selector not found: ${selector}`);
	const open = css.indexOf("{", i);
	return css.slice(open + 1, css.indexOf("}", open));
}

describe("companion scrollbar", () => {
	test("defines a slim webkit scrollbar", () => {
		expect(CSS).toContain("::-webkit-scrollbar {");
		expect(CSS).toContain("::-webkit-scrollbar-track {");
		expect(CSS).toContain("::-webkit-scrollbar-thumb {");
		// Slimmer than the OS default.
		expect(ruleBody(CSS, "::-webkit-scrollbar")).toMatch(/width:\s*8px/);
	});

	test("track is transparent (no white gutter) and the thumb is rounded", () => {
		expect(ruleBody(CSS, "::-webkit-scrollbar-track")).toContain("transparent");
		const thumb = ruleBody(CSS, "::-webkit-scrollbar-thumb");
		expect(thumb).toContain("border-radius");
	});

	test("thumb color is token-driven, so it stays theme-aware (not a hardcoded hex)", () => {
		const thumb = ruleBody(CSS, "::-webkit-scrollbar-thumb");
		// Reuses the #115 theme-aware accent-tint token; no baked-in color.
		expect(thumb).toContain("var(--pill-border)");
		expect(thumb).not.toMatch(/#[0-9a-fA-F]{3,6}/);
	});

	test("Firefox gets a thin, token-colored scrollbar too", () => {
		expect(CSS).toContain("scrollbar-width: thin");
		expect(CSS).toContain("scrollbar-color: var(--pill-border) transparent");
	});
});
