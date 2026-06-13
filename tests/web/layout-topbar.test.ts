import { describe, expect, test } from "bun:test";
import { Layout } from "../../src/web/views/layout.js";

// The page-title topbar (~52px) is redundant on /chat, where the page's own
// toolbar is the header. `hideTopbar` suppresses it and marks the main area so
// the chat + canvas reclaim the height. Other pages keep the topbar.
describe("Layout hideTopbar", () => {
	test("renders the page-title topbar by default", () => {
		const html = String(Layout({ title: "Configuration", children: "x" }));
		expect(html).toContain('class="topbar"');
		expect(html).toContain('class="page-title"');
		expect(html).toContain("Configuration");
		// The main area is unmarked (the `no-topbar` token also appears in CSS,
		// so assert the element class specifically).
		expect(html).toContain('class="main-area"');
		expect(html).not.toContain('class="main-area no-topbar"');
	});

	test("omits the topbar and marks the main area when hideTopbar", () => {
		const html = String(
			Layout({ title: "Chat", hideTopbar: true, children: "x" }),
		);
		expect(html).toContain("main-area no-topbar");
		expect(html).not.toContain('class="topbar"');
		// The title only ever appears in the topbar, so its chrome is gone too.
		expect(html).not.toContain('class="page-title"');
	});

	test("no-topbar chat fills the viewport and is bounded so the page never scrolls", () => {
		// REGRESSION 1: the panels used `height: calc(100vh - 133px)`, which
		// over-subtracted and left a gap below both panes.
		// REGRESSION 2: replacing that with bare flex (no definite height) let the
		// chain grow with content — the page scrolled and the canvas iframe
		// stretched — because the outer .app-layout is min-height:100vh, so flex:1
		// had nothing to bound against. .content needs a DEFINITE viewport height.
		const css = String(
			Layout({ title: "Chat", hideTopbar: true, children: "x" }),
		);
		// The fragile magic number is gone…
		expect(css).not.toContain("100vh - 133px");
		// …the card flex-fills…
		expect(css).toMatch(/\.no-topbar \.chat-with-canvas \{[^}]*flex: 1[^}]*\}/);
		// …and .content is a bounded flex column (definite viewport height +
		// overflow:hidden) so the chat scrolls internally and the page does not.
		const content = css.match(/\.no-topbar \.content \{[^}]*\}/)?.[0] ?? "";
		expect(content).toContain("flex-direction: column");
		expect(content).toMatch(/height: 100dvh|height: 100vh/);
		expect(content).toContain("overflow: hidden");
	});
});
