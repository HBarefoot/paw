import type { AccessController } from "../security/access-control.js";
import type { RateLimiter } from "../security/rate-limiter.js";
import type { InboundMessage } from "../types/message.js";

/** Which gate denied an inbound turn — kept distinct so callers can report
 *  rate-limiting separately from access denial (the streaming path used to
 *  conflate both into a single opaque "Access denied or rate limited"). */
export type GateReason = "rate_limited" | "access_denied";

export type GateResult =
	| { ok: true }
	| { ok: false; reason: "rate_limited"; retryAfterMs: number }
	| { ok: false; reason: "access_denied" };

export interface GateDeps {
	/** True for cron/heartbeat/github/api — those bypass both gates. */
	isInternal: boolean;
	rateLimiter?: RateLimiter | null;
	accessController?: AccessController | null;
	/** DANGER opt-in (default false): allow unrecognized external-channel users
	 *  with no approval. The ONLY way to open external access — the absence of a
	 *  controller (e.g. misconfig / config-loss) otherwise fails CLOSED. */
	allowUnapprovedExternal?: boolean;
	/** True ONLY when this turn matched a `security.trustedRelayApps` entry (an
	 *  explicit app_id in an explicit owner channel). Computed by the caller via
	 *  `isTrustedRelay`. Default false → app/relay senders stay gated. */
	relayTrusted?: boolean;
}

/**
 * Whether an app-relayed turn matches a configured `trustedRelayApps` entry.
 * FAIL-CLOSED: false on any missing field or empty list; true only on an exact
 * (appId, channel) match. This is the ONLY way an app/bot-relayed message is
 * recognized without an explicit `approved_users` row — and it trusts the app
 * ONLY inside the named (owner-only) channel, never globally.
 */
export function isTrustedRelay(opts: {
	appId?: string;
	channelId?: string;
	trustedRelayApps?: { appId: string; channel: string }[];
}): boolean {
	const { appId, channelId, trustedRelayApps } = opts;
	if (!appId || !channelId || !trustedRelayApps?.length) return false;
	return trustedRelayApps.some(
		(t) => t.appId === appId && t.channel === channelId,
	);
}

/**
 * An authenticated web session has ALREADY passed web auth (password + optional
 * TOTP), so it must not be re-gated by the pairing-code access controller — that
 * controller exists for external channels (e.g. Slack). Internal channels are
 * exempt too. Rate limiting is intentionally NOT covered here: authenticated web
 * turns are still rate-limited.
 */
export function isAccessExempt(
	msg: InboundMessage,
	isInternal: boolean,
): boolean {
	return isInternal || msg.authenticated === true;
}

/**
 * FAIL-CLOSED access decision for a single inbound turn, shared by the streaming
 * (`evaluateInboundGate`) and non-streaming (`handleInbound`) paths so they can
 * never drift. A non-exempt (external) turn is DENIED when there is no
 * controller OR the user isn't approved. Critically, a **missing** controller
 * (the old default when `requireApproval` was false, or config-loss on redeploy)
 * denies — it never silently opens the agent to everyone. The only way to allow
 * unapproved external users is the explicit, default-off `allowUnapprovedExternal`.
 */
export function isExternalTurnDenied(
	msg: InboundMessage,
	deps: Pick<
		GateDeps,
		| "isInternal"
		| "accessController"
		| "allowUnapprovedExternal"
		| "relayTrusted"
	>,
): boolean {
	const {
		isInternal,
		accessController,
		allowUnapprovedExternal,
		relayTrusted,
	} = deps;
	if (isAccessExempt(msg, isInternal)) return false; // internal / authed web
	if (allowUnapprovedExternal) return false; // explicit opt-in to open
	if (relayTrusted) return false; // matched a configured trustedRelayApps entry
	return (
		!accessController ||
		!accessController.isUserApproved(msg.user.id, msg.channel)
	);
}

/**
 * Boot-time warning string when access control is NOT enforcing on a live
 * external channel — i.e. `allowUnapprovedExternal` is on and Slack (or another
 * external plugin) is active. Returns null when enforcing. Pure for testability.
 */
export function accessControlOffWarning(opts: {
	open: boolean;
	externalChannelActive: boolean;
}): string | null {
	if (opts.open && opts.externalChannelActive) {
		return "⚠ Access control is OFF (security.allowUnapprovedExternal=true) and an external channel (Slack) is enabled — the agent will respond to ANY user with no approval.";
	}
	return null;
}

/**
 * Pure inbound-turn gate: rate limiting first, then access control. Returns a
 * discriminated result so callers can yield/emit a distinct message per gate.
 * Note `rateLimiter.check()` consumes a token, so call this exactly once per
 * turn (mirrors the previous inline behaviour).
 */
export function evaluateInboundGate(
	msg: InboundMessage,
	deps: GateDeps,
): GateResult {
	const {
		isInternal,
		rateLimiter,
		accessController,
		allowUnapprovedExternal,
		relayTrusted,
	} = deps;

	// Rate limiting (skip for internal channels). Authenticated web sessions are
	// still rate-limited — only the access gate exempts them.
	if (!isInternal && rateLimiter) {
		const { allowed, retryAfterMs } = rateLimiter.check(msg.user.id);
		if (!allowed) {
			return {
				ok: false,
				reason: "rate_limited",
				retryAfterMs: retryAfterMs ?? 0,
			};
		}
	}

	// Access control — FAIL CLOSED for external turns (see isExternalTurnDenied).
	// Internal channels and authenticated web sessions stay exempt.
	if (
		isExternalTurnDenied(msg, {
			isInternal,
			accessController,
			allowUnapprovedExternal,
			relayTrusted,
		})
	) {
		return { ok: false, reason: "access_denied" };
	}

	return { ok: true };
}

/**
 * The user-facing message for a denied turn — distinct per reason so a rate
 * limit and an access denial never read the same (the streaming path used to
 * emit a single conflated "Access denied or rate limited"). Mirrors the
 * specific wording the non-streaming pairing path uses.
 */
export function gateDenialMessage(
	reason: GateReason,
	retryAfterMs?: number,
): string {
	if (reason === "rate_limited") {
		const seconds = Math.ceil((retryAfterMs ?? 0) / 1000);
		return `You're sending messages too fast. Please wait ${seconds} seconds.`;
	}
	return "Access denied. Please ask an admin to approve your access.";
}
