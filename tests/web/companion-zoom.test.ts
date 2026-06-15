import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Fix B (fix/companion-lightbg-and-zoom): the companion rescales the fit wrapper
// (.fit) via scaleToFit() as the skill + sub-agent COUNT changes. Pre-fix that
// resize JUMPED (no transition). The fix adds `transition: transform` to .fit —
// but ONLY to .fit, never to .cmp-sphere, whose transform is driven every rAF
// frame by stepFace() (a transition there would fight the loop and stutter).
// These tests fail on the pre-fix CSS (no .fit transition exists).

const CSS = readFileSync(
	new URL("../../src/web/public/companion/styles.css", import.meta.url),
	"utf8",
);
const SHELL = readFileSync(
	new URL("../../src/web/public/companion/shell.js", import.meta.url),
	"utf8",
);

/** Body of the first `<selector> { … }` rule (no nested braces in this sheet). */
function ruleBody(css: string, selector: string): string {
	const i = css.indexOf(`${selector} {`);
	if (i === -1) throw new Error(`selector not found: ${selector}`);
	const open = css.indexOf("{", i);
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
}

describe("companion fit-scale zoom is smoothed (Fix B)", () => {
	test(".fit.fit-anim transitions transform (fails pre-fix)", () => {
		const body = ruleBody(CSS, ".fit.fit-anim");
		expect(body).toContain("transition:");
		expect(body).toContain("transform");
	});

	test("the breathing orb (.cmp-sphere) is NEVER transform-transitioned", () => {
		// stepFace() rewrites .cmp-sphere transform every frame — a CSS transition
		// here would stutter the breathing. It may transition box-shadow only.
		const body = ruleBody(CSS, ".cmp-sphere");
		const m = body.match(/transition\s*:\s*([^;]+);/);
		if (m) expect(m[1]).not.toContain("transform");
	});

	test("shell.js gates the transition on the .fit element via fit-anim", () => {
		expect(SHELL).toContain("fit-anim");
		// the class is added to the fit wrapper, not the breathing orb
		expect(SHELL).toContain('fit.classList.add("fit-anim")');
	});

	test("reduced-motion still snaps (global reset nukes transitions)", () => {
		const i = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
		expect(i).toBeGreaterThan(-1);
		const block = CSS.slice(i, i + 200);
		expect(block).toContain("transition: none !important");
	});
});
