import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";
import type { PawConfig } from "../../types/config.js";

interface ConfigPageProps {
	config: PawConfig;
	saved?: boolean;
	error?: string;
	icpSampleCities?: string[];
	icpExcludeBrands?: string[];
}

export const ConfigPage: FC<ConfigPageProps> = ({ config, saved, error, icpSampleCities, icpExcludeBrands }) => {
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
										value={(icpSampleCities ?? ["New York", "Los Angeles", "Chicago", "Dallas", "Houston"]).join(", ")}
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
		</Layout>
	);
};
