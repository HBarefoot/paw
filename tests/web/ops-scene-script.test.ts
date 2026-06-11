import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The Dashboard agent-ops scene script (OPS_SCENE_SCRIPT in dashboard.tsx) lives
 * in a template literal, so the runtime "cooks" its backslashes before the browser
 * sees it — the same trap that broke the canvas portrait (a regex like /^\[..\]/
 * served as /^[..]/ → SyntaxError, killing the whole script). This test cooks the
 * literal, parses it, and runs the IIFE + a render frame against canvas/DOM stubs,
 * so both the backslash/regex trap and runtime ReferenceErrors fail CI.
 */
function extractScript(src: string): string {
	const marker = "const OPS_SCENE_SCRIPT = `";
	const open = src.indexOf(marker);
	if (open < 0) throw new Error("OPS_SCENE_SCRIPT not found");
	const start = open + marker.length;
	const end = src.indexOf("`;", start);
	if (end < 0) throw new Error("OPS_SCENE_SCRIPT end not found");
	// biome-ignore lint/security/noGlobalEval: test-only — cooking the template
	const cooked = eval(`\`${src.slice(start, end)}\``) as string;
	return cooked.replace(/^<script[^>]*>/, "").replace(/<\/script>\s*$/, "");
}

// Universal no-op canvas 2d context.
// biome-ignore lint/suspicious/noExplicitAny: intentionally loose test stub
function ctxStub(): any {
	return new Proxy(
		{},
		{
			get(_t, p) {
				if (p === "createRadialGradient" || p === "createLinearGradient")
					return () => ({ addColorStop() {} });
				return () => {};
			},
			set() {
				return true;
			},
		},
	);
}

// biome-ignore lint/suspicious/noExplicitAny: intentionally loose test stub
function elStub(): any {
	const kids: unknown[] = [];
	return {
		className: "",
		textContent: "",
		appendChild(c: unknown) {
			kids.push(c);
		},
		insertBefore(c: unknown) {
			kids.unshift(c);
		},
		removeChild() {
			kids.pop();
		},
		get children() {
			return kids;
		},
		get firstChild() {
			return kids[0] ?? null;
		},
		get lastChild() {
			return kids[kids.length - 1] ?? null;
		},
	};
}

// biome-ignore lint/suspicious/noExplicitAny: intentionally loose test stub
function canvasStub(): any {
	return {
		getContext: () => ctxStub(),
		getBoundingClientRect: () => ({ width: 600, height: 300 }),
		getAttribute: (k: string) =>
			k === "data-nodes"
				? '[{"key":"canvas","label":"Canvas","kind":"skill"},{"key":"memory","label":"Memory","kind":"skill"}]'
				: k === "data-model"
					? "test-model"
					: null,
		width: 0,
		height: 0,
	};
}

describe("dashboard ops-scene inline script", () => {
	const src = readFileSync(
		new URL("../../src/web/views/dashboard.tsx", import.meta.url),
		"utf8",
	);
	const js = extractScript(src);

	it("parses after the template literal cooks its escapes (no stripped-backslash regexes)", () => {
		expect(() => new Function(js)).not.toThrow();
	});

	it("runs the IIFE + a render frame against stubs without throwing", async () => {
		const elModel = elStub();
		// biome-ignore lint/suspicious/noExplicitAny: intentionally loose test stub
		const els: Record<string, any> = {
			"ops-canvas": canvasStub(),
			"ops-ticker": elStub(),
			"ops-model": elModel,
			"ops-status": elStub(),
		};
		const frames: Array<(ts: number) => void> = [];
		const win = {
			matchMedia: () => ({ matches: false }),
			devicePixelRatio: 1,
			addEventListener() {},
		};
		const doc = {
			getElementById: (id: string) => els[id] ?? null,
			createElement: () => elStub(),
		};
		const payload = {
			cursor: 5,
			working: true,
			model: "m",
			tools: [{ id: 5, tool: "canvas_list", skill: "canvas", ok: true }],
			turns: [],
			agents: [
				{
					id: "agent-1",
					name: "copy-writer",
					task: "draft the headline",
					done: false,
					ok: true,
					ageMs: 100,
				},
			],
		};
		const fetchStub = () =>
			Promise.resolve({ json: () => Promise.resolve(payload) });
		const raf = (fn: (ts: number) => void) => {
			frames.push(fn);
			return 1;
		};
		const gcs = () => ({ getPropertyValue: () => "#7458f5" });

		const run = new Function(
			"window",
			"document",
			"requestAnimationFrame",
			"setTimeout",
			"fetch",
			"getComputedStyle",
			js,
		);
		expect(() => run(win, doc, raf, () => 0, fetchStub, gcs)).not.toThrow();

		// Exercise a couple of render frames (drawCore/drawNode/drawWire paths).
		expect(typeof frames[0]).toBe("function");
		expect(() => {
			frames[0](16);
			frames[frames.length - 1](33);
		}).not.toThrow();

		// Let the baseline poll resolve; its handler must run clean enough to push
		// the live model into the HUD (catches ReferenceErrors in the poll body).
		await new Promise((r) => setTimeout(r, 10));
		expect(elModel.textContent).toBe("m");

		// A frame after the poll resolves exercises the satellite (sub-agent face)
		// draw path now that the fake `agents` payload has populated it.
		expect(() => frames[frames.length - 1](50)).not.toThrow();
	});
});
