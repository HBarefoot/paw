import { describe, expect, test } from "bun:test";
import { OpsPage } from "../../src/web/views/ops-page.js";

// The Agent Ops console hardcoded currentPath="/", so a white-label fork that
// shadows GET / with its own dashboard couldn't mount Agent Ops anywhere else
// (the nav would never highlight). It now takes a currentPath prop (default
// "/") threaded to Layout. Layout marks the matching nav <a> with
// `class="nav-item active"`; the Dashboard item links to "/".
describe("OpsPage — mountable at a configurable path", () => {
	const base = { accent: "", model: "m", uptimeMs: 0 };

	test("default render highlights the / Dashboard nav item (unchanged)", () => {
		const html = String(OpsPage(base));
		expect(html).toContain('href="/" class="nav-item active"');
	});

	test("currentPath='/ops' no longer force-activates the / item", () => {
		const html = String(OpsPage({ ...base, currentPath: "/ops" }));
		// Dashboard ("/") is present but NOT active — proves currentPath threads
		// through to Layout instead of being hardcoded.
		expect(html).not.toContain('href="/" class="nav-item active"');
		expect(html).toContain('href="/" class="nav-item"');
	});
});
