import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	readConfigOverrides,
	replaceConfigOverride,
	saveConfigOverrides,
} from "../../src/config/writer.js";
import { scrubPawEnv } from "../helpers/env.js";

// The headline trap behind the settings-consolidation refactor: POST /settings
// ALWAYS calls replaceConfigOverride("agents", agentsConfig) built only from
// agents[idx].* form fields. So a relocated Memory/Security config form posting
// there with no agent fields would WIPE the entire agents roster. The relocated
// forms therefore POST to dedicated endpoints (/api/memory/config, /api/security)
// that write ONLY their subtree via saveConfigOverrides (additive deep-merge).

let restore: () => void;
let dir: string;

beforeAll(() => {
	restore = scrubPawEnv();
	dir = mkdtempSync(resolve(tmpdir(), "paw-config-relocation-"));
	process.env.PAW_CONFIG_DIR = dir;
});
afterAll(() => {
	restore();
	rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
	writeFileSync(join(dir, "config.json"), "{}", "utf-8");
});

const ROSTER = {
	researcher: { description: "r", systemPrompt: "p", skills: ["a"] },
	writer: { description: "w", systemPrompt: "p", skills: ["b"] },
};

describe("relocated config writes preserve the agents roster (saveConfigOverrides is additive)", () => {
	test("a memory-config write leaves agents intact", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ agents: ROSTER }),
			"utf-8",
		);
		// What POST /api/memory/config does — write ONLY the memory subtree.
		saveConfigOverrides({
			memory: {
				enabled: false,
				autoExtract: true,
				vectorWeight: 0.5,
				ftsWeight: 0.5,
			},
		});
		const disk = readConfigOverrides();
		expect(Object.keys(disk.agents as object).sort()).toEqual([
			"researcher",
			"writer",
		]);
		expect((disk.memory as { enabled: boolean }).enabled).toBe(false);
	});

	test("a security-config write leaves agents AND sibling security ids intact", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({
				agents: ROSTER,
				security: { allowedUsers: ["U_KEEP"], ownerUserIds: ["U_OWN"] },
			}),
			"utf-8",
		);
		// What POST /api/security does — write ONLY the security config fields the
		// form owns; allowedUsers/ownerUserIds aren't in the form and must survive.
		saveConfigOverrides({
			security: {
				enforcePermissions: false,
				allowUnapprovedExternal: true,
				rateLimiting: { enabled: false, maxRequestsPerMinute: 99 },
			},
		});
		const disk = readConfigOverrides();
		expect(Object.keys(disk.agents as object).sort()).toEqual([
			"researcher",
			"writer",
		]);
		const sec = disk.security as Record<string, unknown>;
		expect(sec.allowedUsers).toEqual(["U_KEEP"]);
		expect(sec.ownerUserIds).toEqual(["U_OWN"]);
		expect(sec.allowUnapprovedExternal).toBe(true);
	});

	test("CONTROL: the POST /settings path (replaceConfigOverride('agents', {})) DOES wipe — which is exactly why the relocated forms must not use it", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ agents: ROSTER }),
			"utf-8",
		);
		replaceConfigOverride("agents", {});
		expect(readConfigOverrides().agents).toEqual({});
	});
});

describe("source guard: the relocated endpoints use the additive writer, never the agents-wipe path", () => {
	const APP_SRC = readFileSync(
		fileURLToPath(new URL("../../src/web/app.ts", import.meta.url)),
		"utf8",
	);

	/** Slice a route handler body from its `app.post("<path>"` to the next
	 *  top-level `\n\tapp.` registration so assertions are scoped to that handler. */
	function handlerBody(routePath: string): string {
		const start = APP_SRC.indexOf(`app.post("${routePath}"`);
		expect(start).toBeGreaterThan(-1);
		const next = APP_SRC.indexOf("\n\tapp.", start + 1);
		return APP_SRC.slice(start, next === -1 ? undefined : next);
	}

	test("POST /api/memory/config writes via saveConfigOverrides and never replaceConfigOverride('agents')", () => {
		const body = handlerBody("/api/memory/config");
		expect(body).toContain("saveConfigOverrides(");
		expect(body).not.toContain('replaceConfigOverride("agents"');
	});

	test("POST /api/security writes via saveConfigOverrides and never replaceConfigOverride('agents')", () => {
		const body = handlerBody("/api/security");
		expect(body).toContain("saveConfigOverrides(");
		expect(body).not.toContain('replaceConfigOverride("agents"');
	});

	test("replaceConfigOverride('agents', …) stays confined to the single POST /settings handler", () => {
		const occurrences =
			APP_SRC.split('replaceConfigOverride("agents"').length - 1;
		expect(occurrences).toBe(1);
	});
});
