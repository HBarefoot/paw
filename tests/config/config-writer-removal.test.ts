import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	deleteConfigOverride,
	getConfigOverridesPath,
	readConfigOverrides,
	replaceConfigOverride,
} from "../../src/config/writer.js";
import { scrubPawEnv } from "../helpers/env.js";

let restore: () => void;
let dir: string;

beforeAll(() => {
	restore = scrubPawEnv();
	dir = mkdtempSync(resolve(tmpdir(), "paw-writer-removal-"));
	process.env.PAW_CONFIG_DIR = dir;
});
afterAll(() => {
	restore();
	rmSync(dir, { recursive: true, force: true });
});

function seed(obj: Record<string, unknown>): void {
	writeFileSync(join(dir, "config.json"), JSON.stringify(obj), "utf-8");
}
function onDisk(): Record<string, unknown> {
	return JSON.parse(readFileSync(getConfigOverridesPath(), "utf-8"));
}

describe("replaceConfigOverride — honors removals (Bug A)", () => {
	test("replacing mcpServers drops a removed server; unrelated keys + dbPath rule intact", () => {
		seed({
			mcpServers: {
				hubspot: { transport: "http" },
				brave: { transport: "http" },
			},
			store: { dbPath: "/somewhere/paw.db" },
			agent: { name: "Paw" },
		});

		// The MCP delete path: persist the full desired map wholesale.
		replaceConfigOverride("mcpServers", { brave: { transport: "http" } });

		const disk = onDisk();
		// Bug A: pre-fix this re-merged `hubspot` back in from disk.
		expect(Object.keys(disk.mcpServers as object)).toEqual(["brave"]);
		// Unrelated keys preserved.
		expect((disk.agent as { name: string }).name).toBe("Paw");
		// Infra guard still strips store.dbPath (and empties store).
		expect(disk.store).toBeUndefined();
	});

	test("removal survives a re-read (simulated reboot)", () => {
		seed({
			mcpServers: { a: { transport: "http" }, b: { transport: "http" } },
		});
		replaceConfigOverride("mcpServers", { a: { transport: "http" } });
		const reread = readConfigOverrides();
		expect(reread.mcpServers).toEqual({ a: { transport: "http" } });
	});

	test("the writer never persists workspace.playbooksRoot (infra guard)", () => {
		seed({ store: { dbPath: "/somewhere/paw.db" } });
		// Try to persist a workspace subtree that includes the infra-only root.
		replaceConfigOverride("workspace", {
			path: ".",
			playbooksRoot: "/data/playbooks",
		});
		const disk = onDisk();
		const ws = disk.workspace as Record<string, unknown>;
		// playbooksRoot must be stripped (it's driven by PAW_PLAYBOOKS_ROOT)...
		expect(ws.playbooksRoot).toBeUndefined();
		// ...while a legitimate sibling survives.
		expect(ws.path).toBe(".");
	});

	test("workspace is dropped entirely when playbooksRoot was its only key", () => {
		seed({});
		replaceConfigOverride("workspace", { playbooksRoot: "/data/playbooks" });
		expect(onDisk().workspace).toBeUndefined();
	});

	test("deleteConfigOverride removes a dotted key, preserving siblings", () => {
		seed({ github: { enabled: true, appId: "123" } });
		deleteConfigOverride("github.appId");
		const disk = onDisk();
		expect((disk.github as Record<string, unknown>).appId).toBeUndefined();
		expect((disk.github as Record<string, unknown>).enabled).toBe(true);
	});
});

describe("config-form agents clear (the second delete-by-merge caller)", () => {
	test("replacing agents drops a removed agent; siblings + dbPath rule intact", () => {
		seed({
			agents: {
				researcher: { description: "r" },
				writer: { description: "w" },
			},
			ai: { model: "x" },
			store: { dbPath: "/somewhere/paw.db" },
		});

		// What the FIXED /config handler now does: wholesale-replace agents so a
		// removed agent disappears. (Pre-fix it merged `overrides.agents` and the
		// removed `writer` re-merged back from disk.)
		replaceConfigOverride("agents", { researcher: { description: "r" } });

		const disk = onDisk();
		expect(Object.keys(disk.agents as object)).toEqual(["researcher"]);
		expect((disk.ai as { model: string }).model).toBe("x");
		expect(disk.store).toBeUndefined();
	});

	test("an empty agents map clears all agents ('clear all' actually clears)", () => {
		seed({ agents: { a: { description: "a" }, b: { description: "b" } } });
		replaceConfigOverride("agents", {});
		expect(onDisk().agents).toEqual({});
	});
});

describe("config-form handler uses the removal-honoring writer (source guard)", () => {
	const APP_SRC = readFileSync(
		fileURLToPath(new URL("../../src/web/app.ts", import.meta.url)),
		"utf8",
	);
	test("POST /config replaces the agents subtree instead of merging it", () => {
		// Fails on pre-fix code, where the handler did `overrides.agents =
		// agentsConfig` + saveConfigOverrides (deep-merge → removals lost).
		expect(APP_SRC).toContain('replaceConfigOverride("agents", agentsConfig)');
		expect(APP_SRC).not.toContain("overrides.agents = agentsConfig");
	});
});
