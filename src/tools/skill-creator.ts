/**
 * Skill Creator — a meta-skill that scaffolds NEW paw plugins safely.
 *
 * SAFETY MODEL (non-negotiable): generated code is NEVER hot-loaded or executed
 * in the running kernel. Plugins are discovered only at boot
 * (src/kernel/plugin-loader.ts → kernel.boot()), so a scaffold lands as an
 * INERT directory pending a human review + restart. Generated stubs contain no
 * network calls and no secrets — every handler returns "not implemented".
 *
 * Grouped under the on-demand `skill-creator` skill via `plugin: "skill-creator"`.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ToolDefinition, ToolResult } from "../types/message.js";

export interface SkillCreatorDeps {
	/** Directory plugins are discovered from at boot (the scaffold target). */
	pluginsDir: string;
	/** Records a security-audit entry for write actions (action, details). */
	audit?: (action: string, details: Record<string, unknown>) => void;
}

/** Plugin/skill slug: lowercase, starts with a letter, dash-separated. */
const SLUG_RE = /^[a-z][a-z0-9-]*$/;
/** Tool + input-field identifiers: snake_case. */
const IDENT_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Permissions a scaffolded manifest may declare — the sandbox vocabulary. `net:`
 * is a prefix (host patterns); the rest are exact. Unknown permissions are
 * rejected so a scaffold can't claim something the sandbox won't honor.
 */
const EXACT_PERMISSIONS = new Set([
	"browser",
	"exec",
	"file:read",
	"file:write",
	"memory:read",
	"memory:write",
	"memory:forget",
	"cron:create",
	"agent:spawn",
	"agent:delegate",
	"skill:activate",
	"canvas:read",
	"canvas:write",
]);

const CONVENTIONS = [
	"Paw plugin conventions:",
	"- A plugin lives in plugins/<name>/ with a manifest.json and an index.ts.",
	"- manifest.json declares { name, version, description, permissions[] }. Permissions",
	"  are sandbox grants: net:<host>, browser, exec, file:read, file:write,",
	"  memory:read|write|forget, cron:create, agent:spawn, agent:delegate,",
	"  skill:activate, canvas:read|write. The sandbox enforces them at tool-call time.",
	"- index.ts default-exports a ChannelPlugin class (register/start/stop/health).",
	"  register(ctx) calls ctx.registerTools(...) to add tools to the registry.",
	"- Each tool has { name, description, plugin, input_schema (JSON Schema), handler }.",
	"  Tools carrying plugin:'<name>' group into the on-demand '<name>' skill.",
	"- Tests mirror src/ under tests/ and must pass from a clean checkout.",
	"- Secrets go in the vault (src/security/vault.ts KNOWN_SECRET_SLOTS +",
	"  overlayConfig), resolved server-side — never hardcode credentials.",
	"- Plugins load ONLY at boot. A scaffold is inert until you review it and",
	"  restart paw.",
].join("\n");

interface ToolSpec {
	name: string;
	description: string;
	inputFields?: Array<{
		name: string;
		type?: string;
		description?: string;
		required?: boolean;
	}>;
}

function pascal(slug: string): string {
	return slug
		.split("-")
		.filter(Boolean)
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join("");
}

/** Build a tool's JSON Schema object from its declared input fields. */
function buildInputSchema(fields: ToolSpec["inputFields"]): {
	type: "object";
	properties: Record<string, unknown>;
	required?: string[];
} {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];
	for (const f of fields ?? []) {
		properties[f.name] = {
			type: f.type ?? "string",
			...(f.description ? { description: f.description } : {}),
		};
		if (f.required) required.push(f.name);
	}
	return {
		type: "object",
		properties,
		...(required.length ? { required } : {}),
	};
}

function renderManifest(
	name: string,
	description: string,
	permissions: string[],
): string {
	return `${JSON.stringify(
		{ name, version: "0.1.0", description, permissions },
		null,
		2,
	)}\n`;
}

function renderToolsFile(name: string, tools: ToolSpec[]): string {
	const entries = tools
		.map((t) => {
			const schema = JSON.stringify(buildInputSchema(t.inputFields), null, "\t")
				.split("\n")
				.join("\n\t\t\t");
			return `\t\t{
\t\t\tname: ${JSON.stringify(t.name)},
\t\t\tdescription: ${JSON.stringify(t.description)},
\t\t\tplugin: ${JSON.stringify(name)},
\t\t\tinput_schema: ${schema},
\t\t\t// TODO: implement. Stubs return "not implemented" so the plugin is inert.
\t\t\thandler: async (): Promise<ToolResult> => ({
\t\t\t\tcontent: ${JSON.stringify(`${t.name} not implemented`)},
\t\t\t}),
\t\t}`;
		})
		.join(",\n");
	return `import type {
	ToolDefinition,
	ToolResult,
} from "../../src/types/message.js";

/**
 * Tools for the "${name}" plugin. Stubs return "not implemented" — fill in the
 * handlers, add tests under tests/, then restart paw to load.
 */
export function createTools(): ToolDefinition[] {
	return [
${entries},
	];
}
`;
}

function renderIndex(name: string): string {
	const cls = `${pascal(name)}Plugin`;
	return `import type {
	ChannelPlugin,
	PluginContext,
} from "../../src/types/plugin.js";
import { createTools } from "./tools.js";

/**
 * ${name} plugin. Scaffolded by skill_scaffold — review before relying on it.
 * Loaded at boot; tools register under the on-demand "${name}" skill.
 */
export default class ${cls} implements ChannelPlugin {
	readonly name = "${name}";

	async register(ctx: PluginContext): Promise<void> {
		ctx.registerTools(createTools());
	}

	async start(): Promise<void> {}
	async stop(): Promise<void> {}
	async health(): Promise<{ ok: boolean }> {
		return { ok: true };
	}
}
`;
}

