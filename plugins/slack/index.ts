import { randomUUID } from "node:crypto";
import { App } from "@slack/bolt";
import type {
	InboundMessage,
	OutboundMessage,
} from "../../src/types/message.js";
import type { ChannelPlugin, PluginContext } from "../../src/types/plugin.js";
import {
	APPROVE_ACTION,
	DENY_ACTION,
	buildApprovalBlocks,
	parseSlackRef,
	resolvedText,
} from "./approvals.js";
import { createSlackTools } from "./tools.js";

interface SavedApprovalMsg {
	channel: string;
	ts: string;
	summary: string;
}

export default class SlackPlugin implements ChannelPlugin {
	readonly name = "slack";
	private app: App | null = null;
	private ctx: PluginContext | null = null;
	private unsubOutbound: (() => void) | null = null;
	private unsubNotify: (() => void) | null = null;
	private unsubApprovalPending: (() => void) | null = null;
	private unsubApprovalResolved: (() => void) | null = null;

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

		// Proactive notifications: post every notification:created to the
		// configured channel (e.g. #ai-operations) so the agent reaches the user
		// even when they're not in the console. Bot must be a member of the channel.
		const notifyChannel =
			config.notifyChannel || process.env.SLACK_NOTIFY_CHANNEL;
		if (notifyChannel) {
			this.unsubNotify = ctx.bus.on("notification:created", async (n) => {
				if (!this.app) return;
				const emoji =
					n.level === "error"
						? "❌"
						: n.level === "warning"
							? "⚠️"
							: n.level === "success"
								? "✅"
								: "ℹ️";
				let text = `${emoji} *${n.title}*`;
				if (n.body) text += `\n${n.body}`;
				if (n.url) text += `\n${n.url}`;
				try {
					await this.app.client.chat.postMessage({
						channel: notifyChannel,
						text,
						unfurl_links: false,
					});
				} catch (err) {
					ctx.logger.error("Failed to post Slack notification", {
						error: String(err),
					});
				}
			});
		}

		// --- Approval delivery ---
		// Post a Block Kit approve/deny prompt to the originating Slack thread, and
		// resolve taps over the bus (authorization is done kernel-side).
		this.unsubApprovalPending = ctx.bus.on("approval:pending", async (a) => {
			if (!this.app || a.originChannel !== "slack") return;
			const ref = parseSlackRef(a.originRef);
			if (!ref) return;
			try {
				const res = await this.app.client.chat.postMessage({
					channel: ref.channel,
					thread_ts: ref.threadTs,
					text: `Approval needed: ${a.summary}`,
					blocks: buildApprovalBlocks({
						id: a.id,
						summary: a.summary,
						repo: a.repo,
						requestedBy: a.requestedBy,
					}) as never,
				});
				if (res.ok && res.ts) {
					ctx.store.set(`approval:${a.id}`, {
						channel: ref.channel,
						ts: res.ts,
						summary: a.summary,
					});
				}
			} catch (err) {
				ctx.logger.error("Failed to post Slack approval", {
					error: String(err),
				});
			}
		});

		this.app.action(APPROVE_ACTION, async ({ ack, body, action }) => {
			await ack();
			const id = (action as { value?: string }).value;
			const userId = (body as { user?: { id?: string } }).user?.id;
			if (!id || !userId) return;
			await ctx.bus.emit("approval:decision", {
				id,
				decision: "approve",
				actorChannel: "slack",
				actorUserId: userId,
			});
		});
		this.app.action(DENY_ACTION, async ({ ack, body, action }) => {
			await ack();
			const id = (action as { value?: string }).value;
			const userId = (body as { user?: { id?: string } }).user?.id;
			if (!id || !userId) return;
			await ctx.bus.emit("approval:decision", {
				id,
				decision: "reject",
				actorChannel: "slack",
				actorUserId: userId,
			});
		});

		// On resolution (from any surface) update the Slack message in place.
		this.unsubApprovalResolved = ctx.bus.on("approval:resolved", async (r) => {
			if (!this.app) return;
			const saved = ctx.store.get(`approval:${r.id}`) as
				| SavedApprovalMsg
				| undefined;
			if (!saved) return;
			const actor = r.decidedBy.startsWith("slack:")
				? r.decidedBy.slice("slack:".length)
				: "";
			const text = resolvedText(r.status, actor, saved.summary);
			try {
				await this.app.client.chat.update({
					channel: saved.channel,
					ts: saved.ts,
					text,
					blocks: [
						{ type: "section", text: { type: "mrkdwn", text } },
					] as never,
				});
			} catch (err) {
				ctx.logger.error("Failed to update Slack approval", {
					error: String(err),
				});
			}
			// Keep the record on unauthorized so a permitted user can still act.
			if (r.status !== "unauthorized") ctx.store.delete(`approval:${r.id}`);
		});
	}

	async start(): Promise<void> {
		if (!this.app) throw new Error("SlackPlugin not registered");
		await this.app.start();
		this.ctx?.logger.info("Slack Socket Mode connected");
	}

	async stop(): Promise<void> {
		this.unsubOutbound?.();
		this.unsubNotify?.();
		this.unsubApprovalPending?.();
		this.unsubApprovalResolved?.();
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
