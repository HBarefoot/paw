import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The empty-canvas placeholder (shown in the auto-opened index.html tab when no
// root index.html exists) used to render the ~530-line inline "living portrait"
// face — PR #87 only fixed the reserved __home__ Home tab. It now serves a
// neutral, faceless placeholder from a static file, and the old inline portrait
// (a recurring backtick template-literal trap) is deleted.
const APP_SRC = readFileSync(
	fileURLToPath(new URL("../../src/web/app.ts", import.meta.url)),
	"utf8",
);
const PLACEHOLDER = readFileSync(
	fileURLToPath(
		new URL("../../src/web/public/app/canvas-empty.html", import.meta.url),
	),
	"utf8",
);

describe("empty-canvas placeholder is faceless (old portrait deleted)", () => {
	test("the old inline portrait is GONE from app.ts (no face can paint)", () => {
		// REGRESSION: these markers exist on pre-fix main; the fix removes them.
		for (const marker of [
			"capabilities constellation",
			"var face=document.getElementById",
			'class="face"',
			'querySelectorAll(".pupil")',
			"data-angle=",
		]) {
			expect(APP_SRC).not.toContain(marker);
		}
	});

	test("the index.html preview serves the static placeholder", () => {
		expect(APP_SRC).toContain("public/app");
		expect(APP_SRC).toContain("canvas-empty.html");
	});

	test("the placeholder is neutral: real copy, NO face/orb/pills", () => {
		expect(PLACEHOLDER).toContain("Nothing here yet");
		expect(PLACEHOLDER).toContain("Ask me to build something");
		// no face primitives leak back in
		for (const marker of [
			'class="face"',
			".pupil",
			"data-angle",
			'class="node"',
			"data-key=",
		]) {
			expect(PLACEHOLDER).not.toContain(marker);
		}
		// self-contained for the null-origin sandboxed iframe: no external loads,
		// no script.
		expect(PLACEHOLDER).not.toContain("<script");
		expect(PLACEHOLDER).not.toContain("http://");
		expect(PLACEHOLDER).not.toContain("https://");
	});
});
