import { describe, expect, test } from "bun:test";
import { Layout } from "../../src/web/views/layout.js";

// The settings-consolidation refactor de-duped two byte-identical icon pairs and
// disambiguated overlapping nav labels. These guard the nav rendering.
function nav(currentPath = "/"): string {
	return String(Layout({ title: "x", currentPath, children: "x" }));
}

/** Extract the SVG markup for a given nav item label (the <a> wraps an icon span
 *  then the label text). Returns the nav-icon span's inner SVG. */
function iconForLabel(html: string, label: string): string {
	const at = html.indexOf(`>${label}<`);
	expect(at).toBeGreaterThan(-1);
	// The icon span precedes the label within the same anchor.
	const spanOpen = html.lastIndexOf('<span class="nav-icon">', at);
	const spanClose = html.indexOf("</span>", spanOpen);
	return html.slice(spanOpen, spanClose);
}

describe("nav consolidation — labels", () => {
	test("the /settings child reads 'General' (not 'Settings'), killing 'Settings › Settings'", () => {
		const html = nav();
		expect(html).toContain(">General<");
		// The group HEADER is still "Settings"; only the child was renamed, so the
		// label now appears exactly once (was twice → "Settings › Settings").
		expect(html.split(">Settings<").length - 1).toBe(1);
	});

	test("the /access item is renamed 'Security & Access'", () => {
		const html = nav();
		expect(html).toContain("Security &amp; Access");
		expect(html).not.toContain(">Access<");
	});
});

describe("nav consolidation — de-duped icons", () => {
	test("the General item uses the sliders (preferences) icon, distinct from the gear group header", () => {
		const html = nav();
		// preferences icon is the multi-line sliders glyph (has <line> elements).
		const general = iconForLabel(html, "General");
		expect(general).toContain("<line");
		// …and is NOT the gear (circle + the long settings path).
		expect(general).not.toContain('<circle cx="12" cy="12" r="3"');
	});

	test("Tools (wrench) and Skills (puzzle) no longer render the same SVG", () => {
		const html = nav();
		const tools = iconForLabel(html, "Tools");
		const skills = iconForLabel(html, "Skills");
		expect(tools).not.toBe(skills);
		// Tools keeps the wrench path; Skills must differ from it.
		expect(tools).toContain("M14.7 6.3a1 1 0 0 0 0 1.4");
		expect(skills).not.toContain("M14.7 6.3a1 1 0 0 0 0 1.4");
	});
});
