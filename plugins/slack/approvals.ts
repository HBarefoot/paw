/**
 * Pure helpers for Slack approval delivery — kept out of index.ts so they can be
 * unit-tested without a live Socket Mode connection.
 */

export const APPROVE_ACTION = "paw_approve";
export const DENY_ACTION = "paw_deny";

/** Parse an approval's `origin_ref` (JSON `{channel, threadTs}`) for a Slack row. */
export function parseSlackRef(
	ref: string | null,
): { channel: string; threadTs?: string } | null {
	if (!ref) return null;
	try {
		const o = JSON.parse(ref) as { channel?: string; threadTs?: string };
		if (o && typeof o.channel === "string" && o.channel) {
			return { channel: o.channel, threadTs: o.threadTs };
		}
	} catch {
		// not JSON
	}
	return null;
}

/** Block Kit message for an approve/deny prompt. The approval id rides in each
 * button's `value` so the action handler can resolve it. */
export function buildApprovalBlocks(opts: {
	id: string;
	summary: string;
	repo: string;
	requestedBy?: string | null;
}): unknown[] {
	const context = opts.requestedBy
		? `${opts.repo} · requested by ${opts.requestedBy}`
		: opts.repo;
	return [
		{
			type: "section",
			text: { type: "mrkdwn", text: `*Approval needed*\n${opts.summary}` },
		},
		{ type: "context", elements: [{ type: "mrkdwn", text: context }] },
		{
			type: "actions",
			block_id: `paw_approval_${opts.id}`,
			elements: [
				{
					type: "button",
					action_id: APPROVE_ACTION,
					style: "primary",
					text: { type: "plain_text", text: "Approve" },
					value: opts.id,
				},
				{
					type: "button",
					action_id: DENY_ACTION,
					style: "danger",
					text: { type: "plain_text", text: "Deny" },
					value: opts.id,
				},
			],
		},
	];
}

/** Final text shown after a Slack approval is resolved (buttons removed). */
export function resolvedText(
	status: string,
	actor: string,
	summary: string,
): string {
	const who = actor ? ` by <@${actor}>` : "";
	if (status === "executed") return `✅ Approved${who} — ${summary}`;
	if (status === "rejected") return `❌ Denied${who} — ${summary}`;
	if (status === "failed")
		return `⚠️ Approved${who} but the action failed — ${summary}`;
	if (status === "unauthorized")
		return `⛔ <@${actor}> isn't authorized to approve — ${summary}`;
	return `Approval resolved (${status}) — ${summary}`;
}
