import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The companion (Skill Dock v2) is a standalone same-origin iframe document served
// at GET /companion. It does NOT run layout.tsx's theme bootstrap, so before this
// fix its <html> never got `.dark` and styles.css hardcoded a dark-only palette in
// :root — washing the pills/greeting out on the white panel (light mode). The fix:
//   Part A — an inline theme bootstrap on /companion toggles the EXISTING `.dark`
//            class from the shared localStorage("paw-theme") + storage event.
//   Part B — styles.css surface/stroke tokens flip per mode (light :root defaults,
//            dark overrides under html.dark), contrast-safe in both.
// These tests fail on the pre-fix code (no html.dark block; no /companion bootstrap).

const CSS = readFileSync(
	new URL("../../src/web/public/companion/styles.css", import.meta.url),
	"utf8",
);
const APP_SRC = readFileSync(
	new URL("../../src/web/app.ts", import.meta.url),
	"utf8",
);

// ── tiny CSS readers (this is a real .ts file — regex is fine here) ──
/** Body of the first `<selector> { … }` rule (no nested braces in this sheet). */
function ruleBody(css: string, selector: string): string {
	const i = css.indexOf(`${selector} {`);
	if (i === -1) throw new Error(`selector not found: ${selector}`);
	const open = css.indexOf("{", i);
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
}
/** Value of a custom property declared within a block. */
function tokenIn(block: string, name: string): string | undefined {
	const m = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
	return m?.[1]?.trim();
}

// ── colour math (WCAG) ──
type Rgb = { r: number; g: number; b: number };
function hexToRgb(hex: string): Rgb {
	let h = hex.trim().replace("#", "");
	if (h.length === 3)
		h = h
			.split("")
			.map((c) => c + c)
			.join("");
	return {
		r: Number.parseInt(h.slice(0, 2), 16),
		g: Number.parseInt(h.slice(2, 4), 16),
		b: Number.parseInt(h.slice(4, 6), 16),
	};
}
/** Composite an opaque fg over bg at alpha (0–1). */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
	return {
		r: fg.r * alpha + bg.r * (1 - alpha),
		g: fg.g * alpha + bg.g * (1 - alpha),
		b: fg.b * alpha + bg.b * (1 - alpha),
	};
}
function relLum({ r, g, b }: Rgb): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: Rgb, b: Rgb): number {
	const l1 = relLum(a);
	const l2 = relLum(b);
	const hi = Math.max(l1, l2);
	const lo = Math.min(l1, l2);
	return (hi + 0.05) / (lo + 0.05);
}
/** Resolve a `var(--aNN)` reference to its accent alpha (0–1) from the :root tints. */
function alphaOfTintRef(root: string, ref: string): number {
	const tint = ref.match(/var\(\s*(--a\d+)\s*\)/)?.[1];
	if (!tint) throw new Error(`not a tint ref: ${ref}`);
	const def = tokenIn(root, tint);
	const pct = def?.match(/(\d+(?:\.\d+)?)%/)?.[1];
	if (!pct) throw new Error(`no % in tint ${tint}: ${def}`);
	return Number(pct) / 100;
}

const ROOT = ruleBody(CSS, ":root");
const DARK = ruleBody(CSS, "html.dark");
const ACCENT = hexToRgb(tokenIn(ROOT, "--accent") as string);

