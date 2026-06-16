import { describe, expect, test } from "bun:test";
import { MemoryPage } from "../../src/web/views/memory-page.js";

/** Return the <script> block that contains `marker` (the page may render several
 *  scripts via Layout; we want the page-specific one). */
function scriptContaining(html: string, marker: string): string {
	const at = html.indexOf(marker);
	const open = html.lastIndexOf("<script>", at);
	const close = html.indexOf("</script>", at);
	return html.slice(open + "<script>".length, close);
}

function render(over?: {
	enabled?: boolean;
	autoExtract?: boolean;
	vectorWeight?: number;
	ftsWeight?: number;
}): string {
	return String(
		MemoryPage({
			memories: [],
			stats: null,
			memoryConfig: {
				enabled: over?.enabled ?? true,
				autoExtract: over?.autoExtract ?? false,
				vectorWeight: over?.vectorWeight ?? 0.7,
				ftsWeight: over?.ftsWeight ?? 0.3,
			},
		}),
	);
}

describe("memory page — relocated Memory settings (formerly /settings Memory tab)", () => {
	test("renders a settings form posting to /api/memory/config with all four fields", () => {
		const html = render();
		expect(html).toContain('action="/api/memory/config"');
		expect(html).toContain('name="memory.enabled"');
		expect(html).toContain('name="memory.autoExtract"');
		expect(html).toContain('name="memory.vectorWeight"');
		expect(html).toContain('name="memory.ftsWeight"');
	});

	test("toggle + number values reflect the memoryConfig prop", () => {
		const html = render({
			enabled: false,
			autoExtract: true,
			vectorWeight: 0.4,
		});
		expect(html).toContain(
			'<input type="hidden" name="memory.enabled" value="false">',
		);
		expect(html).toContain(
			'<input type="hidden" name="memory.autoExtract" value="true">',
		);
		expect(html).toContain('value="0.4"');
	});

	test("inline script defines pawToggle and parses with no backslash (template-trap guard)", () => {
		const html = render();
		const script = scriptContaining(html, "function pawToggle(");
		expect(script).toContain("function pawToggle(");
		expect(script).toContain("function deleteMemory(");
		expect(script).not.toContain("\\");
		expect(() => new Function(script)).not.toThrow();
	});
});
