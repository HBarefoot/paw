import type { ChannelPlugin, PluginContext } from "../../src/types/plugin.js";
import { N8nClient, resolveN8nConfig } from "./client.js";
import { createTools } from "./tools.js";

/**
 * n8n-health-probe — health probes for n8n workflows (per-workflow status,
 * inactivity sweep, recent failures). Resolves its n8n connection from its own
 * config block (token may be a `vault://n8n.token` ref) or PAW_N8N_* env; when
 * neither is present the tools register but return a clean "not configured"
 * error so the orphan-sweep cron degrades gracefully.
 *
 * NOTE: this committed plugin supersedes the ephemeral scaffold that a
 * skill_scaffold self-test wrote into the running container's plugins/ dir.
 */
export default class N8nHealthProbePlugin implements ChannelPlugin {
	readonly name = "n8n-health-probe";

	async register(ctx: PluginContext): Promise<void> {
		const conn = resolveN8nConfig(ctx.config, process.env);
		const client = conn ? new N8nClient(conn) : null;
		ctx.registerTools(createTools(client));
		if (!conn) {
			ctx.logger.info(
				"n8n-health-probe: no n8n connection configured — tools will report 'not configured'.",
			);
		}
	}

	async start(): Promise<void> {}
	async stop(): Promise<void> {}
	async health(): Promise<{ ok: boolean }> {
		return { ok: true };
	}
}
