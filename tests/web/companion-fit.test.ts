import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// fix/companion-avatar-clip: the companion is supposed to scale-to-fit its tab
// and never scroll, but in the Canvas Home tab the avatar's head was clipped at
// the top. Root: scaleToFit() defaulted to `s = 1` (natural size) on a degenerate
// measure (0-height read while the tab was display:none) — centered, the over-tall
// home clips top+bottom and the orb (top of the column) loses its head.
//
// The fit math is extracted to companion/fit.js (window.CompanionFit) so it is
// unit-testable AND so the unmeasurable case returns `null` → the caller keeps the
// last good scale instead of snapping to scale(1). These tests fail pre-change:
// fit.js / CompanionFit does not exist, .fit has no visibility:hidden, and
// scaleToFit still carries the `s = 1` default.

const COMPANION = new URL("../../src/web/public/companion/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, COMPANION), "utf8");

const CSS = read("styles.css");
const SHELL = read("shell.js");
const DS = readFileSync(
	new URL("../../src/web/public/app/ds.css", import.meta.url),
	"utf8",
);

/** Body of the first `<selector> { … }` rule (no nested braces in these sheets). */
function ruleBody(css: string, selector: string): string {
	const i = css.indexOf(`${selector} {`);
	if (i === -1) throw new Error(`selector not found: ${selector}`);
	const open = css.indexOf("{", i);
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
}

type Fit = {
	computeFitScale: (
		rw: number,
		rh: number,
		cw: number,
		ch: number,
	) => number | null;
};
function loadFit(): Fit {
	const win: Record<string, unknown> = {};
	new Function("window", read("fit.js"))(win);
	return win.CompanionFit as Fit;
}

describe("CompanionFit.computeFitScale (pure scale-to-fit math)", () => {
	test("shrinks when the dock is taller than the iframe (height-constrained)", () => {
		// rh < ch → must return s < 1, exactly rh/ch.
		expect(loadFit().computeFitScale(480, 360, 480, 600)).toBe(0.6);
	});

	test("shrinks when the dock is wider than the iframe (width-constrained)", () => {
		expect(loadFit().computeFitScale(300, 1000, 600, 600)).toBe(0.5);
	});

	test("caps at 1 when the dock already fits (never magnifies)", () => {
		expect(loadFit().computeFitScale(800, 800, 400, 400)).toBe(1);
	});

	test("returns null on a degenerate / unmeasurable read (the head-clip guard)", () => {
		const F = loadFit();
		// A 0 dimension (iframe or home not laid out) is unmeasurable — NOT scale 1.
		expect(F.computeFitScale(480, 360, 0, 0)).toBeNull();
		expect(F.computeFitScale(0, 360, 100, 100)).toBeNull();
		expect(F.computeFitScale(480, 0, 100, 100)).toBeNull();
		// Non-finite or negative reads are unmeasurable too.
		expect(F.computeFitScale(480, Number.NaN, 100, 100)).toBeNull();
		expect(F.computeFitScale(480, 360, 100, -5)).toBeNull();
		expect(
			F.computeFitScale(Number.POSITIVE_INFINITY, 360, 100, 100),
		).toBeNull();
	});
});

describe("companion head-clip fix wiring", () => {
	test(".fit starts hidden so a 0-height first paint never flashes a clipped orb", () => {
		// Revealed by scaleToFit() on the first real fit. Fails pre-change.
		expect(ruleBody(CSS, ".fit")).toContain("visibility: hidden");
	});

	test("#companion-root stays center-aligned (NOT `safe center`)", () => {
		// `safe` tests the UNSCALED layout box (transforms don't change it), so it
		// would top-align whenever natural content > root even when the scaled visual
		// fits — breaking the centered steady state. Lock the decision.
		const body = ruleBody(CSS, "#companion-root");
		expect(body).toContain("align-items: center");
		expect(body).not.toContain("safe center");
	});

	test("scaleToFit delegates to CompanionFit and drops the scale(1) default", () => {
		const fn = SHELL.slice(
			SHELL.indexOf("function scaleToFit"),
			SHELL.indexOf("function activeKey"),
		);
		expect(fn).toContain("window.CompanionFit.computeFitScale");
		expect(fn).toContain("fit.style.visibility");
		// the natural-size fallback that decapitated the orb is gone (fails pre-change)
		expect(fn).not.toContain("s = 1");
	});

	test("fit.js is wired into the /companion document before shell.js", () => {
		const app = readFileSync(
			new URL("../../src/web/app.ts", import.meta.url),
			"utf8",
		);
		const fitTag = app.indexOf("/companion/static/fit.js");
		const shellTag = app.indexOf("/companion/static/shell.js");
		expect(fitTag).toBeGreaterThan(-1);
		expect(shellTag).toBeGreaterThan(fitTag);
	});

	test(".canvas-panel is height-bounded so it can't stretch the tab iframe", () => {
		// Every sibling in the canvas column carries min-height:0; the panel was the
		// gap. Without the bound a tall descendant stretches the inset:0 iframe past
		// the viewport, feeding scaleToFit an oversized rh → clipped head. Fails pre-change.
		const body = ruleBody(DS, ".canvas-panel");
		expect(body).toContain("min-height: 0");
		expect(body).toContain("overflow: hidden");
	});
});

// fix/companion-fit-and-tethers: during a multi-agent stress run the orb's head
// clipped again and the dotted tethers drifted off the pills. BOTH trace to the
// .fit-anim 240ms scale transition: when content grows (an agent spawns) the fit
// scale must SHRINK, but animating that shrink (a) leaves the content oversized
// for 240ms → center-clips the orb, and (b) makes getBoundingClientRect report a
// mid-transition size while the `scale` var already holds the target → tether
// endpoints unscale by the wrong factor.
describe("companion fit transition: shrink snaps, grow animates (no clip)", () => {
	const scaleFn = SHELL.slice(
		SHELL.indexOf("function scaleToFit"),
		SHELL.indexOf("function activeKey"),
	);

	test("scaleToFit SNAPS (removes .fit-anim) when the scale shrinks", () => {
		// Animating a shrink is exactly what re-clipped the orb's head.
		expect(scaleFn).toContain('fit.classList.remove("fit-anim")');
		// Gated on the scale actually getting smaller than the current one.
		expect(scaleFn).toContain("s < scale");
	});

	test("scaleToFit still ANIMATES (adds .fit-anim) when growing (zoom-in is safe)", () => {
		expect(scaleFn).toContain('fit.classList.add("fit-anim")');
	});
});

describe("companion tethers unscale by the LIVE rendered scale, not the target", () => {
	const fn = SHELL.slice(
		SHELL.indexOf("function computeTethers"),
		SHELL.indexOf("function paintTethers"),
	);

	test("computeTethers derives a live scale from the measured home rect", () => {
		// crect.width / home.offsetWidth == the scale applied to the DOM right now,
		// even mid-transition — so endpoints track the pills instead of snapping to
		// the target early and drifting.
		expect(fn).toContain("crect.width / home.offsetWidth");
		expect(fn).toContain("liveScale");
	});

	test("the unscale divisions use liveScale, not the bare target `scale` var", () => {
		// Regression: dividing by the target `scale` during the .fit-anim transition
		// is what drifted the tethers. None of the coordinate conversions may divide
		// by the bare `scale` var anymore.
		expect(fn).not.toMatch(/\/\s*scale\b/);
		// And they DO divide by liveScale.
		expect(fn).toMatch(/\/\s*liveScale\b/);
	});
});
