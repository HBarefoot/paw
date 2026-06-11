import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { PendingActionRow } from "../../integrations/github/approvals.js";
import type { ConnectionStatus } from "../../integrations/github/types.js";
import { Layout } from "./layout.js";

export interface GitHubPageProps {
	enabled: boolean;
	appId: string;
	installationId: string;
	baseUrl: string;
	repoAllowlist: string[];
	privateKeyInVault: boolean;
	webhookSecretInVault: boolean;
	vaultEnabled: boolean;
	status: ConnectionStatus | null;
	pending: PendingActionRow[];
	recent: PendingActionRow[];
}

function StatusBadge({ status }: { status: ConnectionStatus | null }) {
	if (!status || !status.configured) {
		return <span class="badge">Not configured</span>;
	}
	if (status.ok) {
		return (
			<span class="badge" style="background:var(--success,#16a34a);color:#fff">
				Connected
			</span>
		);
	}
	return (
		<span class="badge" style="background:var(--error,#dc2626);color:#fff">
			Error
		</span>
	);
}

export const GitHubPage: FC<GitHubPageProps> = (props) => {
	const {
		enabled,
		appId,
		installationId,
		baseUrl,
		repoAllowlist,
		privateKeyInVault,
		webhookSecretInVault,
		vaultEnabled,
		status,
		pending,
		recent,
	} = props;

	const rate = status?.rateLimit;
	const ratePct = rate ? Math.round((rate.remaining / rate.limit) * 100) : 0;

	return (
		<Layout title="GitHub" currentPath="/github">
			<div class="card mb-md">
				<h3 style="display:flex;align-items:center;gap:10px">
					GitHub <StatusBadge status={status} />
				</h3>
				<p class="text-sm text-muted">
					The agent builds <strong>with control</strong>: it works on feature
					branches and opens pull requests, and you gate anything irreversible
					(merges, deletes) — it never pushes to <code>main</code> or
					force-pushes. Authentication is a GitHub <strong>App</strong>; its
					private key and webhook secret live in the encrypted{" "}
					<a href="/vault">Vault</a> and are never exposed to the model.
				</p>
			</div>

			{/* Connection + rate limit */}
			<div class="card mb-md">
				<h3>Connection</h3>
				{status?.configured && status.ok && (
					<div class="text-sm" style="display:grid;gap:6px">
						{status.appSlug && (
							<div>
								App: <strong>{status.appSlug}</strong>
							</div>
						)}
						<div>
							Repositories accessible: <strong>{status.repoCount ?? 0}</strong>
						</div>
						{rate && (
							<div>
								API rate limit: <strong>{rate.remaining}</strong> / {rate.limit}{" "}
								remaining
								<div
									style="height:6px;border-radius:4px;background:var(--bg-secondary,#222);margin-top:4px;overflow:hidden;max-width:280px"
									title={`${ratePct}% remaining`}
								>
									<div
										style={`height:100%;width:${ratePct}%;background:var(--accent,#7458f5)`}
									/>
								</div>
							</div>
						)}
					</div>
				)}
				{status?.configured && !status.ok && (
					<div class="alert alert-error">
						<strong>Connection failed.</strong> {status.error}
					</div>
				)}
				{!status?.configured && (
					<p class="text-sm text-muted">
						Fill in the App settings below and add the private key to the Vault,
						then restart Paw.
					</p>
				)}
				<div style="margin-top:10px">
					<button type="button" class="btn btn-secondary" onclick="ghTest()">
						Test connection
					</button>
					<span id="gh-test-result" class="text-sm text-muted" />
				</div>
			</div>

			{/* Repositories */}
			<div class="card mb-md">
				<h3>Repositories</h3>
				<div id="gh-repos" class="text-sm text-muted">
					{enabled ? "Loading…" : "Enable and configure the App to list repos."}
				</div>
			</div>

			{/* Open pull requests + diff viewer */}
			<div class="card mb-md">
				<h3>Open pull requests</h3>
				<div id="gh-prs" class="text-sm text-muted">
					{enabled ? "Loading…" : "—"}
				</div>
			</div>

			{/* Approvals inbox — the "with control" surface */}
			<div class="card mb-md">
				<h3 style="display:flex;align-items:center;gap:8px">
					Approvals
					<span id="gh-pending-count" class="badge">
						{pending.length}
					</span>
				</h3>
				<p class="text-sm text-muted">
					The agent queues irreversible actions (merge, delete branch, close
					issue, run workflow) here instead of doing them. Approve to execute,
					or reject. Updates live.
				</p>
				<div id="gh-pending-list">
					{pending.length === 0 && (
						<p class="text-sm text-muted" id="gh-pending-empty">
							Nothing waiting for approval.
						</p>
					)}
					{pending.map((a) => (
						<div
							key={a.id}
							class="gh-pending-item"
							data-id={a.id}
							style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid var(--border,#333);border-radius:8px;margin-bottom:8px"
						>
							<div>
								<div>
									<span class="badge">{a.action}</span>{" "}
									<strong>{a.summary}</strong>
								</div>
								<div class="text-sm text-muted">
									{a.repo} · requested {a.created_at}
								</div>
							</div>
							<div style="display:flex;gap:6px;flex-shrink:0">
								<button
									type="button"
									class="btn btn-primary"
									data-id={a.id}
									onclick="ghApprove(this.dataset.id)"
								>
									Approve
								</button>
								<button
									type="button"
									class="btn btn-secondary"
									data-id={a.id}
									onclick="ghReject(this.dataset.id)"
								>
									Reject
								</button>
							</div>
						</div>
					))}
				</div>
				{recent.length > 0 && (
					<details style="margin-top:8px">
						<summary class="text-sm text-muted">
							Recent decisions ({recent.length})
						</summary>
						<ul class="text-sm" style="line-height:1.8;margin-top:6px">
							{recent.map((a) => (
								<li key={a.id}>
									<span class="badge">{a.status}</span> {a.action} — {a.summary}
								</li>
							))}
						</ul>
					</details>
				)}
			</div>

			{/* Live activity feed (webhooks + approvals) */}
			<div class="card mb-md">
				<h3>Activity</h3>
				<div id="gh-activity" class="text-sm text-muted">
					Live updates (PRs, CI, approvals) appear here when the webhook is
					configured.
				</div>
			</div>

			{/* Secrets status */}
			<div class="card mb-md">
				<h3>Secrets (Vault)</h3>
				{!vaultEnabled && (
					<div class="alert alert-error">
						The Vault is disabled (<code>PAW_VAULT_KEY</code> unset). Set it and
						restart to store the GitHub App key securely.
					</div>
				)}
				<ul class="text-sm" style="line-height:1.9">
					<li>
						App private key (<code>github.appPrivateKey</code>):{" "}
						{privateKeyInVault ? (
							<span style="color:var(--success,#16a34a)">stored ✓</span>
						) : (
							<span style="color:var(--error,#dc2626)">missing</span>
						)}
					</li>
					<li>
						Webhook secret (<code>github.webhookSecret</code>):{" "}
						{webhookSecretInVault ? (
							<span style="color:var(--success,#16a34a)">stored ✓</span>
						) : (
							<span class="text-muted">not set (optional until Phase 3)</span>
						)}
					</li>
				</ul>
				<p class="text-sm text-muted">
					Add or rotate these on the <a href="/vault">Vault</a> page (paste the
					PEM as the value). Restart for changes to take effect.
				</p>
			</div>

			{/* Settings */}
			<div class="card mb-md">
				<h3>App settings</h3>
				<form id="gh-settings" style="display:grid;gap:12px;max-width:560px">
					<label style="display:flex;align-items:center;gap:8px">
						<input type="checkbox" id="gh-enabled" checked={enabled} />
						<span>Enabled</span>
					</label>
					<label>
						<div class="text-sm text-muted">App ID</div>
						<input
							id="gh-appId"
							type="text"
							value={appId}
							placeholder="e.g. 123456"
							style="width:100%"
						/>
					</label>
					<label>
						<div class="text-sm text-muted">Installation ID</div>
						<input
							id="gh-installationId"
							type="text"
							value={installationId}
							placeholder="e.g. 78901234"
							style="width:100%"
						/>
					</label>
					<label>
						<div class="text-sm text-muted">API base URL</div>
						<input
							id="gh-baseUrl"
							type="text"
							value={baseUrl}
							placeholder="https://api.github.com"
							style="width:100%"
						/>
					</label>
					<label>
						<div class="text-sm text-muted">
							Repo allowlist (one <code>owner/repo</code> per line) — the agent
							can only touch these
						</div>
						<textarea
							id="gh-allowlist"
							rows={4}
							placeholder={"HBarefoot/paw\nHBarefoot/another-repo"}
							style="width:100%;font-family:var(--font-mono,monospace)"
						>
							{repoAllowlist.join("\n")}
						</textarea>
					</label>
					<div>
						<button
							type="button"
							class="btn btn-primary"
							onclick="ghSaveSettings()"
						>
							Save settings
						</button>
						<span class="text-sm text-muted" style="margin-left:8px">
							Restart required to apply.
						</span>
					</div>
				</form>
			</div>

			{raw(`<script>
async function ghTest() {
  var el = document.getElementById("gh-test-result");
  el.textContent = " testing…";
  try {
    var res = await fetch("/api/github/status");
    var data = await res.json().catch(function(){ return {}; });
    if (!data.configured) { el.textContent = " not configured"; return; }
    if (data.ok) {
      var rem = data.rateLimit ? (data.rateLimit.remaining + "/" + data.rateLimit.limit + " API calls left") : "";
      el.textContent = " connected — " + (data.repoCount || 0) + " repos, " + rem;
    } else {
      el.textContent = " error: " + (data.error || "unknown");
    }
  } catch (e) { el.textContent = " error: " + String(e); }
}
async function ghSaveSettings() {
  var allow = (document.getElementById("gh-allowlist").value || "")
    .split("\\n").map(function(s){ return s.trim(); }).filter(Boolean);
  var payload = {
    enabled: document.getElementById("gh-enabled").checked,
    appId: (document.getElementById("gh-appId").value || "").trim(),
    installationId: (document.getElementById("gh-installationId").value || "").trim(),
    baseUrl: (document.getElementById("gh-baseUrl").value || "").trim() || "https://api.github.com",
    repoAllowlist: allow
  };
  try {
    var res = await fetch("/api/github/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      var err = await res.json().catch(function(){ return {}; });
      pawModal.alert("Save failed", err.error || ("HTTP " + res.status));
      return;
    }
    pawModal.alert("Saved", "GitHub settings stored. Restart Paw for the change to take effect.");
    setTimeout(function(){ window.location.reload(); }, 500);
  } catch (e) { pawModal.alert("Save failed", String(e)); }
}

// --- Approvals inbox (live) ---
function ghEsc(s) {
  return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function ghRenderPending(items) {
  var list = document.getElementById("gh-pending-list");
  var count = document.getElementById("gh-pending-count");
  if (count) count.textContent = items.length;
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = '<p class="text-sm text-muted">Nothing waiting for approval.</p>';
    return;
  }
  list.innerHTML = items.map(function(a) {
    return '<div class="gh-pending-item" data-id="' + ghEsc(a.id) + '" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid var(--border,#333);border-radius:8px;margin-bottom:8px">'
      + '<div><div><span class="badge">' + ghEsc(a.action) + '</span> <strong>' + ghEsc(a.summary) + '</strong></div>'
      + '<div class="text-sm text-muted">' + ghEsc(a.repo) + ' · requested ' + ghEsc(a.created_at) + '</div></div>'
      + '<div style="display:flex;gap:6px;flex-shrink:0">'
      + '<button type="button" class="btn btn-primary" data-id="' + ghEsc(a.id) + '" onclick="ghApprove(this.dataset.id)">Approve</button>'
      + '<button type="button" class="btn btn-secondary" data-id="' + ghEsc(a.id) + '" onclick="ghReject(this.dataset.id)">Reject</button>'
      + '</div></div>';
  }).join("");
}
async function ghRefreshPending() {
  try {
    var res = await fetch("/api/github/pending");
    var data = await res.json().catch(function(){ return {}; });
    ghRenderPending(data.pending || []);
  } catch (e) { /* ignore transient */ }
}
async function ghApprove(id) {
  var ok = await pawModal.confirm("Approve action", "Execute this GitHub action now?", { confirmLabel: "Approve" });
  if (!ok) return;
  try {
    var res = await fetch("/api/github/pending/" + encodeURIComponent(id) + "/approve", { method: "POST" });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) { pawModal.alert("Approve failed", data.error || ("HTTP " + res.status)); return; }
    if (data.status === "failed") { pawModal.alert("Action failed", (data.result && data.result.error) || "Execution failed."); }
    ghRefreshPending();
  } catch (e) { pawModal.alert("Approve failed", String(e)); }
}
async function ghReject(id) {
  var ok = await pawModal.confirm("Reject action", "Discard this pending action?", { danger: true, confirmLabel: "Reject" });
  if (!ok) return;
  try {
    var res = await fetch("/api/github/pending/" + encodeURIComponent(id) + "/reject", { method: "POST" });
    if (!res.ok) { var d = await res.json().catch(function(){ return {}; }); pawModal.alert("Reject failed", d.error || ("HTTP " + res.status)); return; }
    ghRefreshPending();
  } catch (e) { pawModal.alert("Reject failed", String(e)); }
}
// --- Repos + open PRs overview ---
function ghStatusDot(conclusion, status) {
  if (status && status !== "completed") return '<span class="gh-dot gh-dot-run" title="' + ghEsc(status) + '"></span>';
  if (conclusion === "success") return '<span class="gh-dot gh-dot-ok" title="success"></span>';
  if (conclusion === "failure") return '<span class="gh-dot gh-dot-bad" title="failure"></span>';
  return "";
}
async function ghLoadOverview() {
  try {
    var res = await fetch("/api/github/overview");
    var data = await res.json().catch(function(){ return {}; });
    var reposEl = document.getElementById("gh-repos");
    var prsEl = document.getElementById("gh-prs");
    var repos = data.repos || [];
    var prs = data.prs || [];
    if (reposEl) {
      reposEl.innerHTML = repos.length === 0
        ? "No repositories. Add an allowlisted repo and install the App on it."
        : repos.map(function(r){
            return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,#262626)">'
              + '<a href="' + ghEsc(r.url) + '" target="_blank" rel="noopener"><strong>' + ghEsc(r.fullName) + '</strong></a>'
              + '<span class="text-muted">' + (r.private ? "private" : "public") + ' · ' + ghEsc(r.defaultBranch) + '</span></div>';
          }).join("");
    }
    if (prsEl) {
      prsEl.innerHTML = prs.length === 0
        ? "No open pull requests."
        : prs.map(function(p){
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border,#262626)">'
              + '<div><a href="' + ghEsc(p.url) + '" target="_blank" rel="noopener"><strong>#' + p.number + '</strong> ' + ghEsc(p.title) + '</a>'
              + '<div class="text-muted text-sm">' + ghEsc(p.repo) + ' · ' + ghEsc(p.head) + ' → ' + ghEsc(p.base) + (p.draft ? " · draft" : "") + '</div></div>'
              + '<button type="button" class="btn btn-secondary" data-repo="' + ghEsc(p.repo) + '" data-num="' + p.number + '" onclick="ghShowDiff(this.dataset.repo, this.dataset.num)">View diff</button>'
              + '</div>'
              + '<div class="gh-diff-wrap" id="gh-diff-' + ghEsc(p.repo).replace(/[^a-zA-Z0-9]/g,"_") + '-' + p.number + '" style="display:none"></div>';
          }).join("");
    }
  } catch (e) { /* ignore */ }
}
function ghRenderDiff(text) {
  var lines = String(text || "").split("\\n");
  var out = "";
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i], cls = "";
    if (ln.indexOf("@@") === 0) cls = "gh-hunk";
    else if (ln.indexOf("+") === 0 && ln.indexOf("+++") !== 0) cls = "gh-add";
    else if (ln.indexOf("-") === 0 && ln.indexOf("---") !== 0) cls = "gh-del";
    out += '<span class="' + cls + '">' + ghEsc(ln) + '</span>\\n';
  }
  return out;
}
async function ghShowDiff(repo, num) {
  var id = "gh-diff-" + repo.replace(/[^a-zA-Z0-9]/g,"_") + "-" + num;
  var el = document.getElementById(id);
  if (!el) return;
  if (el.style.display !== "none") { el.style.display = "none"; return; }
  el.style.display = "block";
  el.innerHTML = '<pre class="gh-diff">loading…</pre>';
  try {
    var res = await fetch("/api/github/diff?repo=" + encodeURIComponent(repo) + "&number=" + encodeURIComponent(num));
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) { el.innerHTML = '<pre class="gh-diff">' + ghEsc(data.error || ("HTTP " + res.status)) + '</pre>'; return; }
    el.innerHTML = '<pre class="gh-diff">' + ghRenderDiff(data.diff) + '</pre>';
  } catch (e) { el.innerHTML = '<pre class="gh-diff">' + ghEsc(String(e)) + '</pre>'; }
}

// --- Activity feed ---
var ghActivity = [];
function ghPushActivity(ev) {
  var d = ev.data || {};
  var label = ev.event === "approval"
    ? ("approval · " + ghEsc(d.action || "") + " " + ghEsc(d.status || ""))
    : (ghEsc((d.type || "event")) + " · " + ghEsc(d.summary || ""));
  ghActivity.unshift(label);
  if (ghActivity.length > 30) ghActivity.pop();
  var el = document.getElementById("gh-activity");
  if (el) el.innerHTML = ghActivity.map(function(s){ return '<div style="padding:3px 0;border-bottom:1px solid var(--border,#262626)">' + s + '</div>'; }).join("");
}

// Poll the live event feed; refresh inbox/overview/activity on change.
(function ghPoll() {
  var since = 0;
  async function tick() {
    try {
      var res = await fetch("/api/github/events?since=" + since);
      var data = await res.json().catch(function(){ return {}; });
      var events = (data && data.events) || [];
      if (events.length > 0) {
        since = events[events.length - 1].id;
        var reload = false;
        for (var i = 0; i < events.length; i++) {
          ghPushActivity(events[i]);
          if (events[i].event === "webhook") reload = true;
        }
        ghRefreshPending();
        if (reload) ghLoadOverview();
      }
    } catch (e) { /* ignore */ }
    setTimeout(tick, 5000);
  }
  ghLoadOverview();
  setTimeout(tick, 5000);
})();
</script>
<style>
.gh-diff{max-height:420px;overflow:auto;background:var(--bg-secondary,#0d0d0d);border:1px solid var(--border,#262626);border-radius:8px;padding:10px;margin-top:8px;font-family:var(--font-mono,monospace);font-size:12px;line-height:1.5;white-space:pre}
.gh-diff .gh-add{color:#3fb950;display:block}
.gh-diff .gh-del{color:#f85149;display:block}
.gh-diff .gh-hunk{color:#58a6ff;display:block}
.gh-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.gh-dot-ok{background:#3fb950}.gh-dot-bad{background:#f85149}.gh-dot-run{background:#d29922}
</style>`)}
		</Layout>
	);
};
