import { App } from "@slack/bolt";
import type { ChannelPlugin, PluginContext } from "../../src/types/plugin.js";
import type {
	InboundMessage,
	OutboundMessage,
} from "../../src/types/message.js";
import { createSlackTools } from "./tools.js";
import { randomUUID } from "node:crypto";

export default class SlackPlugin implements ChannelPlugin {
	readonly name = "slack";
	private app: App | null = null;
	private ctx: PluginContext | null = null;
	private unsubOutbound: (() => void) | null = null;

	async register(ctx: PluginContext): Promise<void> {
		this.ctx = ctx;
		const config = ctx.config as Record<string, string>;

		this.app = new App({
			token: config.botToken || process.env.SLACK_BOT_TOKEN,
			appToken: config.appToken || process.env.SLACK_APP_TOKEN,
			signingSecret: config.signingSecret || process.env.SLACK_SIGNING_SECRET,
			socketMode: true,
		});

		// Register Slack tools with the kernel
		ctx.registerTools(createSlackTools(this.app));

		// Listen for all messages
		this.app.message(async ({ message, say }) => {
			// Skip bot messages and message subtypes (edits, deletes, etc.)
			if (message.subtype) return;
			if (!("text" in message) || !message.text) return;
			if ("bot_id" in message && message.bot_id) return;

			const threadTs =
				("thread_ts" in message ? message.thread_ts : message.ts) ?? message.ts;

			const inbound: InboundMessage = {
				id: randomUUID(),
				sessionId: `slack-${message.channel}-${threadTs}`,
				channel: "slack",
				content: message.text,
				user: { id: message.user ?? "unknown" },
				timestamp: message.ts,
				metadata: {
					slackChannel: message.channel,
					threadTs: threadTs,
				},
			};

			ctx.logger.info("Slack message received", {
				user: inbound.user.id,
				channel: message.channel,
			});
			await ctx.bus.emit("message:inbound", inbound);
		});

		// Listen for outbound messages to post replies
		this.unsubOutbound = ctx.bus.on(
			"message:outbound",
			async (msg: OutboundMessage) => {
				if (msg.channel !== "slack") return;
				if (!this.app) return;

				const slackChannel = msg.metadata?.slackChannel as string;
				const threadTs = msg.metadata?.threadTs as string;

				if (!slackChannel) return;

				try {
					await this.app.client.chat.postMessage({
						channel: slackChannel,
						text: msg.content,
						thread_ts: threadTs,
					});
				} catch (err) {
					ctx.logger.error("Failed to send Slack reply", {
						error: String(err),
					});
				}
			},
		);
	}

	async start(): Promise<void> {
		if (!this.app) throw new Error("SlackPlugin not registered");
		await this.app.start();
		this.ctx?.logger.info("Slack Socket Mode connected");
	}

	async stop(): Promise<void> {
		this.unsubOutbound?.();
		if (this.app) {
			await this.app.stop();
			this.app = null;
		}
	}

	async health(): Promise<{ ok: boolean; details?: string }> {
		if (!this.app) return { ok: false, details: "Not started" };
		try {
			const result = await this.app.client.auth.test();
			return { ok: result.ok ?? false, details: `Connected as ${result.user}` };
		} catch {
			return { ok: false, details: "Auth test failed" };
		}
	}
}
