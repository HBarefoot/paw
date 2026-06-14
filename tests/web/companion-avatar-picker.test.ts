import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	AVATAR_OPTIONS,
	getPreferencesScript,
} from "../../src/web/views/preferences-page.js";

// PR2: a picker (/preferences) + localStorage["paw-avatar"] persistence/live-swap
// + a curated set of robot avatars registered alongside the gel sphere.
const ROOT = new URL("../../src/web/public/companion/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, ROOT), "utf8");
const SHELL = read("shell.js");
const CSS = read("styles.css");

function loadCompanion(): {
	avatars: () => Array<{ key: string; label: string }>;
	getAvatar: (k?: string) => { key: string };
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
	// biome-ignore lint/suspicious/noExplicitAny: runtime surface
	return win.Companion as any;
}

describe("companion robot avatars + picker", () => {
	test("the curated robot variants register alongside the gel default", () => {
		const keys = loadCompanion()
			.avatars()
			.map((a) => a.key);
		expect(keys).toContain("gel");
		for (const k of ["robot-halo", "robot-visor", "robot-cylon", "robot-lcd"]) {
			expect(keys).toContain(k);
		}
	});

	test("a robot key resolves to its renderer; unknown falls back to gel", () => {
		const C = loadCompanion();
		expect(C.getAvatar("robot-halo").key).toBe("robot-halo");
		expect(C.getAvatar("robot-nope").key).toBe("gel");
	});

	test("expression mapping folds the engine's 9 states into the design's 7", () => {
		expect(SHELL).toContain("function mapRobotExp(");
		// worried + wince → error; listening → happy; waiting → thinking.
		expect(SHELL).toMatch(/case "worried":\s*case "wince":\s*return "error";/);
		expect(SHELL).toMatch(/case "listening":\s*return "happy";/);
		expect(SHELL).toMatch(
			/case "thinking":\s*case "waiting":\s*return "thinking";/,
		);
	});

	test("robot step is shared and reuses the central gaze target (not a private mousemove)", () => {
		expect(SHELL).toContain("function robotStep(");
		expect(SHELL).toContain("opts.gaze"); // consumes the central look-toward target
		expect(SHELL).toContain("step: robotStep");
		// honours reduced-motion
		expect(SHELL).toContain("if (!reduced)");
	});

	test("avatar persistence + live swap is wired (and cleaned up)", () => {
		expect(SHELL).toContain('localStorage.getItem("paw-avatar")');
		expect(SHELL).toContain("activeAvatarKey = resolveAvatarKey()");
		expect(SHELL).toContain("function swapAvatar(");
		expect(SHELL).toContain(
			'window.addEventListener("storage", onAvatarStorage)',
		);
		expect(SHELL).toContain(
			'window.removeEventListener("storage", onAvatarStorage)',
		);
	});

	test("robot CSS is scoped under .robot-face and brand-accent driven", () => {
		for (const sel of [
			".robot-face",
			".rf-halo",
			".rf-visor",
			".rf-cylon",
			".rf-lcd",
		]) {
			expect(CSS).toContain(sel);
		}
		// uses the inherited brand --accent (no per-variant hardcoded accent), with
		// the semantic error→warm override.
		expect(CSS).toContain('.robot-face[data-exp="error"]');
		expect(CSS).toContain("var(--accent)");
	});

	test("picker options stay in sync with the registry", () => {
		const registered = new Set(
			loadCompanion()
				.avatars()
				.map((a) => a.key),
		);
		for (const opt of AVATAR_OPTIONS) {
			expect(registered.has(opt.key)).toBe(true);
		}
		// gel + the 4 robots
		expect(AVATAR_OPTIONS.length).toBe(5);
	});

	test("preferences picker script parses and writes paw-avatar", () => {
		const script = getPreferencesScript();
		expect(() => new Function(script)).not.toThrow();
		expect(script).toContain('localStorage.setItem("paw-avatar", key)');
	});

	test("config seam: companion.avatar declared in BOTH schema + types", () => {
		const schema = readFileSync(
			new URL("../../src/config/schema.ts", import.meta.url),
			"utf8",
		);
		const types = readFileSync(
			new URL("../../src/types/config.ts", import.meta.url),
			"utf8",
		);
		expect(schema).toContain("companion: z");
		expect(schema).toContain("avatar: z.string().optional()");
		expect(types).toMatch(/companion:\s*\{\s*avatar\?: string;/);
	});
});
