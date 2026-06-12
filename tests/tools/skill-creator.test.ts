import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverPlugins } from "../../src/kernel/plugin-loader.js";
import { createSkillCreatorTools } from "../../src/tools/skill-creator.js";
import type { ToolDefinition } from "../../src/types/message.js";
import type { Logger, PluginContext } from "../../src/types/plugin.js";

// A scaffolded plugin's `../../src/...` imports only resolve when the plugin dir
// sits exactly two levels below the repo root — so the temp plugins dir must be
// a direct child of the repo root (hidden so `bun test` doesn't glob it).
const REPO_ROOT = resolve(import.meta.dir, "../..");
const TMP_PLUGINS = join(REPO_ROOT, ".paw-scaffold-test");

const noopLogger: Logger = {
	info() {},
	warn() {},
	error() {},
	debug() {},
};

function tool() {
	const t = createSkillCreatorTools({ pluginsDir: TMP_PLUGINS }).find(
		(x) => x.name === "skill_scaffold",
	);
	if (!t) throw new Error("skill_scaffold tool not found");
	return t;
}

const weatherSpec = {
	name: "weather",
	description: "Fetch weather data.",
	permissions: ["net:api.weather.com", "file:read"],
	tools: [
		{
			name: "get_forecast",
			description: "Get the forecast for a city.",
			inputFields: [
				{
					name: "city",
					type: "string",
					description: "City name.",
					required: true,
				},
			],
		},
	],
};

beforeEach(() => {
	rmSync(TMP_PLUGINS, { recursive: true, force: true });
});
afterAll(() => {
	rmSync(TMP_PLUGINS, { recursive: true, force: true });
});

describe("skill_scaffold", () => {
	test("scaffolds a discoverable, loadable plugin", async () => {
		const res = await tool().handler(weatherSpec);
		expect(res.is_error).toBeFalsy();
		expect(existsSync(join(TMP_PLUGINS, "weather", "index.ts"))).toBe(true);

		// The plugin-loader discovers it and instantiates the class.
		const loaded = await discoverPlugins(TMP_PLUGINS, noopLogger);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].plugin.name).toBe("weather");
		expect(loaded[0].manifest.permissions).toEqual([
			"net:api.weather.com",
			"file:read",
		]);

		// register() wires the stub tools into the registry.
		const registered: ToolDefinition[] = [];
		const ctx = {
			registerTools: (tools: ToolDefinition[]) => registered.push(...tools),
		} as unknown as PluginContext;
		await loaded[0].plugin.register(ctx);
		expect(registered.map((t) => t.name)).toContain("get_forecast");

		// Stubs are inert: they return "not implemented".
		const stub = registered.find((t) => t.name === "get_forecast");
		const out = await stub?.handler({ city: "Paris" });
		expect(out?.content).toContain("not implemented");
	});

	test("generated manifest permissions match the spec", async () => {
		await tool().handler(weatherSpec);
		const manifest = JSON.parse(
			readFileSync(join(TMP_PLUGINS, "weather", "manifest.json"), "utf-8"),
		);
		expect(manifest.name).toBe("weather");
		expect(manifest.version).toBe("0.1.0");
		expect(manifest.permissions).toEqual(["net:api.weather.com", "file:read"]);
	});

	test("refuses to overwrite an existing plugin", async () => {
		const first = await tool().handler(weatherSpec);
		expect(first.is_error).toBeFalsy();
		const second = await tool().handler(weatherSpec);
		expect(second.is_error).toBe(true);
		expect(second.content).toMatch(/already exists/);
	});

	test("rejects an invalid slug", async () => {
		const res = await tool().handler({
			name: "Bad Name",
			description: "x",
		});
		expect(res.is_error).toBe(true);
		expect(res.content).toMatch(/invalid plugin name/);
		expect(existsSync(join(TMP_PLUGINS, "Bad Name"))).toBe(false);
	});

	test("rejects an unknown permission", async () => {
		const res = await tool().handler({
			name: "danger",
			description: "x",
			permissions: ["root:everything"],
		});
		expect(res.is_error).toBe(true);
		expect(res.content).toMatch(/unknown permission/);
	});
});

describe("skill_list_conventions", () => {
	test("surfaces the house rules", async () => {
		const t = createSkillCreatorTools({ pluginsDir: TMP_PLUGINS }).find(
			(x) => x.name === "skill_list_conventions",
		);
		const res = await t?.handler({});
		expect(res?.content).toMatch(/manifest\.json/);
		expect(res?.content).toMatch(/load ONLY at boot/);
	});
});
