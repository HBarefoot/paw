import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

	test("deleteConfigOverride removes a dotted key, preserving siblings", () => {
		seed({ github: { enabled: true, appId: "123" } });
		deleteConfigOverride("github.appId");
		const disk = onDisk();
		expect((disk.github as Record<string, unknown>).appId).toBeUndefined();
		expect((disk.github as Record<string, unknown>).enabled).toBe(true);
	});
});
