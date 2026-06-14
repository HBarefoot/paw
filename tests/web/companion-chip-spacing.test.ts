import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// fix/companion-chip-spacing — the `ONLINE · N SKILLS` status chip was pinned
// flush to the top-left corner (top/left: 2px) and read as cramped. It should
// stay top-left but sit inset with proper breathing room. This test fails on the
// pre-fix 2px values.
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
const px = (block: string, prop: string): number =>
	Number(block.match(new RegExp(`${prop}\\s*:\\s*(\\d+)px`))?.[1] ?? "NaN");

describe("companion status chip spacing", () => {
	test("the status chip is inset from the top-left corner, not flush", () => {
		const chip = ruleBody(CSS, ".status-chip");
		// stays anchored top-left…
		expect(chip).toContain("position: absolute");
		// …but with breathing room (was the flush 2px on both axes pre-fix).
		expect(px(chip, "top")).toBeGreaterThanOrEqual(12);
		expect(px(chip, "left")).toBeGreaterThanOrEqual(12);
	});
});
