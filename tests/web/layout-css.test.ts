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
});

describe("Barefoot Digital design system", () => {
	test("ds.css keeps the legacy token names AND adds the design vocabulary", () => {
		// legacy names every page already references (kept so the reskin is value-only)
		for (const t of [
			"--bg-primary",
			"--bg-card",
			"--border-primary",
			"--text-primary",
			"--accent",
			"--radius-md",
			"--font-sans",
		])
			expect(DS_CSS).toContain(`${t}:`);
		// the design's own vocabulary, aliased onto paw tokens
		for (const t of [
			"--green:",
			"--panel:",
			"--panel-2:",
			"--ink:",
			"--ink-bright:",
			"--line:",
			"--sans:",
			"--mono:",
			"--r:",
		])
			expect(DS_CSS).toContain(t);
	});

	test("the accent is emerald (dark hero) — not the old violet", () => {
		expect(DS_CSS).toContain("#3fe08f"); // emerald accent (dark)
		expect(DS_CSS).not.toContain("#6a4bf0"); // old violet light accent
		expect(DS_CSS).not.toContain("#7458f5"); // old violet dark accent
	});

	test("fonts are vendored Space Grotesk + JetBrains Mono, NOT a Google CDN", () => {
		expect(DS_CSS).toContain("@font-face");
		expect(DS_CSS).toContain("/fonts/space-grotesk-400.woff2");
		expect(DS_CSS).toContain("/fonts/jetbrains-mono-400.woff2");
		expect(DS_CSS).toContain('"Space Grotesk"');
		expect(DS_CSS).not.toContain("Geist");
		// no external font CDN anywhere in the page
		expect(LAYOUT_SRC).not.toContain("fonts.googleapis.com");
		expect(String(Layout({ title: "X", children: "y" }))).not.toContain(
			"fonts.googleapis.com",
		);
	});

	test("the design's component vocabulary is present for pages to adopt", () => {
		for (const sel of [
			".panel {",
			".panel-hd ",
			".kpi {",
			".section-hd ",
			".seg {",
			".conn-pill {",
		])
			expect(DS_CSS).toContain(sel);
	});

	test("the full page-component vocabulary (Phase 1 port) is present", () => {
		// REGRESSION: pre-port ds.css had none of these — pages couldn't adopt the
		// design's panels/tables/cards/split/settings/search/toast layouts.
		for (const sel of [
			".kpi-strip {",
			".tbl {",
			".led {",
			".st {",
			".feed-row {",
			".cards {",
			".pcard {",
			".split {",
			".detail .kv {",
			".notif {",
			".settings-wrap {",
			".set-nav ",
			".set-row {",
			".search-hero ",
			".res {",
			".pill-badge {",
			".lrow {",
			".toggle {",
			".pbar {",
			".icobtn {",
			".toast {",
			".toast-wrap {",
		])
			expect(DS_CSS).toContain(sel);
	});

	test("ported component tints are token-aware (no raw emerald rgba leaks)", () => {
		// The design's source hardcodes rgba(63,224,143,…); the port must route
		// accent tints through tokens / color-mix so light theme + brand accent
		// still apply. Guard the specific raw value the design used most.
		const ported = DS_CSS.slice(DS_CSS.indexOf("Barefoot Console — page"));
		expect(ported).not.toContain("rgba(63,224,143");
		expect(ported).toContain("color-mix(");
		expect(ported).toContain("var(--accent-subtle)");
	});

	test("Layout wires a global toast mount + pawToast helper", () => {
		const html = String(Layout({ title: "X", children: "y" }));
		expect(html).toContain('class="toast-wrap" id="toast-wrap"');
		expect(html).toContain("window.pawToast");
		// the toast script must not carry backslash escapes (template-trap)
		expect(LAYOUT_SRC).toContain("const toastScript");
	});

	test("the topbar renders the brand crumb + an Online conn-pill", () => {
		const html = String(Layout({ title: "Config", children: "x" }));
		expect(html).toContain('class="crumb" data-brand-name');
		expect(html).toContain('class="conn-pill"');
		expect(html).toContain("conn-dot pulse");
		// hidden when the page suppresses the topbar (e.g. /chat, /)
		const noTop = String(
			Layout({ title: "Chat", children: "x", hideTopbar: true }),
		);
		expect(noTop).not.toContain('class="conn-pill"');
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
