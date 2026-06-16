import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { ApprovedUser } from "../../security/access-control.js";
import { Layout } from "./layout.js";

/** Security config shown on this page (relocated from the /settings "Security"
 *  tab). Saved via POST /api/security. */
export interface SecurityConfig {
	enforcePermissions: boolean;
	allowUnapprovedExternal: boolean;
	rateLimiting: { enabled: boolean; maxRequestsPerMinute: number };
}

/** Hidden-input + toggle button (mirrors the settings-page `Bool` control) so a
 *  plain form POST always submits "true"/"false". Driven by `pawToggle` in
 *  accessScript(). */
function Bool({ name, value }: { name: string; value: boolean }) {
	return (
		<span style="display:inline-flex">
			{raw(
				`<input type="hidden" name="${name}" value="${value ? "true" : "false"}">`,
			)}
			<button
				type="button"
				class={`toggle${value ? " on" : ""}`}
				onclick="pawToggle(this)"
			/>
		</span>
	);
}

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
	/** Ids in security.ownerUserIds — always recognized, channel-agnostic, no DB
	 *  row needed. Render an "Owner" badge; others get a "Make owner" button. */
	ownerIds: string[];
	/** Owner ids sourced from `PAW_SECURITY_OWNER_USER_IDS` (env). These can't be
	 *  changed by a config write, so the UI marks them read-only ("from env")
	 *  rather than offering a remove/toggle. */
	envIds?: string[];
	/** True when security.allowUnapprovedExternal is on — access control is NOT
	 *  enforcing on external channels. Renders a prominent OFF banner. */
	open: boolean;
	/** Security config (relocated from the /settings "Security" tab). */
	security: SecurityConfig;
}

/** Ids recognized purely from config — `security.allowedUsers ∪ ownerUserIds`,
 *  deduped. Defensive about missing fields: `liveConfig().security` can be a
 *  PARTIAL object (the config writer's shallow merge), so allowedUsers/
 *  ownerUserIds may be undefined at runtime even though the type says otherwise.
 *  Spreading those directly threw and 500'd /access. */
export function recognizedIds(
	security:
		| { allowedUsers?: string[]; ownerUserIds?: string[] }
		| null
		| undefined,
): string[] {
	return [
		...new Set([
			...(security?.allowedUsers ?? []),
			...(security?.ownerUserIds ?? []),
		]),
	];
}

/** True when a gated/approved id is a synthesized app/bot sender (`app:<id>` /
 *  `bot:<id>`) — a Slack app relayed the message (e.g. "Sent using @Claude") and
 *  Slack carried no recoverable human id. Such rows are flagged so an admin never
 *  blind-approves a shared app identity as if it were a person. */
