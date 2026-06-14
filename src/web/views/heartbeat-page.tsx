import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { MetricsSnapshot } from "../metrics.js";
import { formatUptime } from "../metrics.js";
import { icon } from "./icons.js";
import { Layout } from "./layout.js";

interface HeartbeatCheck {
	name: string;
	ok: boolean;
	details?: string;
}

interface HeartbeatResult {
	timestamp: string;
	checks: HeartbeatCheck[];
	overallOk: boolean;
	aiTriggered: boolean;
}

interface HeartbeatMemory {
	id: string;
	text: string;
	created_at: string;
}

interface HeartbeatPageProps {
	lastResult: HeartbeatResult | null;
	history: HeartbeatMemory[];
	config: {
		enabled: boolean;
		intervalMinutes: number;
		triggerAiOnFailure: boolean;
	};
	error?: string;
	success?: string;
	metrics: MetricsSnapshot;
}

function heartbeatScript(): string {
	return `
    async function triggerCheck() {
      var btn = document.getElementById("trigger-btn");
      btn.disabled = true;
      var orig = btn.textContent;
      btn.textContent = "Running…";
      try {
        var res = await fetch("/api/heartbeat/trigger", { method: "POST" });
        if (res.ok) window.location.reload();
        else pawModal.alert("Error", "Failed to trigger heartbeat check.");
      } catch (err) {
        pawModal.alert("Error", "Request failed: " + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    }

    async function deleteMemory(id) {
      var ok = await pawModal.confirm("Delete Entry", "Remove this heartbeat log entry?", { confirmLabel: "Delete", danger: true });
      if (!ok) return;
      var res = await fetch("/api/memory/" + id, { method: "DELETE" });
      if (res.ok) window.location.reload();
      else pawModal.alert("Error", "Failed to delete entry.");
    }

    function hbSet(id, value) { var el = document.getElementById(id); if (el) el.textContent = value; }
    function hbTone(id, warn) { var el = document.getElementById(id); if (el) { el.classList.remove("warn"); if (warn) el.classList.add("warn"); } }

    async function hbPoll() {
      try {
        var r = await fetch("/api/heartbeat/metrics");
        var m = await r.json();
        hbSet("kpi-cpu", String(m.cpu)); hbTone("kpi-cpu", m.cpu > 80);
        hbSet("kpi-mem", (m.memRssMb / 1024).toFixed(1));
        hbSet("kpi-lag", String(m.eventLoopLagMs)); hbTone("kpi-lag", m.eventLoopLagMs > 50);
        hbSet("kpi-db", String(m.dbLatencyMs));
        hbSet("sys-req", m.reqPerSec.toFixed(1));
        hbSet("sys-mem", (m.memRssMb / 1024).toFixed(2) + " GB");
      } catch (e) {}
    }
    hbPoll();
    setInterval(hbPoll, 4000);
  `;
}

// Exposed for the cook+run template-trap test.
export function getHeartbeatScript(): string {
	return heartbeatScript();
}

function formatTimestamp(ts: string): string {
	try {
		return new Date(ts).toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return ts;
	}
}

function ledFor(ok: boolean): string {
	return ok ? "live" : "err";
}

