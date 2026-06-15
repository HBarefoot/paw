import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { ApprovedUser } from "../../security/access-control.js";
import { Layout } from "./layout.js";

export interface PendingPairing {
	userId: string;
	expiresAt: string;
	createdAt: string;
}

export interface AccessPageProps {
	enabled: boolean;
	pending: PendingPairing[];
	approved: ApprovedUser[];
	/** Ids recognized from config (security.allowedUsers ∪ ownerUserIds) — these
	 *  survive a redeploy regardless of DB state, so they render as "persisted". */
	persistedIds: string[];
}

/** Human "expires in N min" / "expired" from an ISO timestamp, computed at
 *  render time. */
function expiryLabel(expiresAt: string): { text: string; expired: boolean } {
	const ms = new Date(expiresAt).getTime() - Date.now();
	if (Number.isNaN(ms)) return { text: "", expired: false };
	if (ms <= 0) return { text: "expired", expired: true };
	const mins = Math.round(ms / 60000);
	return { text: `expires in ${mins} min`, expired: false };
}

export const AccessPage: FC<AccessPageProps> = (props) => {
	const { enabled, pending, approved, persistedIds } = props;
	const persisted = new Set(persistedIds);

	return (
		<Layout title="Access" currentPath="/access">
			<div class="card mb-md">
				<h3>Access</h3>
				<p class="text-sm text-muted">
					Who is allowed to talk to the agent. When an unrecognized Slack user
					messages the bot, they appear under <strong>Pending</strong> below —
					approve them in one click and they get a "Access granted" DM, no
					pairing code needed. Approvals are stored in the database (persistent
					on a correctly-configured deploy). For a user who must{" "}
					<strong>always</strong> be recognized regardless of DB state, hit{" "}
					<strong>Persist</strong> on their row — it adds them to{" "}
					<code>security.allowedUsers</code> so they survive every redeploy. Set
					your own Slack id in <code>security.ownerUserIds</code> for the no-DB,
					always-recognized owner path.
				</p>
				{!enabled && (
					<div class="alert alert-error" style="margin-top:10px">
						Access control is not active on this kernel.
					</div>
				)}
			</div>

			{/* Pending approvals */}
			<div class="card mb-md">
				<h3 style="display:flex;align-items:center;gap:8px">
					Pending approvals <span class="badge">{pending.length}</span>
				</h3>
				{pending.length === 0 ? (
					<p class="text-sm text-muted">Nobody is waiting for approval.</p>
				) : (
					<div>
						{pending.map((p) => {
							const exp = expiryLabel(p.expiresAt);
							return (
								<div
									key={p.userId}
									style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid var(--border-primary);border-radius:9px;margin-bottom:8px"
								>
									<div>
										<code>{p.userId}</code>{" "}
										<span
											class="text-sm"
											style={
												exp.expired
													? "color:var(--error,#dc2626)"
													: "color:var(--text-muted)"
											}
										>
											· {exp.text}
										</span>
									</div>
									<button
										type="button"
										class="btn btn-primary"
										data-id={p.userId}
										onclick="acApprove(this.dataset.id)"
									>
										Approve
									</button>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Approved users */}
			<div class="card mb-md">
				<h3 style="display:flex;align-items:center;gap:8px">
					Approved users <span class="badge">{approved.length}</span>
				</h3>
				{approved.length === 0 ? (
					<p class="text-sm text-muted">No approved users yet.</p>
				) : (
					<div>
						{approved.map((u) => (
							<div
								key={u.userId}
								style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid var(--border-primary);border-radius:9px;margin-bottom:8px"
							>
								<div>
									<code>{u.userId}</code>
									<div class="text-sm text-muted">
										via {u.approvedBy ?? "unknown"} · {u.approvedAt}
										{u.channel && u.channel !== "all" ? ` · ${u.channel}` : ""}
									</div>
								</div>
								<div style="display:flex;align-items:center;gap:8px">
									{persisted.has(u.userId) ? (
										<span
											class="badge"
											title="In security.allowedUsers / ownerUserIds — recognized even if the DB is reset"
										>
											✓ survives redeploys
										</span>
									) : (
										<button
											type="button"
											class="btn btn-secondary"
											data-id={u.userId}
											onclick="acPersist(this.dataset.id)"
										>
											Persist
										</button>
									)}
									<button
										type="button"
										class="btn btn-secondary"
										data-id={u.userId}
										onclick="acRevoke(this.dataset.id)"
									>
										Revoke
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{raw(`<script>${accessScript()}</script>`)}
		</Layout>
	);
};

/** Inline page script. Exported (not inlined) so it can be unit-tested with
 *  `new Function(...)` — the template-trap guard convention. No regex literals
 *  or backslash escapes. */
export function accessScript(): string {
	return `
async function acApprove(userId) {
  var ok = await pawModal.confirm("Approve access", "Approve " + userId + " and DM them that access is granted?", { confirmLabel: "Approve" });
  if (!ok) return;
  try {
    var res = await fetch("/api/access/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId })
    });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) { pawModal.alert("Approve failed", data.error || ("HTTP " + res.status)); return; }
    pawToast("Approved " + userId);
    setTimeout(function(){ window.location.reload(); }, 500);
  } catch (e) { pawModal.alert("Approve failed", String(e)); }
}
async function acPersist(userId) {
  var ok = await pawModal.confirm("Persist access", "Add " + userId + " to security.allowedUsers so they're recognized after every redeploy?", { confirmLabel: "Persist" });
  if (!ok) return;
  try {
    var res = await fetch("/api/access/persist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId })
    });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) { pawModal.alert("Persist failed", data.error || ("HTTP " + res.status)); return; }
    pawToast("Persisted " + userId + " — survives redeploys");
    setTimeout(function(){ window.location.reload(); }, 500);
  } catch (e) { pawModal.alert("Persist failed", String(e)); }
}
async function acRevoke(userId) {
  var ok = await pawModal.confirm("Revoke access", "Revoke access for " + userId + "?", { danger: true, confirmLabel: "Revoke" });
  if (!ok) return;
  try {
    var res = await fetch("/api/access/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId })
    });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) { pawModal.alert("Revoke failed", data.error || ("HTTP " + res.status)); return; }
    pawToast("Revoked " + userId);
    setTimeout(function(){ window.location.reload(); }, 500);
  } catch (e) { pawModal.alert("Revoke failed", String(e)); }
}
`;
}
