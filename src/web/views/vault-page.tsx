import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";
import type { VaultScope, VaultSecretMeta } from "../../security/vault.js";

export interface VaultSlotStatus {
	name: string;
	scope: VaultScope;
	label: string;
	inVault: boolean;
}

/** Status of a provider/integration credential (Anthropic, OpenAI, Slack, …).
 *  Read-only Set/Missing + source; rotated via POST /api/credentials/:id. This
 *  is the provider-key surface (formerly the /settings "Secrets" tab), distinct
 *  from the vault's own encrypted secrets above. */
export interface SecretStatus {
	id: string;
	label: string;
	set: boolean;
	fromEnv?: boolean;
}

interface VaultPageProps {
	enabled: boolean;
	secrets: VaultSecretMeta[];
	slots: VaultSlotStatus[];
	/** Provider/integration credential statuses (Anthropic/OpenAI/Slack/…). */
	providerCredentials: SecretStatus[];
}

const SCOPES: VaultScope[] = [
	"custom",
	"ai",
	"slack",
	"strapi",
	"hubspot",
	"mcp",
	"n8n",
	"github",
];

export const VaultPage: FC<VaultPageProps> = ({
	enabled,
	secrets,
	slots,
	providerCredentials,
}) => {
	return (
		<Layout title="Vault" currentPath="/vault">
			<div class="card mb-md">
				<h3>Credential Vault</h3>
				<p class="text-sm text-muted">
					Web-managed secrets, encrypted at rest with AES-256-GCM. Values are{" "}
					<strong>never displayed</strong> and are resolved only server-side
					when wiring integrations — the AI agent and canvas pages can never
					read them. Reference custom secrets from config with{" "}
					<code>vault://&lt;name&gt;</code>. Vault values win over environment
					variables.
				</p>
			</div>

			{/* Provider credentials — read-only status + rotate (formerly the
			    /settings "Secrets" tab). Uses /api/credentials, independent of vault
			    enablement, so it renders regardless of the master-key state. */}
			<div class="card mb-md">
				<h3>Provider credentials</h3>
				<p class="text-sm text-muted mb-md">
					API keys for AI providers and Slack. Values are never displayed — use{" "}
					<strong>Rotate</strong> to replace a stored value. Restart the process
					for a running provider to pick up the new value.
				</p>
				{providerCredentials.length > 0 ? (
					<table class="audit-table">
						<thead>
							<tr>
								<th>Service</th>
								<th>Status</th>
								<th>Source</th>
								<th style="text-align:right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{providerCredentials.map((s) => (
								<tr key={s.id}>
									<td>{s.label}</td>
									<td>
										<span class={`badge ${s.set ? "success" : "neutral"}`}>
											{s.set ? "Set" : "Missing"}
										</span>
									</td>
									<td class="text-sm text-muted">
										{s.fromEnv ? "env var" : "credentials file"}
									</td>
									<td style="text-align:right">
										<button
											type="button"
											class="btn-secondary btn-sm"
											data-secret-id={s.id}
											data-secret-label={s.label}
											onclick="rotateSecret(this.dataset.secretId, this.dataset.secretLabel)"
										>
											Rotate
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<p class="text-sm text-muted">No provider credentials configured.</p>
				)}
			</div>

			{!enabled && (
				<div class="alert alert-error">
					<strong>Vault is disabled.</strong> Set a master key to enable
					encrypted secrets, then restart:
					<pre style="margin:8px 0 0;white-space:pre-wrap">
						PAW_VAULT_KEY=$(openssl rand -base64 32)
					</pre>
					Until then, Paw falls back to environment variables and
					~/.paw/credentials.json.
				</div>
			)}

			{enabled && (
				<>
					<div class="card mb-md">
						<h3>Add / rotate a secret</h3>
						<div
							style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;max-width:820px"
							id="vault-add"
						>
							<label style="flex:1;min-width:160px">
								<div class="text-sm text-muted">Name</div>
								<input
									id="v-name"
									type="text"
									placeholder="e.g. stripe-key or slack.botToken"
									list="v-slot-names"
									style="width:100%"
								/>
								<datalist id="v-slot-names">
									{slots.map((s) => (
										<option value={s.name}>{s.label}</option>
									))}
								</datalist>
							</label>
							<label style="min-width:120px">
								<div class="text-sm text-muted">Scope</div>
								<select id="v-scope" style="width:100%">
									{SCOPES.map((sc) => (
										<option value={sc}>{sc}</option>
									))}
								</select>
							</label>
							<label style="flex:2;min-width:200px">
								<div class="text-sm text-muted">Value</div>
								<input
									id="v-value"
									type="password"
									autocomplete="new-password"
									placeholder="Paste the secret value"
									style="width:100%"
								/>
							</label>
							<button type="button" class="btn-primary" onclick="vaultSave()">
								Save
							</button>
						</div>
						<p class="text-sm text-muted mt-md">
							Known integration slots (pick a name above):{" "}
							<code>ai.apiKey</code>, <code>slack.botToken</code>,{" "}
							<code>strapi.token</code>, <code>hubspot.token</code>,{" "}
							<code>n8n.token</code>, <code>mcp.&lt;server&gt;.authToken</code>.
							Changes take effect after a restart.
						</p>
					</div>

					<div class="card mb-md">
						<div style="display:flex;justify-content:space-between;align-items:center">
							<h3>Known integration slots</h3>
							<button
								type="button"
								class="btn-secondary btn-sm"
								onclick="vaultImport()"
							>
								Import from env / credentials.json
							</button>
						</div>
						<table class="audit-table">
							<thead>
								<tr>
									<th>Slot</th>
									<th>Name</th>
									<th>In vault?</th>
								</tr>
							</thead>
							<tbody>
								{slots.map((s) => (
									<tr>
										<td>{s.label}</td>
										<td>
											<code>{s.name}</code>
										</td>
										<td>
											<span
												class={`badge ${s.inVault ? "success" : "neutral"}`}
											>
												{s.inVault ? "Stored" : "—"}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<div class="card mb-md">
						<h3>Stored secrets ({secrets.length})</h3>
						{secrets.length === 0 ? (
							<p class="text-sm text-muted">No secrets stored yet.</p>
						) : (
							<table class="audit-table">
								<thead>
									<tr>
										<th>Name</th>
										<th>Scope</th>
										<th>Updated</th>
										<th>By</th>
										<th style="text-align:right">Actions</th>
									</tr>
								</thead>
								<tbody>
									{secrets.map((s) => (
										<tr>
											<td>
												<code>{s.name}</code>
											</td>
											<td>
												<span class="badge neutral">{s.scope}</span>
											</td>
											<td class="text-sm text-muted">{s.updatedAt}</td>
											<td class="text-sm text-muted">{s.updatedBy ?? "—"}</td>
											<td style="text-align:right">
												<button
													type="button"
													class="btn-danger btn-sm"
													data-name={s.name}
													onclick="vaultDelete(this.dataset.name)"
												>
													Delete
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>
				</>
			)}

			{raw(`<script>
async function vaultSave() {
  var name = (document.getElementById("v-name").value || "").trim();
  var scope = document.getElementById("v-scope").value;
  var value = document.getElementById("v-value").value || "";
  if (!name) { pawModal.alert("Missing name", "Enter a secret name."); return; }
  if (!value) { pawModal.alert("Missing value", "Paste the secret value."); return; }
  try {
    var res = await fetch("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, value: value, scope: scope })
    });
    if (!res.ok) {
      var err = await res.json().catch(function(){ return {}; });
      pawModal.alert("Save failed", err.error || ("HTTP " + res.status));
      return;
    }
    pawModal.alert("Saved", name + " stored. Restart for the change to take effect in running integrations.");
    setTimeout(function(){ window.location.reload(); }, 400);
  } catch (e) { pawModal.alert("Save failed", String(e)); }
}
async function vaultDelete(name) {
  var ok = await pawModal.confirm("Delete secret", "Delete \\"" + name + "\\"? This cannot be undone.", { danger: true, confirmLabel: "Delete" });
  if (!ok) return;
  try {
    var res = await fetch("/api/vault/" + encodeURIComponent(name), { method: "DELETE" });
    if (!res.ok) { pawModal.alert("Delete failed", "HTTP " + res.status); return; }
    window.location.reload();
  } catch (e) { pawModal.alert("Delete failed", String(e)); }
}
async function vaultImport() {
  var ok = await pawModal.confirm("Import secrets", "Copy current API keys and tokens from environment variables and ~/.paw/credentials.json into the encrypted vault? Existing vault entries with the same name are overwritten.", { confirmLabel: "Import" });
  if (!ok) return;
  try {
    var res = await fetch("/api/vault/import", { method: "POST" });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) { pawModal.alert("Import failed", data.error || ("HTTP " + res.status)); return; }
    pawModal.alert("Imported", (data.imported || 0) + " secret(s) copied into the vault.");
    setTimeout(function(){ window.location.reload(); }, 400);
  } catch (e) { pawModal.alert("Import failed", String(e)); }
}
async function rotateSecret(id, label) {
  var value = await pawModal.prompt("Rotate " + label, "Paste the new secret value. It will be written to the vault / credentials file and never displayed again.", "");
  if (!value) return;
  try {
    var res = await fetch("/api/credentials/" + encodeURIComponent(id), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: value })
    });
    if (!res.ok) { var err = await res.json().catch(function () { return {}; }); pawModal.alert("Rotate failed", err.error || ("HTTP " + res.status)); return; }
    pawModal.alert("Rotated", label + " was updated. Restart the process for the running provider to pick up the new value.");
    setTimeout(function () { window.location.reload(); }, 400);
  } catch (e) { pawModal.alert("Rotate failed", String(e)); }
}
</script>`)}
		</Layout>
	);
};