export const HeartbeatPage: FC<HeartbeatPageProps> = ({
	lastResult,
	history,
	config,
	error,
	success,
	metrics,
}) => {
	const memGb = (metrics.memRssMb / 1024).toFixed(1);
	const totalGb = (metrics.memTotalMb / 1024).toFixed(0);
	return (
		<Layout title="Heartbeat" currentPath="/heartbeat">
			<div class="page-grid">
				{error && <div class="alert alert-error">{error}</div>}
				{success && <div class="alert alert-success">{success}</div>}

				<div class="kpi-strip cols-4">
					<div class="kpi">
						<div class="k">{raw(icon("cpu", 13))} CPU</div>
						<div class="v">
							<span id="kpi-cpu">{metrics.cpu}</span>
							<small>%</small>
						</div>
						<div class="foot" />
					</div>
					<div class="kpi">
						<div class="k">{raw(icon("memory", 13))} Memory</div>
						<div class="v">
							<span id="kpi-mem">{memGb}</span>
							<small>/ {totalGb} GB</small>
						</div>
						<div class="foot" />
					</div>
					<div class="kpi">
						<div class="k">{raw(icon("zap", 13))} Event-loop Lag</div>
						<div class="v">
							<span id="kpi-lag">{metrics.eventLoopLagMs}</span>
							<small>ms</small>
						</div>
						<div class="foot" />
					</div>
					<div class="kpi">
						<div class="k">{raw(icon("database", 13))} DB Latency</div>
						<div class="v">
							<span id="kpi-db">{metrics.dbLatencyMs}</span>
							<small>ms</small>
						</div>
						<div class="foot" />
					</div>
				</div>

				<div style="display:grid;grid-template-columns:1fr 360px;gap:14px;align-items:start">
					<div class="page-grid">
						<div class="panel">
							<div class="panel-hd">
								<div class="ttl">
									<span class="ico">{raw(icon("server", 16))}</span>
									Service Health
								</div>
								{lastResult && (
									<span class="meta">
										last check {formatTimestamp(lastResult.timestamp)}
									</span>
								)}
							</div>
							<div class="panel-bd tight">
								{lastResult && lastResult.checks.length > 0 ? (
									<table class="tbl">
										<thead>
											<tr>
												<th style="width:16px" />
												<th>Service</th>
												<th>Details</th>
												<th style="text-align:right;width:80px">Status</th>
											</tr>
										</thead>
										<tbody>
											{lastResult.checks.map((check) => (
												<tr key={check.name}>
													<td>
														<span class={`led ${ledFor(check.ok)}`} />
													</td>
													<td>
														<span class="nm">{check.name}</span>
													</td>
													<td class="dim">{check.details ?? "—"}</td>
													<td style="text-align:right">
														<span class={`st ${ledFor(check.ok)}`}>
															{check.ok ? "live" : "fail"}
														</span>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								) : (
									<div class="empty-state">
										{raw(icon("server", 30))}
										<div class="t">No checks have run yet</div>
										<div class="s">Run a check to populate service health.</div>
									</div>
								)}
							</div>
						</div>

						<div class="panel">
							<div class="panel-hd">
								<div class="ttl">
									<span class="ico">{raw(icon("heartbeat", 16))}</span>
									History
								</div>
								<span class="meta">{history.length} entries</span>
							</div>
							<div class="panel-bd tight">
								{history.length > 0 ? (
									<table class="tbl">
										<thead>
											<tr>
												<th style="width:16px" />
												<th>Timestamp</th>
												<th>Summary</th>
												<th style="text-align:right" />
											</tr>
										</thead>
										<tbody>
											{history.map((mem) => {
												const passed = mem.text.includes("passed");
												return (
													<tr key={mem.id}>
														<td>
															<span class={`led ${passed ? "live" : "err"}`} />
														</td>
														<td class="dim tnum" style="white-space:nowrap">
															{formatTimestamp(mem.created_at)}
														</td>
														<td class="dim">{mem.text}</td>
														<td>
															<div class="actions">
																<button
																	type="button"
																	class="icobtn danger"
																	title="Delete"
																	data-id={mem.id}
																	onclick="deleteMemory(this.dataset.id)"
																>
																	{raw(icon("trash", 15))}
																</button>
															</div>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								) : (
									<div class="empty-state">
										{raw(icon("heartbeat", 30))}
										<div class="t">No heartbeat history yet</div>
									</div>
								)}
							</div>
						</div>
					</div>

					<div class="page-grid">
						<div class="panel">
							<div class="panel-hd">
								<div class="ttl">
									<span class="ico">{raw(icon("heartbeat", 16))}</span>
									Heartbeat
								</div>
								<button
									id="trigger-btn"
									type="button"
									class="btn-secondary btn-sm"
									onclick="triggerCheck()"
								>
									Run Check Now
								</button>
							</div>
							<div class="panel-bd">
								<div style="display:flex;align-items:center;gap:12px">
									<span
										class={`led ${lastResult ? ledFor(lastResult.overallOk) : "idle"}`}
										style="width:10px;height:10px"
									/>
									<div>
										<div class="bright">
											{lastResult
												? lastResult.overallOk
													? "All systems nominal"
													: "Failures detected"
												: "No checks run yet"}
										</div>
										<div class="dim" style="font-size:11px;margin-top:3px">
											{lastResult
												? `Last ping ${formatTimestamp(lastResult.timestamp)}`
												: "—"}
											{lastResult?.aiTriggered ? " · AI triggered" : ""}
										</div>
									</div>
								</div>
							</div>
						</div>

						<div class="panel">
							<div class="panel-hd">
								<div class="ttl">
									<span class="ico">{raw(icon("info", 16))}</span>
									System
								</div>
								<span class="meta">live</span>
							</div>
							<div class="panel-bd">
								<div style="display:flex;flex-direction:column;gap:10px;font-size:12px">
									<div style="display:flex;justify-content:space-between">
										<span class="dim">Process uptime</span>
										<span class="bright tnum">
											{formatUptime(metrics.uptimeSec)}
										</span>
									</div>
									<div style="display:flex;justify-content:space-between">
										<span class="dim">Requests</span>
										<span class="bright tnum">
											<span id="sys-req">{metrics.reqPerSec.toFixed(1)}</span>{" "}
											/s
										</span>
									</div>
									<div style="display:flex;justify-content:space-between">
										<span class="dim">Process memory</span>
										<span class="bright tnum" id="sys-mem">
											{(metrics.memRssMb / 1024).toFixed(2)} GB
										</span>
									</div>
									<div style="display:flex;justify-content:space-between">
										<span class="dim">Check interval</span>
										<span class="bright tnum">
											{config.intervalMinutes} min
										</span>
									</div>
								</div>
							</div>
						</div>

						<div class="panel">
							<div class="panel-hd">
								<div class="ttl">
									<span class="ico">{raw(icon("settings", 16))}</span>
									Configuration
								</div>
							</div>
							<div class="panel-bd">
								<form
									method="POST"
									action="/api/heartbeat/config"
									class="flex-col gap-md"
								>
									<div class="field">
										<label>Enabled</label>
										<select name="enabled" class="w-full">
											<option value="true" selected={config.enabled}>
												Yes
											</option>
											<option value="false" selected={!config.enabled}>
												No
											</option>
										</select>
									</div>
									<div class="field">
										<label>Interval (minutes)</label>
										<input
											type="number"
											name="intervalMinutes"
											value={String(config.intervalMinutes)}
											min="1"
											max="1440"
											class="w-full"
										/>
									</div>
									<div class="field">
										<label>AI Investigation on Failure</label>
										<select name="triggerAiOnFailure" class="w-full">
											<option value="true" selected={config.triggerAiOnFailure}>
												Yes
											</option>
											<option
												value="false"
												selected={!config.triggerAiOnFailure}
											>
												No
											</option>
										</select>
									</div>
									<button type="submit" class="btn-primary self-start">
										{raw(icon("check", 14))} Save
									</button>
								</form>
							</div>
						</div>
					</div>
				</div>
			</div>

			{raw(`<script>${heartbeatScript()}</script>`)}
		</Layout>
	);
};
