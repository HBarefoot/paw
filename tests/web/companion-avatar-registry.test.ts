import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// PR1: shell.js gained an avatar-renderer registry so the face TYPE (gel sphere
// today, robot later) is swappable while expression.js / gaze / mouth-sync /
// springs stay central. These assertions fail on the pre-refactor shell (no
// registry symbols, direct buildFace/stepFace in the avatar paths).
const ROOT = new URL("../../src/web/public/companion/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, ROOT), "utf8");
const SHELL_SRC = read("shell.js");

// Evaluate expression + spring + shell in one shared fake `window`, mirroring
// tests/web/companion-modules.test.ts. We only touch window.Companion's registry
// surface, which doesn't need a real DOM.
function loadCompanion(): {
	avatars: () => Array<{ key: string; label: string }>;
	getAvatar: (k?: string) => { key: string; build: unknown; step: unknown };
} {
	const win: Record<string, unknown> = {};
	const doc = { createElement: () => ({}), createElementNS: () => ({}) };
	const noop = () => {};
	class ROStub {
		observe() {}
		disconnect() {}
	}
	for (const m of ["expression.js", "spring.js", "shell.js"]) {
		new Function(
			"window",
			"document",
			"fetch",
			"setTimeout",
			"clearTimeout",
			"ResizeObserver",
			read(m),
		)(
			win,
			doc,
			() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
			noop,
			noop,
			ROStub,
		);
	}
	// biome-ignore lint/suspicious/noExplicitAny: test reads the runtime surface
	return win.Companion as any;
}

describe("companion avatar registry", () => {
	test("exposes an avatar list including the gel-sphere default", () => {
		const list = loadCompanion().avatars();
		expect(Array.isArray(list)).toBe(true);
		const gel = list.find((a) => a.key === "gel");
		expect(gel).toBeTruthy();
		expect(typeof gel?.label).toBe("string");
	});

	test("getAvatar resolves the gel renderer (build + step)", () => {
		const r = loadCompanion().getAvatar("gel");
		expect(r.key).toBe("gel");
		expect(typeof r.build).toBe("function");
		expect(typeof r.step).toBe("function");
	});

	test("getAvatar falls back to the default for an unknown / missing key", () => {
		const C = loadCompanion();
		expect(C.getAvatar("does-not-exist").key).toBe("gel");
		expect(C.getAvatar(undefined).key).toBe("gel");
	});

	test("gel step is the shared per-frame driver (registry didn't fork it)", () => {
		// stepFace(cmp, expr, now, opts) — 4 params.
		expect((loadCompanion().getAvatar("gel").step as () => void).length).toBe(
			4,
		);
	});

	test("avatar + sub-agent build and stepping route through the registry (source guard)", () => {
		expect(SHELL_SRC).toContain(
			'getAvatar(activeAvatarKey).build({ size: 178, theme: themeKey || "mint" })',
		);
		expect(SHELL_SRC).toContain("getAvatar(activeAvatarKey).build({"); // sub-agent
		expect(SHELL_SRC).toContain("getAvatar(activeAvatarKey).step(");
		// The old direct calls in those paths are gone.
		expect(SHELL_SRC).not.toContain("const cmp = buildFace(178);");
		expect(SHELL_SRC).not.toContain("stepFace(mainCmp,");
	});
});
