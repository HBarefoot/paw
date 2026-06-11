import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The canvas portrait's inline JS lives inside a template literal in
 * src/web/app.ts (`c.html(`…`)`). Backslashes in that script are processed by the
 * template literal BEFORE the browser sees it — so a regex like /^\[(...)\]/ is
 * served as /^[(...)]/ (invalid → the whole script throws SyntaxError). This test
 * reproduces the template "cook" and parses the result, catching that class of bug.
 */
function extractPortraitScript(src: string): string {
	const open = src.indexOf(
		"(function(){\n          var face=document.getElementById",
	);
	if (open < 0) throw new Error("portrait IIFE not found");
	const close = src.indexOf("})();</script>", open);
	if (close < 0) throw new Error("portrait IIFE end not found");
	return src.slice(open, close + "})();".length);
}

function cook(src: string): string {
	const raw = extractPortraitScript(src);
	// Stub server-injected ${...} expressions with a number, then let JS cook the
	// escapes exactly as the runtime template literal would.
	const stubbed = raw.replace(/\$\{[^}]*\}/g, "0");
	// biome-ignore lint/security/noGlobalEval: test-only — cooking the template
	return eval(`\`${stubbed}\``) as string;
}

// A permissive DOM-element stub: every property access returns a harmless callable
// stub, so any DOM call the portrait makes succeeds. It does NOT shadow free
// identifiers — an undeclared variable (e.g. a stray `prefix`) still throws
// ReferenceError, which is exactly the bug class we want to surface.
// biome-ignore lint/suspicious/noExplicitAny: a universal DOM stub is intentionally untyped
function stubEl(): any {
	return new Proxy(() => {}, {
		get(_t, p) {
			if (p === "classList")
				return {
					add() {},
					remove() {},
					contains() {
						return false;
					},
					toggle() {},
				};
			if (p === "style" || p === "dataset") return {};
			if (p === "getBoundingClientRect")
				return () => ({
					left: 0,
					top: 0,
					right: 0,
					bottom: 0,
					width: 0,
					height: 0,
				});
			if (p === "getTotalLength") return () => 0;
			if (p === "getAttribute") return () => null;
			if (p === "querySelectorAll") return () => [];
			if (p === "querySelector") return () => stubEl();
			if (p === "children") return [];
			if (p === "parentNode") return stubEl();
			if (p === "isConnected") return true;
			if (p === "offsetWidth" || p === "offsetHeight") return 0;
			if (p === "textContent" || p === "innerHTML") return "";
			if (p === Symbol.toPrimitive) return () => 0;
			return stubEl();
		},
		set() {
			return true;
		},
		apply() {
			return stubEl();
		},
	});
}

describe("canvas portrait inline script", () => {
	const src = readFileSync(
		new URL("../../src/web/app.ts", import.meta.url),
		"utf8",
	);

	it("parses after the template literal cooks its escapes (no stripped-backslash regexes)", () => {
		expect(() => new Function(cook(src))).not.toThrow();
	});

	it("runs the paw:tool handler without throwing (no undeclared-variable ReferenceErrors)", () => {
		const cooked = cook(src);
		const warns: unknown[][] = [];
		const consoleStub = {
			warn: (...a: unknown[]) => warns.push(a),
			error: (...a: unknown[]) => warns.push(a),
			log: () => {},
		};
		let handler: ((e: { data: unknown }) => void) | null = null;
		const win = {
			addEventListener(type: string, fn: (e: { data: unknown }) => void) {
				if (type === "message") handler = fn;
			},
			matchMedia() {
				return { matches: false, addEventListener() {}, addListener() {} };
			},
			postMessage() {},
		};
		const doc = {
			getElementById: () => stubEl(),
			querySelector: () => stubEl(),
			querySelectorAll: () => [],
			createElement: () => stubEl(),
			createElementNS: () => stubEl(),
			documentElement: stubEl(),
			body: stubEl(),
			addEventListener() {},
		};
		const noop = () => 0;

		// Execute the cooked IIFE with window/document bound to stubs. Other globals
		// (Math, Date, String, parseFloat, …) resolve to the real ones.
		const run = new Function(
			"window",
			"document",
			"setTimeout",
			"setInterval",
			"clearTimeout",
			"clearInterval",
			"requestAnimationFrame",
			"console",
			cooked,
		);
		run(win, doc, noop, noop, noop, noop, noop, consoleStub);

		expect(typeof handler).toBe("function");
		const fire = (m: Record<string, unknown>) =>
			(handler as (e: { data: unknown }) => void)({ data: m });

		// Ignore any init-time noise, then exercise the live tool lifecycle.
		warns.length = 0;
		fire({
			type: "paw:tool",
			phase: "start",
			skillKey: "memory",
			toolName: "file_read",
			toolId: "t1",
			summary: "reading a file",
		});
		fire({ type: "paw:tool", phase: "end", skillKey: "memory", toolId: "t1" });
		fire({ type: "paw:tool", phase: "done" });

		// The handler now wraps its body in try/catch (so prod degrades gracefully),
		// so a thrown error surfaces as a console.warn rather than a throw. Either
		// way, the lifecycle must run clean.
		expect(warns).toEqual([]);
	});
});
