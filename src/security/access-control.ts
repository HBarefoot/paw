import type { Database } from "bun:sqlite";
import type { Logger } from "../types/plugin.js";

export interface ApprovedUser {
	userId: string;
	channel: string;
	approvedAt: string;
	approvedBy: string | null;
}

/** The "I don't recognize you" reply shown to an unrecognized user. Includes
 *  the exact sender id the kernel keyed on so the operator can approve the RIGHT
 *  id (a relay like the Claude Slack app can present a different id than the
 *  channel UI implies). Pure + exported for unit testing. */
export function unrecognizedUserMessage(userId: string, code: string): string {
	return `Hi! I don't recognize you yet. Please ask an admin to approve your access, or enter this pairing code: *${code}*\n_(your id: ${userId})_`;
}

export class AccessController {
	private db: Database;
	private logger: Logger;
	private allowedUsers: string[];
	private blockedUsers: string[];
	private ownerUserIds: string[];
	private pairingTtlMinutes: number;
	// M-NEW-2: per-user rate limit on pairing-code attempts. Without
	// this, an attacker can brute-force 6 digits (10^6 possibilities)
	// in a few hours per user.
	private pairingAttempts = new Map<
		string,
		{ count: number; lockedUntil: number }
	>();
	private static readonly PAIRING_MAX_ATTEMPTS = 5;
	private static readonly PAIRING_LOCKOUT_MS = 15 * 60_000;

	constructor(
		db: Database,
		logger: Logger,
		opts: {
			allowedUsers?: string[];
			blockedUsers?: string[];
			ownerUserIds?: string[];
			pairingCodeTtlMinutes?: number;
		} = {},
	) {
		this.db = db;
		this.logger = logger;
		this.allowedUsers = opts.allowedUsers ?? [];
		this.blockedUsers = opts.blockedUsers ?? [];
		this.ownerUserIds = opts.ownerUserIds ?? [];
		this.pairingTtlMinutes = opts.pairingCodeTtlMinutes ?? 10;
	}

	/**
	 * Replace the in-memory access lists at runtime. The constructor seeds these
	 * from config once at boot; without this, persisting an allowlist/owner id
	 * via the web UI only took effect after a restart. Only the provided lists
	 * are replaced. Callers (e.g. /api/access/persist, /api/access/owner) pair
	 * this with a config write so the change is both live and durable.
	 */
	setAccessLists(opts: {
		allowedUsers?: string[];
		blockedUsers?: string[];
		ownerUserIds?: string[];
	}): void {
		if (opts.allowedUsers) this.allowedUsers = [...opts.allowedUsers];
		if (opts.blockedUsers) this.blockedUsers = [...opts.blockedUsers];
		if (opts.ownerUserIds) this.ownerUserIds = [...opts.ownerUserIds];
	}

	isUserApproved(userId: string, channel: string): boolean {
		// Blocked users are always rejected
		if (this.blockedUsers.includes(userId)) return false;

		// Operator/owner identities are always recognized — never pairing-gated
		// in their own workspace. This is the channel-agnostic equivalent of the
		// web-admin exemption (#129): a configured owner (e.g. their Slack user
		// id) is approved without an `approved_users` row or a pairing handshake.
		if (this.ownerUserIds.includes(userId)) return true;

		// Allowlist takes priority
		if (this.allowedUsers.length > 0 && this.allowedUsers.includes(userId))
			return true;

		// System users are always approved
		if (userId === "system") return true;

		// Check DB
		const row = this.db
			.prepare<{ user_id: string }, [string]>(
				"SELECT user_id FROM approved_users WHERE user_id = ?",
			)
			.get(userId);

		return row !== null;
	}

	isBlocked(userId: string): boolean {
		return this.blockedUsers.includes(userId);
	}

	generatePairingCode(userId: string): string {
		// Retrieve, don't regenerate: a still-valid code must stay stable across
		// repeated unrecognized messages. Minting a fresh code each time (the old
		// behavior) invalidated the one the user was just shown. Only mint when
		// there is no row or the existing code has expired.
		const existing = this.db
			.prepare<{ code: string; expires_at: string }, [string]>(
				"SELECT code, expires_at FROM pairing_codes WHERE user_id = ?",
			)
			.get(userId);
		if (existing && new Date(existing.expires_at) > new Date()) {
			return existing.code;
		}

		const buf = new Uint32Array(1);
		crypto.getRandomValues(buf);
		const code = String(100000 + (buf[0] % 900000));
		const expiresAt = new Date(
			Date.now() + this.pairingTtlMinutes * 60 * 1000,
		).toISOString();

		this.db.run(
			"INSERT OR REPLACE INTO pairing_codes (user_id, code, expires_at) VALUES (?, ?, ?)",
			[userId, code, expiresAt],
		);

		this.logger.info("Pairing code generated", {
			userId,
			expiresInMinutes: this.pairingTtlMinutes,
		});
		return code;
	}