function renderTest(name: string, tools: ToolSpec[]): string {
	const firstName = tools[0]?.name ?? "";
	return `import { describe, expect, test } from "bun:test";
import { createTools } from "./tools.js";

describe("${name} plugin tools", () => {
	test("registers its tools", () => {
		const names = createTools().map((t) => t.name);
${tools.map((t) => `\t\texpect(names).toContain(${JSON.stringify(t.name)});`).join("\n")}
	});

	test("stubs return 'not implemented' until you fill them in", async () => {
		const tool = createTools().find((t) => t.name === ${JSON.stringify(firstName)});
		const res = await tool?.handler({});
		expect(res?.content).toContain("not implemented");
	});
});
`;
}

function renderReadme(name: string, description: string): string {
	return `# ${name}\n\n${description}\n\n${CONVENTIONS}\n`;
}

export function createSkillCreatorTools(
	deps: SkillCreatorDeps,
): ToolDefinition[] {
	const audit = deps.audit ?? (() => {});
	const pluginsDir = resolve(deps.pluginsDir);

	const scaffold: ToolDefinition = {
		name: "skill_scaffold",
		description:
			"Scaffold a NEW paw plugin/skill: writes plugins/<name>/ with a manifest, an index.ts, a tools.ts of typed stub tools (returning 'not implemented'), a test skeleton, and a README. The code is INERT — it is never hot-loaded or executed; review it, then restart paw to load it. Refuses to overwrite an existing plugin.",
		plugin: "skill-creator",
		input_schema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Plugin slug (lowercase, dash-separated, e.g. weather).",
				},
				description: { type: "string", description: "What the plugin does." },
				permissions: {
					type: "array",
					items: { type: "string" },
					description:
						"Sandbox permissions to declare (e.g. net:api.example.com, file:read).",
				},
				tools: {
					type: "array",
					description: "Tools to stub out.",
					items: {
						type: "object",
						properties: {
							name: { type: "string", description: "Tool name (snake_case)." },
							description: {
								type: "string",
								description: "What the tool does.",
							},
							inputFields: {
								type: "array",
								description: "Input schema fields.",
								items: {
									type: "object",
									properties: {
										name: { type: "string" },
										type: {
											type: "string",
											description: "JSON Schema type (default string).",
										},
										description: { type: "string" },
										required: { type: "boolean" },
									},
									required: ["name"],
								},
							},
						},
						required: ["name", "description"],
					},
				},
			},
			required: ["name", "description"],
		},
		handler: async (input): Promise<ToolResult> => {
			const name = String(input.name ?? "");
			const description = String(input.description ?? "");
			const permissions = (input.permissions as string[] | undefined) ?? [];
			const tools = (input.tools as ToolSpec[] | undefined) ?? [];

			const fail = (msg: string): ToolResult => {
				audit("skill.scaffold.fail", { name, reason: msg });
				return { content: `skill_scaffold error: ${msg}`, is_error: true };
			};

			if (!SLUG_RE.test(name)) {
				return fail(
					`invalid plugin name "${name}" — use a lowercase, dash-separated slug starting with a letter.`,
				);
			}
			for (const p of permissions) {
				if (!p.startsWith("net:") && !EXACT_PERMISSIONS.has(p)) {
					return fail(
						`unknown permission "${p}". Allowed: net:<host>, ${[...EXACT_PERMISSIONS].join(", ")}.`,
					);
				}
			}
			for (const t of tools) {
				if (!t?.name || !IDENT_RE.test(t.name)) {
					return fail(
						`invalid tool name "${t?.name}" — use snake_case starting with a letter.`,
					);
				}
				for (const f of t.inputFields ?? []) {
					if (!f?.name || !IDENT_RE.test(f.name)) {
						return fail(
							`invalid input field "${f?.name}" on tool "${t.name}" — use snake_case.`,
						);
					}
				}
			}

			const dir = join(pluginsDir, name);
			if (existsSync(dir)) {
				return fail(`plugins/${name}/ already exists — refusing to overwrite.`);
			}

			try {
				mkdirSync(dir, { recursive: true });
				await Bun.write(
					join(dir, "manifest.json"),
					renderManifest(name, description, permissions),
				);
				await Bun.write(join(dir, "index.ts"), renderIndex(name));
				await Bun.write(join(dir, "tools.ts"), renderToolsFile(name, tools));
				await Bun.write(join(dir, `${name}.test.ts`), renderTest(name, tools));
				await Bun.write(
					join(dir, "README.md"),
					renderReadme(name, description),
				);
			} catch (err) {
				return fail(err instanceof Error ? err.message : String(err));
			}

			audit("skill.scaffold.ok", {
				name,
				permissions,
				toolCount: tools.length,
			});
			return {
				content: JSON.stringify({
					scaffolded: `plugins/${name}/`,
					files: [
						"manifest.json",
						"index.ts",
						"tools.ts",
						`${name}.test.ts`,
						"README.md",
					],
					tools: tools.map((t) => t.name),
					next: "Review the generated code, then RESTART paw to load it — plugins load only at boot; nothing was executed.",
				}),
			};
		},
	};

	const listConventions: ToolDefinition = {
		name: "skill_list_conventions",
		description:
			"Show the house rules for building a paw plugin/skill (manifest permissions, tool registration, tests, vault for secrets, boot-time-only loading) so you can fill in scaffolded stubs correctly.",
		plugin: "skill-creator",
		input_schema: { type: "object", properties: {} },
		handler: async (): Promise<ToolResult> => ({ content: CONVENTIONS }),
	};

	return [scaffold, listConventions];
}
