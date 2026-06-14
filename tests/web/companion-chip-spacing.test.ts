import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// fix/companion-chip-spacing — the `ONLINE · N SKILLS` status chip must sit at
// the VISIBLE top-left corner with breathing room. Two parts:
//  1) it's pinned to `root` (the full-iframe, non-scaled layer), NOT inside the
//     narrow centered `.home` column (where it floated next to the avatar and
//     drifted as the screen got busier);
//  2) it's inset from the corner (was flush at 2px).
// Both assertions fail on the pre-fix code.
const ROOT = new URL("../../src/web/public/companion/", import.meta.url);
const CSS = readFileSync(new URL("styles.css", ROOT), "utf8");
const SHELL = readFileSync(new URL("shell.js", ROOT), "utf8");

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

	test("the chip is pinned to the iframe layer (root), not the centered .home column", () => {
		// Anchoring to root (position:absolute, fills the iframe, NOT inside the
		// scaled .fit) is what keeps the chip in the true top-left corner — even as
		// the dock/feed grow and scaleToFit shrinks .home.
		expect(SHELL).toContain("root.appendChild(statusChip)");
		expect(SHELL).not.toContain("home.appendChild(statusChip)");
	});
});
