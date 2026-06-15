import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type {
	ProjectSummary,
	VercelStatus,
} from "../../integrations/vercel/types.js";
import { Layout } from "./layout.js";

export interface VercelPageProps {
	enabled: boolean;
	teamId: string;
	tokenInVault: boolean;
	vaultEnabled: boolean;
	/** Whether the integration actually initialized THIS boot (kernel.vercel !== null). */
	initialized: boolean;
	status: VercelStatus | null;
	projects: ProjectSummary[];
}

function StatusBadge({
	enabled,
	initialized,
	status,
}: {
	enabled: boolean;
	initialized: boolean;
	status: VercelStatus | null;
}) {
	if (!enabled) {
		return <span class="badge">Disabled</span>;
	}
	if (!initialized) {
		return (
			<span class="badge" style="background:var(--warning,#d97706);color:#fff">
				Configured — restart required
			</span>
		);
	}
	if (status?.ok) {
		return (
			<span class="badge" style="background:var(--success,#16a34a);color:#fff">
				Live
			</span>
		);
	}
	return (
		<span class="badge" style="background:var(--error,#dc2626);color:#fff">
			Error
		</span>
	);
}

export const VercelPage: FC<VercelPageProps> = (props) => {
	const {
		enabled,
		teamId,
		tokenInVault,
		vaultEnabled,
		initialized,
		status,
		projects,
	} = props;

	return (
		<Layout title="Vercel" currentPath="/vercel">
			<div class="card mb-md">
				<h3 style="display:flex;align-items:center;gap:10px">
					Vercel{" "}
					<StatusBadge
						enabled={enabled}
						initialized={initialized}
						status={status}
					/>
				</h3>
				<p class="text-sm text-muted">
					The agent provisions your public sites onto <strong>your own</strong>{" "}
					Vercel account + GitHub repo — Paw never serves them itself. It
					creates a Vercel project linked to the repo so pushes auto-deploy;
					irreversible actions (create project, add domain) are gated for your
					approval. The API token lives in the encrypted{" "}
					<a href="/vault">Vault</a> and is never exposed to the model.
				</p>
				{enabled && !initialized && (
					<div class="alert alert-error" style="margin-top:10px">
						<strong>Enabled, but not running yet.</strong> The integration
						initializes once at startup and only when the token is present in
						the Vault at that moment. <strong>Restart Paw</strong> (redeploy on
						Railway) to apply.
					</div>
				)}
			</div>

			{/* Connection */}
			<div class="card mb-md">
				<h3>Connection</h3>
				{initialized && status?.ok && (
					<div class="text-sm" style="display:grid;gap:6px">
						<div>
							Projects: <strong>{status.projectCount ?? 0}</strong>
						</div>
						<div>
							Team: <strong>{status.team || "personal account"}</strong>
						</div>
					</div>
				)}
				{initialized && status && !status.ok && (
					<div class="alert alert-error">
						<strong>Connection failed.</strong> {status.error}
					</div>
				)}
				{!initialized && (
					<p class="text-sm text-muted">
						Enable the integration below, add the token to the Vault, then
						restart Paw. The live connection status appears here once it's
						running.
					</p>
				)}
				<div style="margin-top:10px">
					<button type="button" class="btn btn-secondary" onclick="vcTest()">
						Test connection
					</button>
					<span id="vc-test-result" class="text-sm text-muted" />
				</div>
			</div>

			{/* Token (Vault) */}
			<div class="card mb-md">
				<h3>Token (Vault)</h3>
				{!vaultEnabled && (
					<div class="alert alert-error">
						The Vault is disabled (<code>PAW_VAULT_KEY</code> unset). Set it and
						restart to store the Vercel token securely.
					</div>
				)}
				<ul class="text-sm" style="line-height:1.9">
					<li>
						API token (<code>vercel.token</code>):{" "}
						{tokenInVault ? (
							<span style="color:var(--success,#16a34a)">stored ✓</span>
						) : (
							<span style="color:var(--error,#dc2626)">missing</span>
						)}{" "}
						<a href="/vault">Manage in Vault →</a>
					</li>
				</ul>
				<p class="text-sm text-muted" style="margin-top:6px">
					Create a token at vercel.com → Account Settings → Tokens, then store
					it in the Vault under the slot <code>vercel.token</code>. Restart for
					it to take effect.
				</p>
			</div>

			{/* Projects */}
			<div class="card mb-md">
				<h3>Projects</h3>
				{initialized && status?.ok && projects.length > 0 ? (
					<ul class="text-sm" style="line-height:1.9">
						{projects.map((p) => (
							<li key={p.id}>
								<strong>{p.name}</strong>{" "}
								<code class="text-muted">{p.framework ?? "—"}</code>
							</li>
						))}
					</ul>
				) : (
					<p class="text-sm text-muted">
						Your Vercel projects appear here once the integration is live.
					</p>
				)}
			</div>

			{/* Vercel↔GitHub prerequisite */}
			<div class="card mb-md">
				<h3>Before linked deploys work</h3>
				<p class="text-sm text-muted">
					To create a project <strong>linked to a GitHub repo</strong> (so
					pushes auto-deploy), connect your GitHub account to Vercel{" "}
					<strong>once</strong> in the Vercel dashboard (Account → Integrations
					→ GitHub). Paw links the repo, but it cannot perform that one-time
					OAuth handshake for you.
				</p>
			</div>

			{/* Settings */}
			<div class="card mb-md">
				<h3>Settings</h3>
				<form
					id="vc-settings"
					style="display:grid;gap:12px;max-width:560px;margin-top:8px"
				>
					<label style="display:flex;align-items:center;gap:8px">
						<input type="checkbox" id="vc-enabled" checked={enabled} />
						<span>Enabled</span>
					</label>
					<label>
						<div class="text-sm text-muted">
							Team ID (optional — leave blank for your personal account)
						</div>
						<input
							id="vc-teamId"
							type="text"
							value={teamId}
							placeholder="team_xxxxxxxx"
							style="width:100%"
						/>
					</label>
					<div>
						<button
							type="button"
							class="btn btn-primary"
							onclick="vcSaveSettings()"
						>
							Save settings
						</button>
						<span class="text-sm text-muted" style="margin-left:8px">
							Restart required to apply.
						</span>
					</div>
				</form>
			</div>

			{raw(`<script>${vercelScript()}</script>`)}
		</Layout>
	);
};

