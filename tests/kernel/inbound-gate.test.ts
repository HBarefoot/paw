import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	accessControlOffWarning,
	evaluateInboundGate,
	gateDenialMessage,
	isAccessExempt,
	isExternalTurnDenied,
} from "../../src/kernel/inbound-gate.js";
import { createLogger } from "../../src/observability/logger.js";
import { AccessController } from "../../src/security/access-control.js";
import { RateLimiter } from "../../src/security/rate-limiter.js";
import type { InboundMessage } from "../../src/types/message.js";

function msg(over: Partial<InboundMessage> = {}): InboundMessage {
	return {
		id: "m1",
		sessionId: "s1",
		channel: "web",
		content: "hello",
		user: { id: "web-1", name: "Admin" },
		timestamp: "2026-06-14T00:00:00.000Z",
		...over,
	};
}

describe("evaluateInboundGate", () => {
	let db: Database;
	let access: AccessController;
	let rate: RateLimiter;

	beforeEach(() => {
		db = new Database(":memory:");
		db.run(`CREATE TABLE IF NOT EXISTS approved_users (
      user_id TEXT PRIMARY KEY, channel TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT (datetime('now')), approved_by TEXT
    )`);
		db.run(`CREATE TABLE IF NOT EXISTS pairing_codes (
      user_id TEXT PRIMARY KEY, code TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
		access = new AccessController(db, createLogger("test"), {});
		// Generous cap so a single turn never trips the rate gate by accident.
		rate = new RateLimiter(30);
	});

	afterEach(() => {
		rate.destroy();
		db.close();
	});

	// The production bug: an authenticated web admin who is NOT in approved_users
	// was being access-denied on their first message. Pre-fix this returned an
	// access_denied; post-fix the authenticated flag exempts them.
	test("authenticated web admin (not in approved_users) is NOT access-denied", () => {
		expect(access.isUserApproved("web-1", "web")).toBe(false); // really not approved
		const result = evaluateInboundGate(msg({ authenticated: true }), {
			isInternal: false,
			rateLimiter: rate,
			accessController: access,
		});
		expect(result).toEqual({ ok: true });
	});

	// Regression guard for the pairing flow: external (Slack) users without the
	// authenticated flag stay fully gated.
	test("unapproved external (slack) user is still access-denied", () => {
		const result = evaluateInboundGate(
			msg({ channel: "slack", user: { id: "U123" } }),
			{ isInternal: false, rateLimiter: rate, accessController: access },
		);
		expect(result).toEqual({ ok: false, reason: "access_denied" });
	});

	test("an authenticated flag does NOT exempt an external channel from rate limiting", () => {
		const tight = new RateLimiter(1);
		const deps = {
			isInternal: false,
			rateLimiter: tight,
			accessController: access,
		};
		// First (authenticated) turn passes the access gate and consumes the token.
		expect(evaluateInboundGate(msg({ authenticated: true }), deps)).toEqual({
			ok: true,
		});
		// Second turn is rate-limited — distinct from access denial.
		const second = evaluateInboundGate(msg({ authenticated: true }), deps);
		expect(second.ok).toBe(false);
		expect(second).toMatchObject({ reason: "rate_limited" });
		tight.destroy();
	});

	test("rate-limited and access-denied are distinct reasons", () => {
		// access_denied path
		const denied = evaluateInboundGate(
			msg({ channel: "slack", user: { id: "U999" } }),
			{
				isInternal: false,
				rateLimiter: new RateLimiter(30),
				accessController: access,
			},
		);
		// rate_limited path (cap of 1, second call trips it)
		const tight = new RateLimiter(1);
		evaluateInboundGate(msg({ authenticated: true }), {
			isInternal: false,
			rateLimiter: tight,
			accessController: access,
		});
		const limited = evaluateInboundGate(msg({ authenticated: true }), {
			isInternal: false,
			rateLimiter: tight,
			accessController: access,
		});
		tight.destroy();

		expect(denied.ok).toBe(false);
		expect(limited.ok).toBe(false);
		if (!denied.ok && !limited.ok) {
			expect(denied.reason).toBe("access_denied");
			expect(limited.reason).toBe("rate_limited");
			expect(denied.reason).not.toBe(limited.reason);
		}
	});

	test("internal channels bypass both gates", () => {
		const result = evaluateInboundGate(
			msg({ channel: "cron", user: { id: "system" } }),
			{
				isInternal: true,
				rateLimiter: new RateLimiter(0),
				accessController: access,
			},
		);
		expect(result).toEqual({ ok: true });
	});

	test("rate limiting still applies to authenticated web (not exempt)", () => {
		const tight = new RateLimiter(0); // every check denied
		const result = evaluateInboundGate(msg({ authenticated: true }), {
			isInternal: false,
			rateLimiter: tight,
			accessController: access,
		});
		expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
		tight.destroy();
	});
});

// SECURITY REGRESSION: access control must FAIL CLOSED. With no controller
// (the old default when requireApproval was false, or config-loss on redeploy)
// an external Slack user used to get answered with no approval. Now denied.
describe("fail-closed access control", () => {
	const slack = msg({ channel: "slack", user: { id: "U123" } });

	test("external Slack turn with NO controller is access-denied (core regression)", () => {
		const result = evaluateInboundGate(slack, {
			isInternal: false,
			rateLimiter: null,
			accessController: null, // misconfigured / config lost
		});
		expect(result).toEqual({ ok: false, reason: "access_denied" });
	});

	test("authenticated web is exempt even with NO controller", () => {
		expect(
			evaluateInboundGate(msg({ authenticated: true }), {
				isInternal: false,
				rateLimiter: null,
				accessController: null,
			}),
		).toEqual({ ok: true });
	});

	test("internal channels are exempt even with NO controller", () => {
		for (const channel of ["cron", "heartbeat", "github", "api"]) {
			expect(
				evaluateInboundGate(msg({ channel, user: { id: "system" } }), {
					isInternal: true,
					rateLimiter: null,
					accessController: null,
				}),
			).toEqual({ ok: true });
		}
	});

	test("allowUnapprovedExternal:true opens external access (explicit opt-in)", () => {
		expect(
			evaluateInboundGate(slack, {
				isInternal: false,
				rateLimiter: null,
				accessController: null,
				allowUnapprovedExternal: true,
			}),
		).toEqual({ ok: true });
	});

	test("an owner (controller, no DB row) passes the external gate", () => {
		const odb = new Database(":memory:");
		odb.run(`CREATE TABLE IF NOT EXISTS approved_users (
      user_id TEXT PRIMARY KEY, channel TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT (datetime('now')), approved_by TEXT)`);
		const owned = new AccessController(odb, createLogger("test"), {
			ownerUserIds: ["U123"],
		});
		expect(
			evaluateInboundGate(slack, {
				isInternal: false,
				rateLimiter: null,
				accessController: owned,
			}),
		).toEqual({ ok: true });
		odb.close();
	});

	// The pure predicate both gates share.
	test("isExternalTurnDenied: denies external, allows exempt/opt-in", () => {
		const noCtrl = { isInternal: false, accessController: null };
		expect(isExternalTurnDenied(slack, noCtrl)).toBe(true);
		expect(isExternalTurnDenied(msg({ authenticated: true }), noCtrl)).toBe(
			false,
		);
		expect(
			isExternalTurnDenied(slack, { ...noCtrl, allowUnapprovedExternal: true }),
		).toBe(false);
	});
});

describe("accessControlOffWarning", () => {
	test("warns only when open AND an external channel is active", () => {
		expect(
			accessControlOffWarning({ open: true, externalChannelActive: true }),
		).toContain("Access control is OFF");
		expect(
			accessControlOffWarning({ open: false, externalChannelActive: true }),
		).toBeNull();
		expect(
			accessControlOffWarning({ open: true, externalChannelActive: false }),
		).toBeNull();
	});
});

describe("isAccessExempt", () => {
	test("internal channel is exempt", () => {
		expect(isAccessExempt(msg({ channel: "cron" }), true)).toBe(true);
	});
	test("authenticated web session is exempt", () => {
		expect(isAccessExempt(msg({ authenticated: true }), false)).toBe(true);
	});
	test("unauthenticated external session is NOT exempt", () => {
		expect(isAccessExempt(msg({ channel: "slack" }), false)).toBe(false);
	});
});

describe("gateDenialMessage", () => {
	test("rate-limited and access-denied produce DISTINCT messages", () => {
		const rateMsg = gateDenialMessage("rate_limited", 5000);
		const accessMsg = gateDenialMessage("access_denied");
		expect(rateMsg).not.toBe(accessMsg);
		// No longer the pre-fix conflated string.
		expect(rateMsg).not.toContain("Access denied or rate limited");
		expect(accessMsg).not.toContain("Access denied or rate limited");
		expect(rateMsg).toContain("5 seconds");
		expect(accessMsg.toLowerCase()).toContain("access denied");
	});
});
