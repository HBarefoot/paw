import type {
	ChannelPlugin,
	PluginContext,
} from "../../src/types/plugin.js";
import { createTools } from "./tools.js";

/**
 * example-plugin plugin. Scaffolded by skill_scaffold — review before relying on it.
 * Loaded at boot; tools register under the on-demand "example-plugin" skill.
 */
export default class ExamplePluginPlugin implements ChannelPlugin {
	readonly name = "example-plugin";

	async register(ctx: PluginContext): Promise<void> {
		ctx.registerTools(createTools());
	}

	async start(): Promise<void> {}
	async stop(): Promise<void> {}
	async health(): Promise<{ ok: boolean }> {
		return { ok: true };
	}
}
