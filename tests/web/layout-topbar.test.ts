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
});