describe("companion styles.css is theme-aware (Part B)", () => {
	test("an html.dark override block exists (it did not pre-fix)", () => {
		expect(CSS).toContain("html.dark {");
		// reuse the EXISTING toggle, don't invent a new one
		expect(CSS).not.toContain("[data-theme");
		expect(CSS).not.toContain(".companion-light");
	});

	test(":root is the LIGHT ground; html.dark restores the dark ground", () => {
		const lightBg = hexToRgb(tokenIn(ROOT, "--bg") as string);
		const darkBg = hexToRgb(tokenIn(DARK, "--bg") as string);
		// opposite sides of the luminance midpoint — proves it's two real palettes,
		// not two dark ones. (Pre-fix :root --bg was #050807 and there was no
		// html.dark block at all.)
		expect(relLum(lightBg)).toBeGreaterThan(0.5);
		expect(relLum(darkBg)).toBeLessThan(0.1);
	});

	test("scattered dark-ground literals are now flipping tokens", () => {
		expect(ruleBody(CSS, ".pill")).toContain("color: var(--pill-text)");
		expect(ruleBody(CSS, ".pill")).not.toContain("#d9efe6");
		expect(ruleBody(CSS, ".op")).toContain("color: var(--op-text)");
		expect(ruleBody(CSS, ".subagent-name")).toContain("color: var(--sub-name)");
	});

	// ── contrast: text-vs-bg and idle-pill-text-vs-pill-bg, both modes ──
	const modes: Array<{ name: string; block: string }> = [
		{ name: "light (:root)", block: ROOT },
		{ name: "dark (html.dark)", block: DARK },
	];
	for (const { name, block } of modes) {
		test(`${name}: --text on --bg clears WCAG AA (4.5:1)`, () => {
			const bg = hexToRgb(tokenIn(block, "--bg") as string);
			const text = hexToRgb(tokenIn(block, "--text") as string);
			expect(contrast(text, bg)).toBeGreaterThanOrEqual(4.5);
		});

		test(`${name}: idle pill text on its (flattened) pill bg clears AA`, () => {
			const bg = hexToRgb(tokenIn(block, "--bg") as string);
			const pillText = hexToRgb(tokenIn(block, "--pill-text") as string);
			const pillBgRef = tokenIn(block, "--pill-bg") as string; // var(--aNN)
			const flat = over(ACCENT, alphaOfTintRef(ROOT, pillBgRef), bg);
			expect(contrast(pillText, flat)).toBeGreaterThanOrEqual(4.5);
		});
	}
});

// ── Part A: the /companion inline theme bootstrap ──
/** Slice out the inline <script> that carries the theme bootstrap. */
function bootstrapSource(): string {
	const marker = 'localStorage.getItem("paw-theme")';
	const mi = APP_SRC.indexOf(marker);
	expect(mi).toBeGreaterThan(-1); // fails pre-fix: no bootstrap exists
	const open = APP_SRC.lastIndexOf("<script>", mi) + "<script>".length;
	const end = APP_SRC.indexOf("</script>", mi);
	// no ${…} in this script, but strip defensively (template-trap discipline)
	return APP_SRC.slice(open, end).replace(/\$\{[^}]*\}/g, "null");
}

/** Run the cooked bootstrap against a fake same-origin doc; return probes. */
function runBootstrap(theme: string, systemDark: boolean) {
	const cls = new Set<string>();
	const winListeners: Record<string, (e: { key?: string }) => void> = {};
	const mqlListeners: Array<() => void> = [];
	const store: Record<string, string> = { "paw-theme": theme };
	const win = {
		localStorage: { getItem: (k: string) => store[k] ?? null },
		matchMedia: (_q: string) => ({
			matches: systemDark,
			addEventListener: (_t: string, fn: () => void) => mqlListeners.push(fn),
		}),
		addEventListener: (t: string, fn: (e: { key?: string }) => void) => {
			winListeners[t] = fn;
		},
	};
	const doc = {
		documentElement: {
			classList: {
				toggle: (c: string, on: boolean) => {
					if (on) cls.add(c);
					else cls.delete(c);
				},
				contains: (c: string) => cls.has(c),
			},
		},
	};
	const fn = new Function(
		"window",
		"document",
		"localStorage",
		bootstrapSource(),
	);
	fn(win, doc, win.localStorage);
	return {
		hasDark: () => cls.has("dark"),
		setTheme: (t: string) => {
			store["paw-theme"] = t;
		},
		fireStorage: (key: string) => winListeners.storage?.({ key }),
	};
}

describe("/companion theme bootstrap (Part A)", () => {
	test("the bootstrap cooks and parses (inline-script-template-trap guard)", () => {
		expect(() => new Function(bootstrapSource())).not.toThrow();
	});

	test("applies the saved theme on load", () => {
		expect(runBootstrap("dark", false).hasDark()).toBe(true);
		expect(runBootstrap("light", false).hasDark()).toBe(false);
	});

	test('"system" follows prefers-color-scheme', () => {
		expect(runBootstrap("system", true).hasDark()).toBe(true);
		expect(runBootstrap("system", false).hasDark()).toBe(false);
	});

	test("a paw-theme storage event re-applies live (console toggle propagates)", () => {
		const b = runBootstrap("light", false);
		expect(b.hasDark()).toBe(false);
		b.setTheme("dark");
		b.fireStorage("paw-theme");
		expect(b.hasDark()).toBe(true);
		// an unrelated key must NOT re-theme
		b.setTheme("light");
		b.fireStorage("paw-sidebar-collapsed");
		expect(b.hasDark()).toBe(true);
	});
});
