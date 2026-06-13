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

	test("no-topbar chat is HARD-capped to the viewport so the page never scrolls", () => {
		// REGRESSION 1 (#90): a fixed `calc(100vh - 133px)` left a bottom gap.
		// REGRESSION 2 (#94): bare flex (no definite height) let the chain grow.
		// REGRESSION 3 (this fix): #94's `height: 100dvh` was silently overridden by
		// .content's inherited `flex: 1` (flex-basis:0% beats height) → .content
		// still grew with content and the page scrolled. A `max-height: 100dvh` cap
		// is applied AFTER flex and cannot be overridden — it physically bounds
		// .content to the viewport. Verified in a headless browser: pre-fix the
		// document rendered ~8900px tall in an 800px viewport; with this it is 800.
		const css = String(
			Layout({ title: "Chat", hideTopbar: true, children: "x" }),
		);
		expect(css).not.toContain("100vh - 133px");
		expect(css).toMatch(/\.no-topbar \.chat-with-canvas \{[^}]*flex: 1[^}]*\}/);
		// .content carries the hard viewport cap + overflow:hidden.
		const content = css.match(/\.no-topbar \.content \{[^}]*\}/)?.[0] ?? "";
		expect(content).toContain("flex-direction: column");
		expect(content).toMatch(/max-height: 100dvh|max-height: 100vh/);
		expect(content).toContain("overflow: hidden");
		// The inner scroll panes can shrink (min-height:0) so they scroll/bound
		// internally instead of forcing the column — and the page — taller.
		for (const sel of [
			"\\.chat-messages",
			"\\.canvas-main",
			"\\.canvas-tab-content",
		]) {
			const rule = css.match(new RegExp(`${sel} \\{[^}]*\\}`))?.[0] ?? "";
			expect(rule).toContain("min-height: 0");
		}
	});
});
