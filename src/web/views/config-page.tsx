import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { PawConfig } from "../../types/config.js";
import { Layout } from "./layout.js";

interface AgentEntry {
	name: string;
	description: string;
	systemPrompt: string;
	skills: string[];
	provider?: string;
	maxRoundtrips?: number;
}

interface ConfigPageProps {
	config: PawConfig;
	saved?: boolean;
	error?: string;
	icpSampleCities?: string[];
	icpExcludeBrands?: string[];
	agents?: AgentEntry[];
	secrets?: SecretStatus[];
}

export interface SecretStatus {
	/** Short identifier used in the rotation endpoint path. */
	id: string;
	label: string;
	set: boolean;
	/** Whether the current value comes from env (cannot be rotated via UI). */
	fromEnv?: boolean;
}

export const ConfigPage: FC<ConfigPageProps> = ({
	config,
	saved,
	error,
	icpSampleCities,
	icpExcludeBrands,
	agents,
	secrets,
}) => {
	return (
		<Layout title="Configuration" currentPath="/config">
			{saved && (
				<div class="alert alert-success">
					Configuration saved successfully. Some changes may require a restart.
				</div>
			)}
			{error && <div class="alert alert-error">{error}</div>}

			<form method="post" action="/config">
				<div class="card mb-md">
					<h3>Agent Personality</h3>
					<table>
						<tbody>
							<tr>
								<td>Agent Name</td>
								<td>
									<input
										type="text"
										name="agent.name"
										value={config.agent.name}
										placeholder="Paw"
										class="input-md"
									/>
								</td>
							</tr>
							<tr>
								<td style="vertical-align: top; padding-top: 12px">
									System Prompt
								</td>
								<td>
									<textarea
										name="agent.systemPrompt"
										rows={8}
										class="w-full"
										style="resize: vertical; font-family: var(--font-mono); font-size: 13px"
										placeholder="You are Paw, a personal AI assistant. You are helpful, concise, and direct.&#10;&#10;You have access to tools that let you interact with the user's Slack workspace, browse the web, manage files, and remember information across conversations."
									>
										{config.agent.systemPrompt}
									</textarea>
									<span class="text-muted text-xs">
										Custom personality and instructions for the AI agent. Leave
										empty to use the default. Operational guidelines (tool
										usage, memory) are always appended automatically.
									</span>
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<div class="card">
					<h3>AI Provider</h3>
					<table>
						<tbody>
							<tr>
								<td>Provider</td>
								<td>
									<strong>{config.provider}</strong>{" "}
									<span class="text-muted text-sm">(set via CLI)</span>
								</td>
							</tr>
							<tr>
								<td>Model</td>
								<td>
									<input
										type="text"
										name="ai.model"
										value={
											config.provider === "claude"
												? config.ai.model
												: config.ollama.model
										}
										class="input-lg"
									/>
								</td>
							</tr>
							<tr>
								<td>Max Tokens</td>
								<td>
									<input
										type="number"
										name="ai.maxTokens"
										value={String(config.ai.maxTokens)}
										min="1"
										class="input-sm"
									/>
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<div class="grid">
					<div class="card">
						<h3>Memory</h3>
						<table>
							<tbody>
								<tr>
									<td>Enabled</td>
									<td>
										<select name="memory.enabled">
											<option value="true" selected={config.memory.enabled}>
												Yes
											</option>
											<option value="false" selected={!config.memory.enabled}>
												No
											</option>
										</select>
									</td>
								</tr>
								<tr>
									<td>Auto Extract</td>
									<td>
										<select name="memory.autoExtract">
											<option value="true" selected={config.memory.autoExtract}>
												Yes
											</option>
											<option
												value="false"
												selected={!config.memory.autoExtract}
											>
												No
											</option>
										</select>
									</td>
								</tr>
								<tr>
									<td>Vector Weight</td>
									<td>
										<input
											type="number"
											name="memory.vectorWeight"
											value={String(config.memory.vectorWeight)}
											step="0.1"
											min="0"
											max="1"
											class="input-sm"
										/>
									</td>
								</tr>
								<tr>
									<td>FTS Weight</td>
									<td>
										<input
											type="number"
											name="memory.ftsWeight"
											value={String(config.memory.ftsWeight)}
											step="0.1"
											min="0"
											max="1"
											class="input-sm"
										/>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div class="card">
						<h3>Security</h3>
						<table>
							<tbody>
								<tr>
									<td>Enforce Permissions</td>
									<td>
										<select name="security.enforcePermissions">
											<option
												value="true"
												selected={config.security.enforcePermissions}
											>
												Yes
											</option>
											<option
												value="false"
												selected={!config.security.enforcePermissions}
											>
												No
											</option>
										</select>
									</td>
								</tr>
								<tr>
									<td>Require Approval</td>
									<td>
										<select name="security.requireApproval">
											<option
												value="true"
												selected={config.security.requireApproval}
											>
												Yes
											</option>
											<option
												value="false"
												selected={!config.security.requireApproval}
											>
												No
											</option>
										</select>
									</td>
								</tr>
								<tr>
									<td>Rate Limiting</td>
									<td>
										<select name="security.rateLimiting.enabled">
											<option
												value="true"
												selected={config.security.rateLimiting.enabled}
											>
												Yes
											</option>
											<option
												value="false"
												selected={!config.security.rateLimiting.enabled}
											>
												No
											</option>
										</select>
									</td>
								</tr>
								<tr>
									<td>Max Req/min</td>
									<td>
										<input
											type="number"
											name="security.rateLimiting.maxRequestsPerMinute"
											value={String(
												config.security.rateLimiting.maxRequestsPerMinute,
											)}
											min="1"
											class="input-sm"
										/>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div class="card">
						<h3>Heartbeat</h3>
						<table>
							<tbody>
								<tr>
									<td>Enabled</td>
									<td>
										<select name="heartbeat.enabled">
											<option value="true" selected={config.heartbeat.enabled}>
												Yes
											</option>
											<option
												value="false"
												selected={!config.heartbeat.enabled}
											>
												No
											</option>
										</select>
									</td>
								</tr>
								<tr>
									<td>Interval (min)</td>
									<td>
										<input
											type="number"
											name="heartbeat.intervalMinutes"
											value={String(config.heartbeat.intervalMinutes)}
											min="1"
											class="input-sm"
										/>
									</td>
								</tr>
								<tr>
									<td>AI on Failure</td>
									<td>
										<select name="heartbeat.triggerAiOnFailure">
											<option
												value="true"
												selected={config.heartbeat.triggerAiOnFailure}
											>
												Yes
											</option>
											<option
												value="false"
												selected={!config.heartbeat.triggerAiOnFailure}
											>
												No
											</option>
										</select>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div class="card">
						<h3>Web UI</h3>
						<table>
							<tbody>
								<tr>
									<td>Host</td>
									<td>
										<input
											type="text"
											value={config.web.host}
											disabled
											class="input-md"
										/>{" "}
										<span class="text-muted text-xs">(restart required)</span>
									</td>
								</tr>
								<tr>
									<td>Port</td>
									<td>
										<input
											type="number"
											value={String(config.web.port)}
											disabled
											class="input-sm"
										/>{" "}
										<span class="text-muted text-xs">(restart required)</span>
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>

				<div class="grid">
					<div class="card">
						<h3>Cron</h3>
						<table>
							<tbody>
								<tr>
									<td>Enabled</td>
									<td>
										<select name="cron.enabled">
											<option value="true" selected={config.cron.enabled}>
												Yes
											</option>
											<option value="false" selected={!config.cron.enabled}>
												No
											</option>
										</select>
									</td>
								</tr>
								<tr>
									<td>Tick Interval (ms)</td>
									<td>
										<input
											type="number"
											name="cron.tickIntervalMs"
											value={String(config.cron.tickIntervalMs)}
											min="1000"
											class="input-md"
										/>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div class="card">
						<h3>Log</h3>
						<table>
							<tbody>
								<tr>
									<td>Level</td>
									<td>
										<select name="log.level">
											<option
												value="debug"
												selected={config.log.level === "debug"}
											>
												debug
											</option>
											<option
												value="info"
												selected={config.log.level === "info"}
											>
												info
											</option>
											<option
												value="warn"
												selected={config.log.level === "warn"}
											>
												warn
											</option>
											<option
												value="error"
												selected={config.log.level === "error"}
											>
												error
											</option>
										</select>
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>

				<div class="card mt-md">
					<h3>Agents</h3>
					<p class="text-muted text-sm" style="margin-bottom: 12px">
						Agent presets that appear as suggestions when the main AI uses
						spawn_agent. The AI can also spawn agents dynamically without
						presets. Changes require a restart.
					</p>
					<div id="agents-list">
						{(agents ?? []).map((agent, idx) => (
							<div
								key={agent.name || String(idx)}
								class="agent-entry"
								data-idx={String(idx)}
								style="border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; position: relative;"
							>
								<button
									type="button"
									class="btn-remove-agent"
									style="position: absolute; top: 8px; right: 8px; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px; padding: 4px 8px;"
									title="Remove agent"
								>
									&times;
								</button>
								<table style="width: 100%">
									<tbody>
										<tr>
											<td style="width: 120px">Name</td>
											<td>
												<input
													type="text"
													name={`agents[${idx}].name`}
													value={agent.name}
													class="input-md"
													placeholder="my-agent"
													required
												/>
											</td>
										</tr>
										<tr>
											<td>Description</td>
											<td>
												<input
													type="text"
													name={`agents[${idx}].description`}
													value={agent.description}
													class="w-full"
													placeholder="What this agent does"
													required
												/>
											</td>
										</tr>
										<tr>
											<td style="vertical-align: top; padding-top: 12px">
												System Prompt
											</td>
											<td>
												<textarea
													name={`agents[${idx}].systemPrompt`}
													rows={4}
													class="w-full"
													style="resize: vertical; font-family: var(--font-mono); font-size: 13px"
													placeholder="You are a specialized agent..."
													required
												>
													{agent.systemPrompt}
												</textarea>
											</td>
										</tr>
										<tr>
											<td>Skills</td>
											<td>
												<input
													type="text"
													name={`agents[${idx}].skills`}
													value={agent.skills.join(", ")}
													class="w-full"
													placeholder="icp-discovery, memory, files"
												/>
												<span class="text-muted text-xs">
													Comma-separated skill names to auto-activate for this
													agent.
												</span>
											</td>
										</tr>
										<tr>
											<td>Provider</td>
											<td>
												<select name={`agents[${idx}].provider`}>
													<option value="" selected={!agent.provider}>
														Default (inherit)
													</option>
													<option
														value="claude"
														selected={agent.provider === "claude"}
													>
														Claude
													</option>
													<option
														value="ollama"
														selected={agent.provider === "ollama"}
													>
														Ollama
													</option>
													<option
														value="openai"
														selected={agent.provider === "openai"}
													>
														OpenAI
													</option>
													<option
														value="gemini"
														selected={agent.provider === "gemini"}
													>
														Gemini
													</option>
												</select>
											</td>
										</tr>
										<tr>
											<td>Max Roundtrips</td>
											<td>
												<input
													type="number"
													name={`agents[${idx}].maxRoundtrips`}
													value={
														agent.maxRoundtrips
															? String(agent.maxRoundtrips)
															: ""
													}
													min="1"
													max="50"
													class="input-sm"
													placeholder="Default"
												/>
											</td>
										</tr>
									</tbody>
								</table>
							</div>
						))}
					</div>
					<button
						type="button"
						id="add-agent-btn"
						class="btn-secondary"
						style="margin-top: 4px"
					>
						+ Add Agent
					</button>
					{raw(`<script>
(function() {
	var list = document.getElementById('agents-list');
	var addBtn = document.getElementById('add-agent-btn');
	function getNextIdx() {
		var entries = list.querySelectorAll('.agent-entry');
		var max = -1;
		entries.forEach(function(e) { var i = parseInt(e.dataset.idx, 10); if (i > max) max = i; });
		return max + 1;
	}
	addBtn.addEventListener('click', function() {
		var idx = getNextIdx();
		var div = document.createElement('div');
		div.className = 'agent-entry';
		div.dataset.idx = idx;
		div.style.cssText = 'border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; position: relative;';
		div.innerHTML = '<button type="button" class="btn-remove-agent" style="position: absolute; top: 8px; right: 8px; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px; padding: 4px 8px;" title="Remove agent">&times;</button>'
			+ '<table style="width:100%"><tbody>'
			+ '<tr><td style="width:120px">Name</td><td><input type="text" name="agents[' + idx + '].name" class="input-md" placeholder="my-agent" required></td></tr>'
			+ '<tr><td>Description</td><td><input type="text" name="agents[' + idx + '].description" class="w-full" placeholder="What this agent does" required></td></tr>'
			+ '<tr><td style="vertical-align:top;padding-top:12px">System Prompt</td><td><textarea name="agents[' + idx + '].systemPrompt" rows="4" class="w-full" style="resize:vertical;font-family:var(--font-mono);font-size:13px" placeholder="You are a specialized agent..." required></textarea></td></tr>'
			+ '<tr><td>Skills</td><td><input type="text" name="agents[' + idx + '].skills" class="w-full" placeholder="icp-discovery, memory, files"><span class="text-muted text-xs">Comma-separated skill names.</span></td></tr>'
			+ '<tr><td>Provider</td><td><select name="agents[' + idx + '].provider"><option value="">Default (inherit)</option><option value="claude">Claude</option><option value="ollama">Ollama</option><option value="openai">OpenAI</option><option value="gemini">Gemini</option></select></td></tr>'
			+ '<tr><td>Max Roundtrips</td><td><input type="number" name="agents[' + idx + '].maxRoundtrips" min="1" max="50" class="input-sm" placeholder="Default"></td></tr>'
			+ '</tbody></table>';
		list.appendChild(div);
	});
	list.addEventListener('click', function(e) {
		if (e.target.classList.contains('btn-remove-agent')) {
			e.target.closest('.agent-entry').remove();
		}
	});
})();
					</script>`)}
				</div>

				<div class="card mt-md">
					<h3>ICP Discovery</h3>
					<table>
						<tbody>
							<tr>
								<td style="vertical-align: top; padding-top: 12px">
									Sample Cities
								</td>
								<td>
									<input
										type="text"
										name="icp-discovery.sampleCities"
										value={(
											icpSampleCities ?? [
												"New York",
												"Los Angeles",
												"Chicago",
												"Dallas",
												"Houston",
											]
										).join(", ")}
										class="w-full"
										placeholder="New York, Los Angeles, Chicago, Dallas, Houston"
									/>
									<span class="text-muted text-xs">
										Comma-separated list of US cities used for Google Maps
										sampling when estimating franchise location counts.
									</span>
								</td>
							</tr>
							<tr>
								<td style="vertical-align: top; padding-top: 12px">
									Exclude Brands
								</td>
								<td>
									<input
										type="text"
										name="icp-discovery.excludeBrands"
										value={(icpExcludeBrands ?? []).join(", ")}
										class="w-full"
										placeholder="McDonald's, Subway, Starbucks, Chick-fil-A"
									/>
									<span class="text-muted text-xs">
										Comma-separated list of brand names to skip during franchise
										discovery. Use this to exclude well-known mega-brands and
										surface lesser-known companies.
									</span>
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<div class="mt-md">
					<button type="submit" class="btn-primary">
						Save Configuration
					</button>
				</div>
			</form>

			{secrets && secrets.length > 0 && (
				<div class="card mb-md mt-md">
					<h3>Secrets</h3>
					<p class="text-sm text-muted mb-md">
						API keys and tokens are never displayed here. Use <strong>Rotate</strong>{" "}
						to replace the stored value; changes require a restart to take effect
						in the running provider.
					</p>
					<table class="audit-table">
						<thead>
							<tr>
								<th>Service</th>
								<th>Status</th>
								<th>Source</th>
								<th style="text-align: right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{secrets.map((s) => (
								<tr>
									<td>{s.label}</td>
									<td>
										<span class={`badge ${s.set ? "success" : "neutral"}`}>
											{s.set ? "Set" : "Missing"}
										</span>
									</td>
									<td class="text-sm text-muted">
										{s.fromEnv ? "env var" : "credentials file"}
									</td>
									<td style="text-align: right">
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
				</div>
			)}

			{raw(`<script>
async function rotateSecret(id, label) {
  var value = await pawModal.prompt("Rotate " + label, "Paste the new secret value. It will be written to ~/.paw/credentials.json and never displayed again.", "");
  if (!value) return;
  try {
    var res = await fetch("/api/credentials/" + encodeURIComponent(id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: value })
    });
    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      pawModal.alert("Rotate failed", err.error || ("HTTP " + res.status));
      return;
    }
    pawModal.alert("Rotated", label + " was updated. Restart the process for the running provider to pick up the new value.");
    setTimeout(function() { window.location.reload(); }, 400);
  } catch (e) {
    pawModal.alert("Rotate failed", String(e));
  }
}
</script>`)}
		</Layout>
	);
};
