/**
 * Pure decision seam for inbound Slack messages — extracted so it can be unit
 * tested without a live Slack app (the project's pure-seam + test convention,
 * like resolveCronAction / resolveRateClass).
 *
 * Why this exists: Paw's Slack plugin listens to EVERY message in any channel
 * it's a member of. In a shared, multi-agent channel (e.g. #ai-operations with
 * Hermes + Paw) that meant Paw publicly pairing-gated any unrecognized sender
 * and reacted to bot chatter. In channels we now only act when Paw is
 * explicitly @mentioned; DMs are unchanged.
 */

export interface SlackMessageDecision {
	/** Whether the kernel should process this message at all. */
	handle: boolean;
	/** Message text with a leading bot mention stripped (channel mentions only). */
	text: string;
}

/**
 * Decide whether to handle an inbound Slack message and return the cleaned text.
 *
 * - Direct messages (`channel_type === "im"`) are always handled (unchanged).
 * - Any non-DM channel/group is handled ONLY when the text mentions the bot
 *   (`<@BOTUSERID>`); the mention token is stripped from the returned text.
 * - If the bot's own user id is unknown (e.g. a failed `auth.test`), fall back
 *   to handling the message so Paw never goes silent due to a transient failure.
 */
export function evaluateSlackMessage(opts: {
	channelType?: string;
	text: string;
	botUserId: string | null;
}): SlackMessageDecision {
	const { channelType, text, botUserId } = opts;

	// DMs: always handle, no mention required.
	if (channelType === "im") return { handle: true, text };

	// Unknown bot id → fail open (don't go silent on a transient auth.test miss).
	if (!botUserId) return { handle: true, text };

	const mention = `<@${botUserId}>`;
	if (!text.includes(mention)) return { handle: false, text };

	// Strip every occurrence of the mention token and tidy whitespace.
	const cleaned = text.split(mention).join(" ").replace(/\s+/g, " ").trim();
	return { handle: true, text: cleaned };
}
