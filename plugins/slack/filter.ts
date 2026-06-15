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

/** Real Slack user / workspace ids look like `U…` / `W…`. Used to (a) reject
 *  sender-controllable junk when recovering a human id and (b) guarantee a
 *  synthesized `app:`/`bot:` key can never collide with a real user id. */
const SLACK_USER_ID = /^[UW][A-Z0-9]+$/;

/** Where an inbound Slack turn actually came from. Carried on InboundMessage so
 *  the gate can label an app/bot sender — it NEVER decides recognition (the gate
 *  keys only on `user.id`). */
export interface InboundOrigin {
	botId?: string;
	appId?: string;
	relay?: boolean;
}

export interface InboundIdentity {
	/** The id the access gate keys on: a real Slack user id when recoverable,
	 *  else a synthesized, clearly app-sourced `app:<appId>` / `bot:<botId>`. */
	userId: string;
	origin: InboundOrigin;
	/** True when the sender is an app/bot (synthesized id), not a human user. */
	isApp: boolean;
}

/**
 * Message subtypes worth (re)processing as a turn. `undefined` = a plain user
 * message; `bot_message` = an app/relay post (e.g. "Sent using @Claude");
 * `file_share`/`thread_broadcast` carry real text. Everything else (edits,
 * deletes, joins/leaves, channel ops) is noise we must NOT treat as a new turn.
 * Replaces the old blanket `if (message.subtype) return`, which dropped relay
 * posts before the access gate could even see (and reveal) them.
 */
const REPROCESSABLE_SUBTYPES = new Set([
	"bot_message",
	"file_share",
	"thread_broadcast",
]);
export function isReprocessableSubtype(subtype?: string): boolean {
	return !subtype || REPROCESSABLE_SUBTYPES.has(subtype);
}

/**
 * Loop guard, evaluated BEFORE building an inbound. Skip a Slack event iff it is
 * PAW'S OWN post — matched by our bot user id (`user === botUserId`) OR our bot
 * id (`botId === ourBotId`). This is what keeps "respond to app/bot messages"
 * (so relayed turns are observable) from looping on Paw's own denials/replies,
 * which Slack re-delivers carrying our `bot_id`. It deliberately does NOT skip
 * OTHER apps' bot ids — those reach the gate and are denied-but-observable.
 */
export function shouldSkipSlackEvent(opts: {
	user?: string | null;
	botId?: string | null;
	botUserId?: string | null;
	ourBotId?: string | null;
}): boolean {
	const { user, botId, botUserId, ourBotId } = opts;
	if (user && botUserId && user === botUserId) return true;
	if (botId && ourBotId && botId === ourBotId) return true;
	return false;
}

/**
 * Derive the access-gate identity from a raw Slack message event + its Bolt
 * envelope `authorizations`.
 *
 * SECURITY — a relayed "@Claude" message is posted by the Claude *app*, so the
 * top-level `user`/`username` on a bot post are sender-controllable and MUST NOT
 * be trusted for identity. For an app/bot post we only adopt a human id from
 * Slack-POPULATED fields, in precedence order: `authorizations[].user_id` (where
 * `is_bot === false`), then `parent_user_id`, then the nested `message.user` of
 * an edit wrapper. If none is present we key on a synthesized, clearly
 * app-sourced `app:<appId>` (fallback `bot:<botId>`) — which carries NO standing
 * trust until an admin explicitly approves it, so the gate stays fail-closed.
 * A plain user message is unchanged: it keys on the top-level `user`.
 */
export function deriveInboundIdentity(opts: {
	event: Record<string, unknown>;
	authorizations?: Array<{ user_id?: string; is_bot?: boolean }>;
}): InboundIdentity {
	const { event, authorizations } = opts;
	const botId = typeof event.bot_id === "string" ? event.bot_id : undefined;
	const appId = typeof event.app_id === "string" ? event.app_id : undefined;
	const isAppPost = !!(botId || appId || event.subtype === "bot_message");
	const origin: InboundOrigin = {
		botId,
		appId,
		relay: isAppPost || undefined,
	};

	if (isAppPost) {
		// Case A — recover a real human id ONLY from Slack-populated fields.
		const asId = (v: unknown): string | undefined =>
			typeof v === "string" && SLACK_USER_ID.test(v) ? v : undefined;
		const fromAuthz = (authorizations ?? []).find(
			(a) => a && a.is_bot === false && asId(a.user_id),
		)?.user_id;
		const nested = (event.message as Record<string, unknown> | undefined)?.user;
		const human = asId(fromAuthz) ?? asId(event.parent_user_id) ?? asId(nested);
		if (human) return { userId: human, origin, isApp: false };

		// Case B — no recoverable human id → synthesized, clearly app-sourced key.
		if (appId) return { userId: `app:${appId}`, origin, isApp: true };
		if (botId) return { userId: `bot:${botId}`, origin, isApp: true };
	}

	// Plain user message (native DM / @mention) — unchanged.
	const topUser = typeof event.user === "string" ? event.user : "unknown";
	return { userId: topUser, origin, isApp: false };
}