	verifyPairingCode(userId: string, code: string): boolean {
		// M-NEW-2: per-user lockout after too many failed attempts.
		const attempts = this.pairingAttempts.get(userId);
		if (attempts && attempts.lockedUntil > Date.now()) {
			this.logger.warn("Pairing code verification locked out", {
				userId,
				lockedUntilMs: attempts.lockedUntil - Date.now(),
			});
			return false;
		}

		const row = this.db
			.prepare<{ code: string; expires_at: string }, [string]>(
				"SELECT code, expires_at FROM pairing_codes WHERE user_id = ?",
			)
			.get(userId);

		if (!row) {
			this.recordFailedAttempt(userId);
			return false;
		}

		// Check expiry
		if (new Date(row.expires_at) < new Date()) {
			this.db.run("DELETE FROM pairing_codes WHERE user_id = ?", [userId]);
			this.recordFailedAttempt(userId);
			return false;
		}

		if (row.code !== code) {
			this.recordFailedAttempt(userId);
			return false;
		}

		// Approve the user. Reset the failure counter on success.
		this.approveUser(userId, "pairing_code");
		this.db.run("DELETE FROM pairing_codes WHERE user_id = ?", [userId]);
		this.pairingAttempts.delete(userId);
		return true;
	}

	private recordFailedAttempt(userId: string): void {
		const existing = this.pairingAttempts.get(userId);
		const count = (existing?.count ?? 0) + 1;
		if (count >= AccessController.PAIRING_MAX_ATTEMPTS) {
			this.pairingAttempts.set(userId, {
				count,
				lockedUntil: Date.now() + AccessController.PAIRING_LOCKOUT_MS,
			});
			this.logger.warn("Pairing code lockout triggered", {
				userId,
				attempts: count,
				lockoutMs: AccessController.PAIRING_LOCKOUT_MS,
			});
		} else {
			this.pairingAttempts.set(userId, {
				count,
				lockedUntil: 0,
			});
		}
	}

	approveUser(userId: string, approvedBy = "admin", channel = "all"): void {
		this.db.run(
			"INSERT OR REPLACE INTO approved_users (user_id, channel, approved_by) VALUES (?, ?, ?)",
			[userId, channel, approvedBy],
		);
		// Clear any outstanding pairing code so an approved user no longer lingers
		// in the pending list (previously only verifyPairingCode deleted it, so a
		// page-/code-approved user showed forever as an "expired pending" row).
		this.clearPairing(userId);
		this.logger.info("User approved", { userId, approvedBy });
	}

	/** Drop a user's outstanding pairing code. Used when a user becomes
	 *  recognized by a path other than verifying the code (approve, persist,
	 *  make-owner) so they stop showing as a stale "expired pending" row. */
	clearPairing(userId: string): void {
		this.db.run("DELETE FROM pairing_codes WHERE user_id = ?", [userId]);
	}

	revokeUser(userId: string): void {
		this.db.run("DELETE FROM approved_users WHERE user_id = ?", [userId]);
		this.logger.info("User revoked", { userId });
	}

	/** Users who have an outstanding pairing code (asked the bot but not yet
	 *  approved). Drives the `/access` pending-approvals list. Already-recognized
	 *  ids (owner/allowlist/system/DB-approved) are filtered out — a recognized
	 *  user can't meaningfully be "pending", and a leftover code row otherwise
	 *  showed an owner as an "expired pending" row. */
	listPendingPairings(): Array<{
		userId: string;
		expiresAt: string;
		createdAt: string;
	}> {
		return this.db
			.prepare<{ user_id: string; expires_at: string; created_at: string }, []>(
				"SELECT user_id, expires_at, created_at FROM pairing_codes ORDER BY created_at DESC",
			)
			.all()
			.filter((r) => !this.isUserApproved(r.user_id, ""))
			.map((r) => ({
				userId: r.user_id,
				expiresAt: r.expires_at,
				createdAt: r.created_at,
			}));
	}

	listApprovedUsers(): ApprovedUser[] {
		return this.db
			.prepare<
				{
					user_id: string;
					channel: string;
					approved_at: string;
					approved_by: string | null;
				},
				[]
			>(
				"SELECT user_id, channel, approved_at, approved_by FROM approved_users ORDER BY approved_at",
			)
			.all()
			.map((r) => ({
				userId: r.user_id,
				channel: r.channel,
				approvedAt: r.approved_at,
				approvedBy: r.approved_by,
			}));
	}
}
