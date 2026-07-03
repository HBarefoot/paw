import { describe, expect, test } from "bun:test";
import {
	deriveInboundIdentity,
	evaluateSlackMessage,
	isReprocessableSubtype,
	shouldSkipSlackEvent,
} from "../../plugins/slack/filter.js";

const BOT = "UPAWBOT";
const OWNER = "U0EXAMPLE01";

describe("evaluateSlackMessage — channel @mention gating", () => {
	test("DM is always handled, mention not required", () => {
		const d = evaluateSlackMessage({
			channelType: "im",
			text: "hey paw",
			botUserId: BOT,
		});
		expect(d.handle).toBe(true);
		expect(d.text).toBe("hey paw");
	});

	test("channel message WITHOUT a mention is ignored (no public pairing spam)", () => {
		const d = evaluateSlackMessage({
			channelType: "channel",
			text: "just chatting with the team",
			botUserId: BOT,
		});
		expect(d.handle).toBe(false);
	});

	test("channel message that @mentions the bot is handled, mention stripped", () => {
		const d = evaluateSlackMessage({
			channelType: "channel",
			text: `<@${BOT}> what's the status?`,
			botUserId: BOT,
		});
		expect(d.handle).toBe(true);
		expect(d.text).toBe("what's the status?");
		expect(d.text).not.toContain(BOT);
	});

	test("private group / mpim also require a mention", () => {
		expect(
			evaluateSlackMessage({
				channelType: "group",
				text: "no mention here",
				botUserId: BOT,
			}).handle,
		).toBe(false);
		expect(
			evaluateSlackMessage({
				channelType: "mpim",
				text: `ping <@${BOT}>`,
				botUserId: BOT,
			}).handle,
		).toBe(true);
	});

	test("a mention of a DIFFERENT user does not count", () => {
		const d = evaluateSlackMessage({
			channelType: "channel",
			text: "<@USOMEONE> please look",
			botUserId: BOT,
		});
		expect(d.handle).toBe(false);
	});

	test("unknown bot id fails OPEN (handles), so Paw never goes silent", () => {
		const d = evaluateSlackMessage({
			channelType: "channel",
			text: "hello",
			botUserId: null,
		});
		expect(d.handle).toBe(true);
		expect(d.text).toBe("hello");
	});
});

describe("isReprocessableSubtype — relay posts reach the gate, edits/deletes don't", () => {
	test("undefined (plain user message) and bot_message are reprocessable", () => {
		expect(isReprocessableSubtype(undefined)).toBe(true);
		expect(isReprocessableSubtype("bot_message")).toBe(true);
		expect(isReprocessableSubtype("file_share")).toBe(true);
	});
	test("edits/deletes/joins are NOT reprocessable", () => {
		expect(isReprocessableSubtype("message_changed")).toBe(false);
		expect(isReprocessableSubtype("message_deleted")).toBe(false);
		expect(isReprocessableSubtype("channel_join")).toBe(false);
	});
});

describe("shouldSkipSlackEvent — loop guard (skip ONLY Paw's own posts)", () => {
	test("our own bot_id is skipped (no self-loop on denials/replies)", () => {
		expect(shouldSkipSlackEvent({ botId: "BPAW", ourBotId: "BPAW" })).toBe(
			true,
		);
	});
	test("our own bot user id is skipped", () => {
		expect(
			shouldSkipSlackEvent({ user: BOT, botUserId: BOT, ourBotId: "BPAW" }),
		).toBe(true);
	});
	test("a DIFFERENT app's bot_id is NOT skipped (reaches the fail-closed gate)", () => {
		expect(
			shouldSkipSlackEvent({ botId: "BOTHER", ourBotId: "BPAW", user: "U9" }),
		).toBe(false);
	});
	test("a plain user message is not skipped", () => {
		expect(
			shouldSkipSlackEvent({ user: "U9", botUserId: BOT, ourBotId: "BPAW" }),
		).toBe(false);
	});
});

describe("deriveInboundIdentity — recover the human id, else a clearly app-sourced key", () => {
	test("Case A: a relayed bot_message whose authorizations carry the real owner id resolves to that id", () => {
		const id = deriveInboundIdentity({
			event: {
				subtype: "bot_message",
				app_id: "A0CLAUDE",
				bot_id: "B1",
				user: "B1",
				text: "hi",
			},
			authorizations: [{ user_id: OWNER, is_bot: false }],
		});
		expect(id.userId).toBe(OWNER); // NOT the bot/app id
		expect(id.isApp).toBe(false);
		expect(id.origin.relay).toBe(true);
		expect(id.origin.appId).toBe("A0CLAUDE");
	});

	test("Case A: parent_user_id / nested message.user are also recovered (Slack-populated)", () => {
		expect(
			deriveInboundIdentity({
				event: { subtype: "bot_message", app_id: "A0", parent_user_id: OWNER },
			}).userId,
		).toBe(OWNER);
		expect(
			deriveInboundIdentity({
				event: {
					subtype: "message_changed",
					bot_id: "B1",
					message: { user: OWNER },
				},
			}).userId,
		).toBe(OWNER);
	});

	test("a bot-authored authorization (is_bot:true) is NOT adopted as the human id", () => {
		const id = deriveInboundIdentity({
			event: { subtype: "bot_message", app_id: "A0CLAUDE", text: "hi" },
			authorizations: [{ user_id: "U_THE_BOT", is_bot: true }],
		});
		expect(id.userId).toBe("app:A0CLAUDE"); // fell through to the synthesized key
		expect(id.isApp).toBe(true);
	});

	test("Case B: an app-only relay with no recoverable human id → synthesized app:<id>", () => {
		const id = deriveInboundIdentity({
			event: {
				subtype: "bot_message",
				app_id: "A0123",
				bot_id: "B9",
				text: "hi",
			},
		});
		expect(id.userId).toBe("app:A0123");
		expect(id.isApp).toBe(true);
		expect(id.origin.relay).toBe(true);
	});

	test("Case B fallback to bot:<id> when only bot_id is present", () => {
		const id = deriveInboundIdentity({
			event: { bot_id: "B9", text: "hi" },
		});
		expect(id.userId).toBe("bot:B9");
		expect(id.isApp).toBe(true);
	});

	test("a sender-controllable top-level `user` on a bot post is NOT trusted for identity", () => {
		// The relay could set user to the owner id to impersonate — we ignore it and
		// key on the synthesized app id (only Slack-populated fields recover a human).
		const id = deriveInboundIdentity({
			event: {
				subtype: "bot_message",
				app_id: "A0123",
				user: OWNER,
				text: "hi",
			},
		});
		expect(id.userId).toBe("app:A0123");
		expect(id.isApp).toBe(true);
	});

	test("a plain native user message is unchanged (keys on top-level user)", () => {
		const id = deriveInboundIdentity({ event: { user: "U777", text: "hi" } });
		expect(id.userId).toBe("U777");
		expect(id.isApp).toBe(false);
		expect(id.origin.relay).toBeUndefined();
	});
});
