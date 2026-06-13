import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Layout } from "../../src/web/views/layout.js";

// The app-wide design system used to be a ~1700-line `const cssDesignSystem = `…``
// template literal in layout.tsx, inlined via <style>${…}</style>. A single
// literal backtick anywhere in it — even inside a CSS comment — closed the string
// and broke Layout for EVERY page. That trap cost three sessions. It now lives in
// a real stylesheet served from 'self', so backticks in the CSS are inert.
const DS_PATH = fileURLToPath(
	new URL("../../src/web/public/app/ds.css", import.meta.url),
);
const LAYOUT_PATH = fileURLToPath(
	new URL("../../src/web/views/layout.tsx", import.meta.url),
);
const DS_CSS = readFileSync(DS_PATH, "utf8");
const LAYOUT_SRC = readFileSync(LAYOUT_PATH, "utf8");

describe("design system is a served stylesheet, not a JS template literal", () => {
	test("the cssDesignSystem template literal is GONE from Layout (the trap)", () => {
		// REGRESSION: fails on the pre-fix code where the CSS lived in a template
		// literal in layout.tsx.
		expect(LAYOUT_SRC).not.toContain("const cssDesignSystem");
		expect(LAYOUT_SRC).not.toContain("<style>${cssDesignSystem}</style>");
	});

	test("the CSS lives in the served ds.css and is the real, complete stylesheet", () => {
		expect(DS_CSS.length).toBeGreaterThan(20000);
		expect(DS_CSS).toContain("/* ===== RESET ===== */");
		expect(DS_CSS).toContain(".chat-with-canvas");
	});

	test("Layout LINKS the stylesheet (cache-busted) and does NOT inline the CSS", () => {
		const html = String(Layout({ title: "Config", children: "x" }));
		expect(html).toMatch(
			/<link rel="stylesheet" href="\/app\/static\/ds\.css\?v=/,
		);
		// The design-system body is not embedded in the page anymore.
		expect(html).not.toContain("/* ===== RESET ===== */");
		expect(html).not.toContain(".chat-with-canvas {");
	});

	test("a backtick in the CSS does NOT break Layout render (the canary)", () => {
		// ds.css carries a deliberate backtick in its header comment. Because the CSS
		// is read by the /app/static route at request time and never embedded in
		// Layout's JSX, that backtick is harmless — Layout renders fine. If anyone
		// moved this CSS back into a JS template literal, the backtick would close it
		// and this (and every Layout import) would fail at parse time.
		expect(DS_CSS).toContain("`"); // canary present
		expect(() => String(Layout({ title: "X", children: "y" }))).not.toThrow();
		const html = String(Layout({ title: "X", children: "y" }));
		expect(html).toContain("/app/static/ds.css");
	});

	// The /chat viewport-scroll guard (PR #97) — the rules now live in ds.css.
	test("no-topbar /chat is hard-capped to the viewport (scroll guard)", () => {
		expect(DS_CSS).not.toContain("100vh - 133px");
		expect(DS_CSS).toMatch(
			/\.no-topbar \.chat-with-canvas \{[^}]*flex: 1[^}]*\}/,
		);
		const content = DS_CSS.match(/\.no-topbar \.content \{[^}]*\}/)?.[0] ?? "";
		expect(content).toContain("flex-direction: column");
		expect(content).toMatch(/max-height: 100dvh|max-height: 100vh/);
		expect(content).toContain("overflow: hidden");
		for (const sel of [
			"\\.chat-messages",
			"\\.canvas-main",
			"\\.canvas-tab-content",
		]) {
			const rule = DS_CSS.match(new RegExp(`${sel} \\{[^}]*\\}`))?.[0] ?? "";
			expect(rule).toContain("min-height: 0");
		}
	});
});