export function isAppSourcedId(id: string): boolean {
	return id.startsWith("app:") || id.startsWith("bot:");
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
	const { enabled, pending, approved, persistedIds, ownerIds, open, security } =
		props;
	const persisted = new Set(persistedIds);
	const owners = new Set(ownerIds);
	const envOwners = new Set(props.envIds ?? []);
	// Config-recognized ids (security.allowedUsers ∪ ownerUserIds) that have NO
	// approved_users row — an env/config owner after a DB reset would otherwise be
	// invisible here (the prod "no Owners section, 0/0" symptom). Surface them so
	// the operator can SEE who is durably recognized without a DB row.
	const approvedIdSet = new Set(approved.map((u) => u.userId));
	const configOnlyIds = persistedIds.filter((id) => !approvedIdSet.has(id));

	return (
		<Layout title="Security & Access" currentPath="/access">
			{open && (
				<div
					class="alert alert-error mb-md"
					style="border-width:2px;font-weight:600"
				>
					⚠ Access control is OFF — anyone can talk to the agent. Unrecognized
					external (Slack) users are answered with no approval. Remove{" "}
					<code>security.allowUnapprovedExternal</code> (or set it false) to
					require approval.
				</div>
			)}
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
					always-recognized owner path. To make an owner that even a wiped{" "}
					<code>config.json</code> can't drop, set{" "}
					<code>PAW_SECURITY_OWNER_USER_IDS</code> in the environment (comma-
					separated) — it's unioned in on every boot and shown below as{" "}
					<em>from env</em>.
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
										{isAppSourcedId(p.userId) && (
											<span
												class="badge"
												style="background:var(--warning-bg,#7c5e10);color:var(--warning-fg,#ffd479)"
												title="App-sourced sender (a Slack app relayed this, e.g. @Claude) — approving trusts EVERY message that app relays into this channel, not one human. Prefer a native DM from the real user."
											>
												⚠ via app
											</span>
										)}{" "}
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
									{owners.has(u.userId) ? (
										<span
											class="badge"
											title="In security.ownerUserIds — always recognized, channel-agnostic, no DB row or pairing needed"
										>
											★ owner
										</span>
									) : (
										<button
											type="button"
											class="btn btn-secondary"
											data-id={u.userId}
											onclick="acOwner(this.dataset.id, true)"
											title="Add to security.ownerUserIds — always recognized regardless of DB state"
										>
											Make owner
										</button>
									)}
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

			{/* Recognized from config — owner/persisted ids with NO approved_users
			 *  row (they're recognized by config/env, not the DB). This is what makes
			 *  an env-declared owner visible after a DB reset. */}
			{configOnlyIds.length > 0 && (
				<div class="card mb-md">
					<h3 style="display:flex;align-items:center;gap:8px">
						Recognized from config{" "}
						<span class="badge">{configOnlyIds.length}</span>
					</h3>
					<p class="text-sm text-muted">
						Always recognized regardless of database state — sourced from{" "}
						<code>security.ownerUserIds</code> /{" "}
						<code>security.allowedUsers</code> (or the{" "}
						<code>PAW_SECURITY_*</code> env vars). No{" "}
						<code>approved_users</code> row needed.
					</p>
					<div>
						{configOnlyIds.map((id) => (
							<div
								key={id}
								style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid var(--border-primary);border-radius:9px;margin-bottom:8px"
							>
								<div>
									<code>{id}</code>
									<div class="text-sm text-muted">
										{owners.has(id) ? "owner" : "allowlisted"} · survives
										redeploys
									</div>
								</div>
								<div style="display:flex;align-items:center;gap:8px">
									{owners.has(id) && (
										<span
											class="badge"
											title="In security.ownerUserIds — always recognized, channel-agnostic, no DB row or pairing needed"
										>
											★ owner
										</span>
									)}
									{envOwners.has(id) ? (
										<span
											class="badge"
											title="Sourced from PAW_SECURITY_OWNER_USER_IDS — set in the environment, not editable from here"
										>
											from env
										</span>
									) : owners.has(id) ? (
										<button
											type="button"
											class="btn btn-secondary"
											data-id={id}
											onclick="acOwner(this.dataset.id, false)"
											title="Remove from security.ownerUserIds"
										>
											Remove owner
										</button>
									) : null}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Security settings — relocated from the /settings "Security" tab. */}
			<div class="card mb-md">
				<h3>Security settings</h3>
				<p class="text-sm text-muted mb-md">
					Global enforcement and rate-limiting. Some changes require a restart.
				</p>
				<form
					method="post"
					action="/api/security"
					class="flex-col gap-sm max-w-form"
				>
					<div class="flex items-center justify-between gap-sm">
						<div>
							<div>Enforce permissions</div>
							<div class="text-sm text-muted">
								Sandbox tool execution against manifests.
							</div>
						</div>
						<Bool
							name="security.enforcePermissions"
							value={security.enforcePermissions}
						/>
					</div>
					<div class="flex items-center justify-between gap-sm">
						<div>
							<div>⚠ Allow unapproved external users</div>
							<div class="text-sm text-muted">
								DANGER — when ON, unrecognized Slack users command the agent
								with no approval. Leave OFF to require approval.
							</div>
						</div>
						<Bool
							name="security.allowUnapprovedExternal"
							value={security.allowUnapprovedExternal}
						/>
					</div>
					<div class="flex items-center justify-between gap-sm">
						<div>
							<div>Rate limiting</div>
						</div>
						<Bool
							name="security.rateLimiting.enabled"
							value={security.rateLimiting.enabled}
						/>
					</div>
					<div class="flex items-center justify-between gap-sm">
						<div>
							<div>Max requests / min</div>
						</div>
						<input
							type="number"
							name="security.rateLimiting.maxRequestsPerMinute"
							value={String(security.rateLimiting.maxRequestsPerMinute)}
							min="1"
							style="width:90px"
						/>
					</div>
					<button type="submit" class="btn-primary self-start">
						Save settings
					</button>
				</form>
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
function pawToggle(btn) {
  var on = btn.classList.toggle("on");
  var inp = btn.previousElementSibling;
  if (inp) inp.value = on ? "true" : "false";
}
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
async function acOwner(userId, owner) {
  var ok = await pawModal.confirm("Make owner", "Add " + userId + " to security.ownerUserIds? Owners are always recognized in every channel with no DB row or pairing code.", { confirmLabel: "Make owner" });
  if (!ok) return;
  try {
    var res = await fetch("/api/access/owner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId, owner: owner })
    });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) { pawModal.alert("Make owner failed", data.error || ("HTTP " + res.status)); return; }
    pawToast(userId + " is now an owner — always recognized");
    setTimeout(function(){ window.location.reload(); }, 500);
  } catch (e) { pawModal.alert("Make owner failed", String(e)); }
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
