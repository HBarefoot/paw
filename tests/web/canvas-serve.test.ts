import { describe, expect, it } from "bun:test";
import {
	canvasContentType,
	injectCanvasRuntime,
} from "../../src/web/canvas-serve.js";

/**
 * The error-overlay + runtime shim injected into served canvas/app HTML are
 * BROWSER scripts authored inside template literals in canvas-serve.ts, so
 * backslashes are cooked once before the browser sees them (the recurring
 * "inline-script-template-trap"). These tests run the already-cooked output
 * against DOM stubs to catch SyntaxError / ReferenceError and verify the escape
 * sequences (\n, ✓) survived intact.
 */

function extractScripts(html: string): string[] {
	const scripts: string[] = [];
	const re = /<script>([\s\S]*?)<\/script>/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
	while ((m = re.exec(html)) !== null) scripts.push(m[1]);
	return scripts;
}

// Universal stub: any property access returns a callable stub, so any DOM call
// succeeds. Free identifiers are NOT shadowed, so a stray undeclared variable
// still throws ReferenceError — the bug class we want to surface.
// biome-ignore lint/suspicious/noExplicitAny: an intentionally untyped DOM stub
function stub(): any {
	return new Proxy(() => stub(), {
		get(_t, p) {
			if (p === "style" || p === "dataset" || p === "classList") return {};
			if (p === Symbol.toPrimitive) return () => "";
			return stub();
		},
		apply() {
			return stub();
		},
	});
}

describe("canvasContentType", () => {
	it("maps known extensions", () => {
		expect(canvasContentType(".html")).toBe("text/html");
		expect(canvasContentType(".CSS")).toBe("text/css");
		expect(canvasContentType(".js")).toBe("application/javascript");
		expect(canvasContentType(".woff2")).toBe("font/woff2");
		expect(canvasContentType(".svg")).toBe("image/svg+xml");
	});
	it("falls back to octet-stream", () => {
		expect(canvasContentType(".xyz")).toBe("application/octet-stream");
		expect(canvasContentType("")).toBe("application/octet-stream");
	});
});

describe("injectCanvasRuntime", () => {
	it("injects before </body> when present", () => {
		const out = injectCanvasRuntime("<html><body>hi</body></html>");
		expect(out).toContain("<script>");
		expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("</body>"));
		expect(out.endsWith("</body></html>")).toBe(true);
	});
	it("appends when no </body>", () => {
		const out = injectCanvasRuntime("<div>x</div>");
		expect(out.startsWith("<div>x</div>")).toBe(true);
		expect(out).toContain("<script>");
	});

	it("cooked scripts parse and run without throwing (footgun guard)", () => {
		const scripts = extractScripts(injectCanvasRuntime("<body></body>"));
		expect(scripts.length).toBe(3); // error overlay + runtime shim + refresh poller

		const listeners: Record<string, (e: unknown) => void> = {};
		const win: Record<string, unknown> = {};
		const doc = new Proxy(
			{
				addEventListener(type: string, fn: (e: unknown) => void) {
					listeners[type] = fn;
				},
				createElement: () => stub(),
				getElementById: () => null,
				// Return a <meta name="paw-refresh" content="event"> stub so the
				// refresh poller takes its active branch (event mode, no reload).
				querySelector: (sel: string) =>
					sel.includes("paw-refresh")
						? { getAttribute: () => "event" }
						: null,
				body: stub(),
			},
			{ get: (t, p) => (p in t ? (t as never)[p] : stub()) },
		);
		// On an app-space path so the poller does NOT return early.
		const loc = { pathname: "/api/app/demo/index.html", reload() {} };
		let fetched = 0;
		const fetchStub = () => {
			fetched++;
			return Promise.resolve({
				json: () => Promise.resolve({ ok: true, events: [] }),
			});
		};

		for (const js of scripts) {
			expect(() => {
				// new Function throws SyntaxError on a mis-cooked script.
				new Function(
					"document",
					"window",
					"FormData",
					"fetch",
					"location",
					"setTimeout",
					"CustomEvent",
					js,
				)(
					doc,
					win,
					function FormData() {
						return { forEach() {} };
					},
					fetchStub,
					loc,
					() => 0, // setTimeout no-op → poller doesn't reschedule
					function CustomEvent() {},
				);
			}).not.toThrow();
		}
		// The poller reached its active branch and polled the events endpoint.
		expect(fetched).toBeGreaterThan(0);

		// Exercise the overlay's onerror path (uses the cooked "\n").
		expect(typeof win.onerror).toBe("function");
		expect(() =>
			(win.onerror as (...a: unknown[]) => void)("boom", "f.js", 1, 1),
		).not.toThrow();
	});
});
