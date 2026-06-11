import { raw } from "hono/html";
import type { FC } from "hono/jsx";
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
</script>`)}
		</Layout>
	);
};
