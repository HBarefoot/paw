import { describe, expect, test } from "bun:test";
import { evaluateSlackMessage } from "../../plugins/slack/filter.js";

const BOT = "UPAWBOT";

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
