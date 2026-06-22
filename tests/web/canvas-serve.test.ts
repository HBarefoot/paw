import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	canvasContentType,
	canvasFileFromUrlPath,
	injectCanvasRuntime,
	injectCompanionLauncher,
	shouldServeCompanion,
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

describe("canvasFileFromUrlPath (page-context mapping for the Assistant)", () => {
	it("maps a preview URL to its canvas file", () => {
		expect(
			canvasFileFromUrlPath("/api/canvas/preview/market-report.html"),
		).toBe("market-report.html");
		expect(canvasFileFromUrlPath("/api/canvas/preview/sales/index.html")).toBe(
			"sales/index.html",
		);
	});
	it("maps an app-space URL to apps/<space>/<sub> (default index.html)", () => {
		expect(canvasFileFromUrlPath("/api/app/shop/index.html")).toBe(
			"apps/shop/index.html",
		);
		expect(canvasFileFromUrlPath("/api/app/shop/")).toBe(
			"apps/shop/index.html",
		);
		expect(canvasFileFromUrlPath("/api/app/shop")).toBe("apps/shop/index.html");
		expect(canvasFileFromUrlPath("/api/app/shop/about/")).toBe(
			"apps/shop/about/index.html",
		);
	});
	it("decodes percent-encoding", () => {
		expect(canvasFileFromUrlPath("/api/canvas/preview/my%20page.html")).toBe(
			"my page.html",
		);
	});
	it("returns null for non-canvas URLs and traversal attempts", () => {
		expect(canvasFileFromUrlPath("/chat")).toBeNull();
		expect(canvasFileFromUrlPath("/api/canvas/preview/")).toBeNull();
		expect(
			canvasFileFromUrlPath("/api/canvas/preview/../../etc/passwd"),
		).toBeNull();
		expect(canvasFileFromUrlPath("/api/app/")).toBeNull();
	});
	it("honors a custom app namespace", () => {
		expect(canvasFileFromUrlPath("/api/app/x/index.html", "spaces")).toBe(
			"spaces/x/index.html",
		);
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
					sel.includes("paw-refresh") ? { getAttribute: () => "event" } : null,
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

// ── Cross-canvas-page link routing (fix/canvas-cross-page-links) ────────────
// A link from one canvas page to another used to navigate the null-origin
// sandboxed preview iframe itself, which fails under the CSP 'self' token (an
// opaque origin matches nothing) → ERR_CONNECTION_REFUSED / blocked frame. The
// runtime shim now intercepts those clicks and hands the target up to the parent
// console via postMessage, so the tab system opens it in a fresh iframe.
describe("CANVAS_RUNTIME cross-page link interception", () => {
	// Pull the runtime shim (the script that carries the link router).
	const runtimeScript = (): string => {
		const s = extractScripts(injectCanvasRuntime("<body></body>")).find((x) =>
			x.includes("paw:open-canvas"),
		);
		if (!s) throw new Error("runtime shim with link router not found");
		return s;
	};

	// Load the cooked shim against DOM stubs and return its captured click
	// handler + the messages it posts to window.parent.
	function loadClick(scrollTarget?: unknown) {
		const handlers: Record<string, (e: unknown) => void> = {};
		const messages: unknown[] = [];
		const doc = {
			addEventListener(type: string, fn: (e: unknown) => void) {
				handlers[type] = fn;
			},
			getElementById: () => scrollTarget ?? null,
			querySelector: () => scrollTarget ?? null,
		};
		let scrolledTop = false;
		const win = {
			parent: { postMessage: (msg: unknown) => messages.push(msg) },
			scrollTo: () => {
				scrolledTop = true;
			},
		};
		const loc = {
			host: "paw.test",
			href: "https://paw.test/api/canvas/preview/index.html",
			pathname: "/api/canvas/preview/index.html",
		};
		new Function(
			"document",
			"window",
			"location",
			"FormData",
			"fetch",
			"setTimeout",
			"CustomEvent",
			runtimeScript(),
		)(
			doc,
			win,
			loc,
			function FormData() {
				return { forEach() {} };
			},
			() => Promise.resolve({ json: () => Promise.resolve({}) }),
			() => 0,
			function CustomEvent() {},
		);
		return { click: handlers.click, messages, top: () => scrolledTop };
	}

	function clickEvent(anchor: unknown, extra: Record<string, unknown> = {}) {
		let prevented = false;
		return {
			target: { closest: () => anchor },
			preventDefault() {
				prevented = true;
			},
			metaKey: false,
			ctrlKey: false,
			button: 0,
			wasPrevented: () => prevented,
			...extra,
		};
	}

	const link = (href: string, target = "") => {
		// .href mirrors the browser-resolved absolute URL; getAttribute returns raw.
		let abs: string;
		if (/^[a-z]+:/i.test(href))
			abs = href; // already has a scheme (http(s), mailto, tel)
		else if (href.charAt(0) === "#")
			abs = `https://paw.test/api/canvas/preview/index.html${href}`;
		else abs = `https://paw.test/api/canvas/preview/${href}`; // relative to current page
		return {
			href: abs,
			getAttribute: (n: string) =>
				n === "href" ? href : n === "target" ? target : null,
		};
	};

	it("routes a relative link to another canvas page to the parent (navigate in place)", () => {
		const { click, messages } = loadClick();
		// The real-world case: a page at /api/canvas/preview/index.html with
		// <a href="sales-campaign/broker-outreach/index.html"> (browser resolves it).
		const a = link("sales-campaign/broker-outreach/index.html");
		const e = clickEvent(a);
		click(e);
		expect(messages).toEqual([
			{
				type: "paw:open-canvas",
				path: "sales-campaign/broker-outreach/index.html",
				newTab: false,
			},
		]);
		expect(e.wasPrevented()).toBe(true);
	});

	it("decodes a percent-encoded canvas path", () => {
		const { click, messages } = loadClick();
		click(
			clickEvent(link("https://paw.test/api/canvas/preview/my%20page.html")),
		);
		expect(messages).toEqual([
			{ type: "paw:open-canvas", path: "my page.html", newTab: false },
		]);
	});

	it("meta/ctrl-click (and target=_blank) opens a new tab", () => {
		const url = "https://paw.test/api/canvas/preview/b.html";
		const meta = loadClick();
		meta.click(clickEvent(link(url), { metaKey: true }));
		expect((meta.messages[0] as { newTab: boolean }).newTab).toBe(true);

		const blank = loadClick();
		blank.click(clickEvent(link(url, "_blank")));
		expect((blank.messages[0] as { newTab: boolean }).newTab).toBe(true);
	});

	it("hands an external http(s) link up to open in a new browser tab", () => {
		const { click, messages } = loadClick();
		const e = clickEvent(link("https://example.com/post"));
		click(e);
		expect(messages).toEqual([
			{ type: "paw:open-external", url: "https://example.com/post" },
		]);
		expect(e.wasPrevented()).toBe(true);
	});

	it("still smooth-scrolls in-page #anchors (no parent message)", () => {
		const scrollTarget = { scrollIntoView: () => {} };
		const { click, messages } = loadClick(scrollTarget);
		click(clickEvent(link("#section")));
		expect(messages).toEqual([]);
	});

	it("leaves mailto: links alone (no preventDefault, no message)", () => {
		const { click, messages } = loadClick();
		const e = clickEvent(link("mailto:hi@paw.test"));
		click(e);
		expect(messages).toEqual([]);
		expect(e.wasPrevented()).toBe(false);
	});
});

describe("shouldServeCompanion (authed-only gating)", () => {
	// Stand-in for authManager.validateSession: only "good" tokens validate.
	const validate = (t: string) => (t === "good" ? { user_id: 1 } : null);

	it("authed app-space route: admin set on the context → companion", () => {
		// validateSession should not even be consulted when admin is present.
		expect(
			shouldServeCompanion({
				admin: { id: 1 },
				validateSession: () => {
					throw new Error("should not be called");
				},
			}),
		).toBe(true);
	});

	it("public route + valid session cookie → companion", () => {
		expect(
			shouldServeCompanion({
				admin: undefined,
				sessionToken: "good",
				validateSession: validate,
			}),
		).toBe(true);
	});

	it("anonymous (no cookie) → no companion", () => {
		expect(
			shouldServeCompanion({ sessionToken: null, validateSession: validate }),
		).toBe(false);
		expect(
			shouldServeCompanion({ sessionToken: "", validateSession: validate }),
		).toBe(false);
	});

	it("public route + invalid/expired session cookie → no companion", () => {
		expect(
			shouldServeCompanion({
				sessionToken: "stale",
				validateSession: validate,
			}),
		).toBe(false);
	});
});

describe("companion launcher injection", () => {
	const LAUNCHER_MARKER = 'id="paw-cmp-launcher"';

	it("legacy one-arg injectCanvasRuntime injects NO companion", () => {
		const out = injectCanvasRuntime("<html><body>hi</body></html>");
		expect(out).not.toContain(LAUNCHER_MARKER);
		expect(out).not.toContain('"/companion"');
	});

	it("injectCanvasRuntime({ companion: false }) injects no companion", () => {
		const out = injectCanvasRuntime("<body>x</body>", { companion: false });
		expect(out).not.toContain(LAUNCHER_MARKER);
	});

	it("injectCanvasRuntime({ companion: true }) injects the launcher before </body>", () => {
		const out = injectCanvasRuntime("<html><body>page</body></html>", {
			companion: true,
		});
		expect(out).toContain(LAUNCHER_MARKER);
		// Lazy-loads the same-origin page-scoped Assistant console (with the host
		// page path as context) + self-gates to top-level / share-inner pages.
		expect(out).toContain('f.src="/canvas/assistant?path="');
		expect(out).toContain("window.top===window.self");
		// Original content preserved, launcher sits before </body>.
		expect(out).toContain("page");
		expect(out.indexOf(LAUNCHER_MARKER)).toBeLessThan(out.indexOf("</body>"));
		// Still includes the normal canvas runtime alongside it.
		expect(out).toContain("/api/canvas/events");
	});

	it("injectCompanionLauncher injects only the launcher (no canvas runtime)", () => {
		const out = injectCompanionLauncher("<html><body>wrap</body></html>");
		expect(out).toContain(LAUNCHER_MARKER);
		expect(out).toContain("wrap");
		expect(out.indexOf(LAUNCHER_MARKER)).toBeLessThan(out.indexOf("</body>"));
		// It does NOT add the form/refresh runtime (that's injectCanvasRuntime's job).
		expect(out).not.toContain("/api/canvas/events");
	});

	it("injectCompanionLauncher appends when there is no </body>", () => {
		const out = injectCompanionLauncher("<div>x</div>");
		expect(out.startsWith("<div>x</div>")).toBe(true);
		expect(out).toContain(LAUNCHER_MARKER);
	});

	it("the injected launcher is inert — carries no secret/token material", () => {
		const out = injectCanvasRuntime("<body></body>", { companion: true });
		// Only the static markup + the same-origin /companion URL ship; nothing
		// session/credential-bearing is ever baked into the page.
		for (const needle of [
			"paw_session",
			"bearer",
			"authorization",
			"secret",
			"api_key",
			"apikey",
			"vault",
			"password",
		]) {
			expect(out.toLowerCase()).not.toContain(needle);
		}
	});

	it("the launcher's cooked script parses and self-gates when framed", () => {
		const re = /<script>([\s\S]*?)<\/script>/g;
		const launcherHtml = injectCompanionLauncher("<body></body>");
		const scripts: string[] = [];
		let m: RegExpExecArray | null;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
		while ((m = re.exec(launcherHtml)) !== null) scripts.push(m[1]);
		expect(scripts.length).toBe(1);
		// Framed (window.top !== window.self) → returns early, never touches the DOM.
		const framedWin = { top: { a: 1 }, self: { b: 2 } };
		let getById = 0;
		const framedDoc = {
			getElementById() {
				getById++;
				return null;
			},
		};
		expect(() => {
			new Function("window", "document", scripts[0])(framedWin, framedDoc);
		}).not.toThrow();
		expect(getById).toBe(0); // self-gate short-circuited before any DOM access
	});
});

// ── Duplication fix (fix/canvas-companion-dup) ──────────────────────────────
// The launcher used to leave a VISIBLE (fixed-position) ✦ button in embedded
// frames — only the JS wiring self-gated, not the markup — so the /canvas/share
// wrapper (top-level launcher) plus its inner /api/canvas/preview iframe (a
// second injected launcher) painted TWO buttons. The fix: the markup is hidden
// by default and only revealed at true top-level, and injection is idempotent.
describe("companion launcher: single entry point per page", () => {
	const MARKER = 'id="paw-cmp-launcher"';
	const count = (s: string, needle: string): number =>
		s.split(needle).length - 1;

	const onlyScript = (html: string): string => {
		const re = /<script>([\s\S]*?)<\/script>/g;
		const scripts: string[] = [];
		let m: RegExpExecArray | null;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
		while ((m = re.exec(html)) !== null) scripts.push(m[1]);
		return scripts[scripts.length - 1]; // launcher script is injected last
	};

	it("each injection path adds exactly ONE launcher", () => {
		expect(
			count(injectCanvasRuntime("<body>p</body>", { companion: true }), MARKER),
		).toBe(1);
		expect(count(injectCompanionLauncher("<body>p</body>"), MARKER)).toBe(1);
	});

	it("a page touched by BOTH wrappers still injects only once", () => {
		// share-style: runtime first, then the wrapper launcher pass
		const both1 = injectCompanionLauncher(
			injectCanvasRuntime("<body>p</body>", { companion: true }),
		);
		expect(count(both1, MARKER)).toBe(1);
		// reverse order is also idempotent
		const both2 = injectCanvasRuntime(
			injectCompanionLauncher("<body>p</body>"),
			{
				companion: true,
			},
		);
		expect(count(both2, MARKER)).toBe(1);
	});

	it("anonymous visitor (companion off) → zero companion markup", () => {
		expect(count(injectCanvasRuntime("<body>p</body>"), MARKER)).toBe(0);
		expect(
			count(
				injectCanvasRuntime("<body>p</body>", { companion: false }),
				MARKER,
			),
		).toBe(0);
	});

	it("the launcher markup is HIDDEN by default (embedded frames never paint it)", () => {
		const html = injectCompanionLauncher("<body></body>");
		// The fixed-position launcher must default to display:none so a framed copy
		// stays invisible even though its self-gated script never runs.
		expect(html).toContain("#paw-cmp-launcher{bottom:20px;display:none;}");
		expect(html).toContain("#paw-cmp-launcher.paw-cmp-top{display:block;}");
	});

	it("framed: script returns early so the launcher is NEVER revealed", () => {
		const framedWin = { top: { a: 1 }, self: { b: 2 } };
		let revealed = false;
		const doc = {
			getElementById: () => ({
				classList: {
					add: () => {
						revealed = true;
					},
				},
				addEventListener: () => {},
			}),
		};
		new Function(
			"window",
			"document",
			onlyScript(injectCompanionLauncher("<body></body>")),
		)(framedWin, doc);
		expect(revealed).toBe(false); // never added paw-cmp-top → stays display:none
	});

	// A fuller harness: the toolbar script now also wires Edit Mode (document
	// listeners, fetch to the edit routes, sessionStorage resume). Run the whole
	// cooked script top-level with stubs — this is the footgun guard (catches
	// SyntaxError / ReferenceError from the template trap) plus a wiring check.
	function runToolbar(opts: { resume?: boolean; shareInner?: boolean } = {}) {
		const added: string[] = [];
		const docClasses: string[] = [];
		const docHandlers: Record<string, () => void> = {};
		const btnHandlers: Record<string, () => void> = {};
		const fetches: string[] = [];
		const store: Record<string, string> = opts.resume
			? { "paw-edit-resume": "1" }
			: {};

		const topWin: Record<string, unknown> = {
			location: {
				pathname: "/api/canvas/preview/market-report.html",
				reload() {},
			},
			getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
			confirm: () => true,
		};
		topWin.self = topWin;
		// shareInner: the page is framed (top !== self), but top is a same-origin
		// /canvas/share wrapper → the toolbar should still reveal.
		topWin.top = opts.shareInner
			? { location: { pathname: "/canvas/share/tok123" } }
			: topWin;

		const mkBtn = (name: string) => ({
			addEventListener: (_t: string, fn: () => void) => {
				btnHandlers[name] = fn;
			},
			setAttribute: () => {},
			disabled: false,
		});
		const frame = { src: "" };
		const byId: Record<string, unknown> = {
			"paw-cmp-launcher": { classList: { add: (c: string) => added.push(c) } },
			"paw-cmp-assistant": mkBtn("assistant"),
			"paw-cmp-edit": mkBtn("edit"),
			"paw-cmp-restore": mkBtn("restore"),
			"paw-cmp-panel": {
				classList: { toggle: () => true },
				setAttribute: () => {},
			},
			"paw-cmp-frame": frame,
		};
		const doc = {
			getElementById: (id: string) => byId[id] ?? null,
			addEventListener: (t: string, fn: () => void) => {
				docHandlers[t] = fn;
			},
			createElement: () => ({}) as Record<string, unknown>,
			body: { appendChild: () => {} },
			documentElement: {
				classList: {
					toggle: (c: string) => {
						docClasses.push(c);
						return true;
					},
				},
			},
		};
		const fetchStub = (url: string) => {
			fetches.push(url);
			return Promise.resolve({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ ok: true, changed: false }),
			});
		};
		const ss = {
			getItem: (k: string) => store[k] ?? null,
			setItem: (k: string, v: string) => {
				store[k] = v;
			},
			removeItem: (k: string) => {
				delete store[k];
			},
		};
		new Function(
			"window",
			"document",
			"fetch",
			"sessionStorage",
			"setTimeout",
			onlyScript(injectCompanionLauncher("<body></body>")),
		)(topWin, doc, fetchStub, ss, () => 0);
		return { added, docClasses, docHandlers, btnHandlers, fetches, frame };
	}

	it("top-level: reveals the toolbar and Assistant opens the page-scoped console", () => {
		const t = runToolbar();
		expect(t.added).toContain("paw-cmp-top");
		expect(typeof t.btnHandlers.assistant).toBe("function");
		t.btnHandlers.assistant();
		expect(t.frame.src).toBe(
			`/canvas/assistant?path=${encodeURIComponent("/api/canvas/preview/market-report.html")}`,
		);
	});

	it("share-inner: reveals when framed inside a same-origin /canvas/share wrapper", () => {
		// The inner preview is framed by the share wrapper; it must still reveal so
		// the shared page is editable (the wrapper carries no toolbar). Edit-prep
		// then maps the inner's own /api/canvas/preview/* URL (not the share token).
		const t = runToolbar({ shareInner: true });
		expect(t.added).toContain("paw-cmp-top");
		t.btnHandlers.edit();
		expect(t.fetches).toContain("/api/canvas/edit-prep");
	});

	it("Edit button enters edit mode via the edit-prep route", () => {
		const t = runToolbar();
		expect(typeof t.btnHandlers.edit).toBe("function");
		t.btnHandlers.edit();
		expect(t.fetches).toContain("/api/canvas/edit-prep");
	});

	it("resumes edit mode after the prep-triggered reload (sessionStorage flag)", () => {
		const t = runToolbar({ resume: true });
		// setMode(true) runs synchronously at load when the resume flag is set.
		expect(t.docClasses).toContain("paw-edit-on");
	});
});

describe("assistant console module", () => {
	const src = readFileSync(
		resolve(import.meta.dir, "../../src/web/public/companion/assistant.js"),
		"utf-8",
	);

	it("parses without a syntax error (compile guard)", () => {
		// new Function compiles the source (throws SyntaxError on bad JS) without
		// executing it — a cheap guard against shipping a broken console module.
		expect(() => new Function(src)).not.toThrow();
	});

	it("drives the canvas stream endpoint with the page path as context", () => {
		expect(src).toContain("/api/canvas/stream");
		expect(src).toContain("pagePath");
		// Reads the host page from its own ?path= query.
		expect(src).toContain('"path"');
		// Consumes the SSE stream and renders streamed text.
		expect(src).toContain("getReader");
		expect(src).toContain("text_delta");
	});
});
