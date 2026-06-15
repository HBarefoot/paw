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
import {
	deriveInboundIdentity,
	evaluateSlackMessage,
	isReprocessableSubtype,
	shouldSkipSlackEvent,
} from "./filter.js";
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
	/** This bot's own Slack user id, resolved at start() via auth.test. Used to
	 *  detect @mentions in shared channels and to ignore self-authored posts. */
	private botUserId: string | null = null;
	/** This bot's own Slack bot id (auth.test().bot_id) — the loop guard for the
	 *  app/bot path: Paw's own posts come back carrying THIS bot_id and must be
	 *  skipped, while OTHER apps' bot ids reach the (fail-closed) access gate. */
	private botId: string | null = null;
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
		this.app.message(async ({ message, body }) => {
			const m = message as unknown as Record<string, unknown>;
			const env = body as unknown as Record<string, unknown>;
			const authorizations = Array.isArray(env?.authorizations)
				? (env.authorizations as Array<{ user_id?: string; is_bot?: boolean }>)
				: undefined;
			// Diagnostic: log the RAW shape BEFORE any guard so relayed messages
			// (e.g. the Claude Slack app posting "on behalf of" a user) are fully
			// visible. `authorizations` is Slack-populated (NOT sender-controllable)
			// and is the field that reveals whether a real human id survives the
			// relay — the Case A vs Case B decision. See deriveInboundIdentity.
			ctx.logger.info("Slack inbound raw", {
				user: m.user,
				bot_id: m.bot_id,
				app_id: m.app_id,
				api_app_id: env?.api_app_id,
				subtype: m.subtype,
				username: m.username,
				parent_user_id: m.parent_user_id,
				nested_user: (m.message as Record<string, unknown> | undefined)?.user,
				authorizations,
				channel_type: m.channel_type,
				team: m.team ?? env?.team_id,
				hasText: typeof m.text === "string",
			});

			// Only (re)process real turns; skip edits/deletes/joins. A `bot_message`
			// (and file_share/thread_broadcast) DOES carry text and must reach the
			// access gate so a relayed sender is OBSERVABLE (id revealed + landed in
			// /access Pending), not silently dropped as before.
			if (!isReprocessableSubtype(m.subtype as string | undefined)) return;
			if (typeof m.text !== "string" || !m.text) return;
			// Loop guard: skip ONLY Paw's own posts (our bot_id / bot user id). Paw's
			// denial/reply is re-delivered carrying our bot_id and dropped here.
			// OTHER apps' bot ids fall through to the fail-closed access gate.
			if (
				shouldSkipSlackEvent({
					user: m.user as string | undefined,
					botId: m.bot_id as string | undefined,
					botUserId: this.botUserId,
					ourBotId: this.botId,
				})
			)
				return;

			// In shared/multi-agent channels only respond when explicitly
			// @mentioned; DMs (channel_type "im") are handled unchanged. This also
			// bounds the app/bot path: only DM'd or @mentioned bot posts reach the gate.
			const channelType = m.channel_type as string | undefined;
			const decision = evaluateSlackMessage({
				channelType,
				text: m.text,
				botUserId: this.botUserId,
			});
			if (!decision.handle) return;

			// Identity for the access gate: a real Slack user id when recoverable
			// from Slack-populated fields, else a synthesized, clearly app-sourced
			// `app:<id>`. Top-level `user` on a bot post is sender-controllable and
			// is never trusted for identity (see filter.ts).
			const identity = deriveInboundIdentity({ event: m, authorizations });

			const threadTs = (m.thread_ts as string | undefined) ?? (m.ts as string);

			const inbound: InboundMessage = {
				id: randomUUID(),
				sessionId: `slack-${m.channel}-${threadTs}`,
				channel: "slack",
				content: decision.text,
				user: { id: identity.userId },
				timestamp: m.ts as string,
				metadata: {
					slackChannel: m.channel,
					threadTs: threadTs,
				},
				origin: identity.origin,
			};

			ctx.logger.info("Slack message received", {
				user: inbound.user.id,
				isApp: identity.isApp,
				channel: m.channel,
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
		// Resolve our own user id so we can detect @mentions in shared channels
		// and ignore self-authored posts. Non-fatal: on failure botUserId stays
		// null and evaluateSlackMessage fails open (handles the message).
		try {
			const auth = await this.app.client.auth.test();
			this.botUserId = (auth.user_id as string | undefined) ?? null;
			this.botId = (auth.bot_id as string | undefined) ?? null;
			this.ctx?.logger.info("Slack Socket Mode connected", {
				botUserId: this.botUserId,
				botId: this.botId,
			});
		} catch (err) {
			this.ctx?.logger.warn("Slack auth.test failed; @mention gating off", {
				error: String(err),
			});
		}
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