/** Inline page script. Exported (not inlined) so it can be unit-tested with
 *  `new Function(...)` — the template-trap guard convention. Keep it free of
 *  regex literals and backslash escapes. */
export function vercelScript(): string {
	return `
async function vcTest() {
  var el = document.getElementById("vc-test-result");
  el.textContent = " testing…";
  try {
    var res = await fetch("/api/vercel/status");
    var data = await res.json().catch(function(){ return {}; });
    if (!data.configured) { el.textContent = " not configured — enable it, add the token, and restart"; return; }
    if (data.ok) {
      el.textContent = " live — " + (data.projectCount || 0) + " projects" + (data.team ? (" (team " + data.team + ")") : "");
    } else {
      el.textContent = " error: " + (data.error || "unknown");
    }
  } catch (e) { el.textContent = " error: " + String(e); }
}
async function vcSaveSettings() {
  var payload = {
    enabled: document.getElementById("vc-enabled").checked,
    teamId: (document.getElementById("vc-teamId").value || "").trim()
  };
  try {
    var res = await fetch("/api/vercel/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      var err = await res.json().catch(function(){ return {}; });
      pawModal.alert("Save failed", err.error || ("HTTP " + res.status));
      return;
    }
    pawModal.alert("Saved", "Vercel settings stored. Restart Paw for the change to take effect.");
    setTimeout(function(){ window.location.reload(); }, 500);
  } catch (e) { pawModal.alert("Save failed", String(e)); }
}
`;
}
