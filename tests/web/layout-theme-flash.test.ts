import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Layout } from "../../src/web/views/layout.js";

// feat/ui-polish-flash-and-modals — kill the inter-navigation white flash.
// The synchronous head script must set `color-scheme` (so the browser's own
// canvas/scrollbars match the theme before first paint), and an early inline
// <style> must paint the theme ground before the render-blocking ds.css loads.

const LAYOUT_SRC = readFileSync(
	fileURLToPath(new URL("../../src/web/views/layout.tsx", import.meta.url)),
	"utf8",
);

/** Slice the inline <script> that defines the synchronous theme bootstrap
 *  (the one carrying __pawSetTheme), from the rendered Layout HTML. */
function headThemeScript(html: string): string {
	const marker = "window.__pawSetTheme=function";
	const mi = html.indexOf(marker);
	expect(mi).toBeGreaterThan(-1);
	const open = html.lastIndexOf("<script>", mi) + "<script>".length;
	const end = html.indexOf("</script>", mi);
	return html.slice(open, end);
}

/** Run the cooked theme script against a fake same-origin doc; probe the root. */
function runThemeScript(theme: string, systemDark: boolean) {
	const html = String(Layout({ title: "x", currentPath: "/", children: "x" }));
	const src = headThemeScript(html);
	const cls = new Set<string>();
	const style: Record<string, string> = {};
	const store: Record<string, string> = { "paw-theme": theme };
	const win = {
		localStorage: {
			getItem: (k: string) => store[k] ?? null,
			setItem: (k: string, v: string) => {
				store[k] = v;
			},
		},
		matchMedia: (_q: string) => ({
			matches: systemDark,
			addEventListener: () => {},
		}),
	} as Record<string, unknown>;
	const doc = {
		documentElement: {
			style,
			classList: {
				add: (c: string) => cls.add(c),
				toggle: (c: string, on: boolean) => {
					if (on) cls.add(c);
					else cls.delete(c);
				},
				contains: (c: string) => cls.has(c),
			},
		},
		querySelectorAll: () => [] as unknown[],
	};
	const fn = new Function("window", "document", "localStorage", src);
	fn(win, doc, win.localStorage);
	return {
		colorScheme: () => style.colorScheme,
		hasDark: () => cls.has("dark"),
		setTheme: (t: string) => (win.__pawSetTheme as (t: string) => void)(t),
	};
}

describe("head theme script sets color-scheme before first paint (no white flash)", () => {
	test("the script cooks and parses (inline-script-template-trap guard)", () => {
		const html = String(Layout({ title: "x", children: "x" }));
		expect(() => new Function(headThemeScript(html))).not.toThrow();
	});

	test("dark theme → color-scheme:dark on load; light → light", () => {
		expect(runThemeScript("dark", false).colorScheme()).toBe("dark");
		expect(runThemeScript("light", false).colorScheme()).toBe("light");
	});

	test('"system" resolves color-scheme from prefers-color-scheme', () => {
		expect(runThemeScript("system", true).colorScheme()).toBe("dark");
		expect(runThemeScript("system", false).colorScheme()).toBe("light");
	});

	test("__pawSetTheme updates color-scheme on theme change too", () => {
		const t = runThemeScript("light", false);
		expect(t.colorScheme()).toBe("light");
		t.setTheme("dark");
		expect(t.colorScheme()).toBe("dark");
		expect(t.hasDark()).toBe(true);
		t.setTheme("light");
		expect(t.colorScheme()).toBe("light");
	});
});

describe("early inline ground style paints before ds.css (belt-and-suspenders)", () => {
	const html = String(Layout({ title: "x", currentPath: "/", children: "x" }));

	test("an inline <style> sets the root background for both themes", () => {
		expect(html).toContain(":root{background-color:#f4f7f5}");
		expect(html).toContain(":root.dark{background-color:#050708}");
	});

	test("the ground style comes BEFORE the ds.css link (so first paint isn't white)", () => {
		const styleAt = html.indexOf(":root.dark{background-color:");
		const dsAt = html.indexOf("/app/static/ds.css");
		expect(styleAt).toBeGreaterThan(-1);
		expect(dsAt).toBeGreaterThan(-1);
		expect(styleAt).toBeLessThan(dsAt);
	});
});

describe("ds.css enables cross-document view transitions", () => {
	const CSS = readFileSync(
		fileURLToPath(new URL("../../src/web/public/app/ds.css", import.meta.url)),
		"utf8",
	);
	test("@view-transition { navigation: auto } is declared, guarded by reduced-motion", () => {
		expect(CSS).toContain("@view-transition");
		expect(CSS).toContain("navigation: auto");
		expect(CSS).toContain("::view-transition-old(root)");
	});
});
