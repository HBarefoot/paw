import type { FC } from "hono/jsx";
import { raw } from "hono/html";
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
}

function heartbeatScript(): string {
	return `
    async function triggerCheck() {
      var btn = document.getElementById("trigger-btn");
      btn.disabled = true;
      btn.textContent = "Running...";
      try {
        var res = await fetch("/api/heartbeat/trigger", { method: "POST" });
        if (res.ok) window.location.reload();
        else pawModal.alert("Error", "Failed to trigger heartbeat check.");
      } catch (err) {
        pawModal.alert("Error", "Request failed: " + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "Run Check Now";
      }
    }

    async function deleteMemory(id) {
      var ok = await pawModal.confirm("Delete Entry", "Remove this heartbeat log entry?", { confirmLabel: "Delete", danger: true });
      if (!ok) return;
      var res = await fetch("/api/memory/" + id, { method: "DELETE" });
      if (res.ok) window.location.reload();
      else pawModal.alert("Error", "Failed to delete entry.");
    }
  `;
}

function formatTimestamp(ts: string): string {
	try {
		const d = new Date(ts);
		return d.toLocaleString("en-US", {
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

export const HeartbeatPage: FC<HeartbeatPageProps> = ({
	lastResult,
	history,
	config,
	error,
	success,
}) => {
	return (
		<Layout title="Heartbeat" currentPath="/heartbeat">
			{error && <div class="alert alert-error">{error}</div>}
			{success && <div class="alert alert-success">{success}</div>}

			<div class="flex gap-md" style="flex-wrap: wrap">
				{/* Status Card */}
				<div class="card" style="flex: 2; min-width: 340px">
					<div
						class="flex justify-between items-center"
						style="margin-bottom: 12px"
					>
						<h3 style="margin: 0">Last Check</h3>
						<button
							id="trigger-btn"
							class="btn-primary btn-sm"
							onclick="triggerCheck()"
						>
							Run Check Now
						</button>
					</div>

					{lastResult ? (
						<div>
							<div class="flex gap-md items-center" style="margin-bottom: 16px">
								<span
									class={`badge ${lastResult.overallOk ? "success" : "error"}`}
									style="font-size: 13px; padding: 4px 12px"
								>
									{lastResult.overallOk ? "All Passing" : "Failures Detected"}
								</span>
								<span class="text-secondary" style="font-size: 13px">
									{formatTimestamp(lastResult.timestamp)}
								</span>
								{lastResult.aiTriggered && (
									<span class="badge neutral" style="font-size: 11px">
										AI Triggered
									</span>
								)}
							</div>

							<table>
								<thead>
									<tr>
										<th>Check</th>
										<th>Status</th>
										<th>Details</th>
									</tr>
								</thead>
								<tbody>
									{lastResult.checks.map((check) => (
										<tr>
											<td>
												<code>{check.name}</code>
											</td>
											<td>
												<span class={`badge ${check.ok ? "success" : "error"}`}>
													{check.ok ? "OK" : "FAIL"}
												</span>
											</td>
											<td class="text-secondary">{check.details ?? "—"}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<div class="empty-state">
							<p>No heartbeat checks have run yet.</p>
							<p
								class="text-secondary"
								style="font-size: 13px; margin-top: 4px"
							>
								Click "Run Check Now" to trigger one manually.
							</p>
						</div>
					)}
				</div>

				{/* Config Card */}
				<div class="card" style="flex: 1; min-width: 260px">
					<h3>Configuration</h3>
					<form
						method="POST"
						action="/api/heartbeat/config"
						class="flex-col gap-md"
					>
						<div>
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
						<div>
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
						<div>
							<label>AI Investigation on Failure</label>
							<select name="triggerAiOnFailure" class="w-full">
								<option value="true" selected={config.triggerAiOnFailure}>
									Yes
								</option>
								<option value="false" selected={!config.triggerAiOnFailure}>
									No
								</option>
							</select>
						</div>
						<button type="submit" class="btn-primary self-start">
							Save
						</button>
					</form>
				</div>
			</div>

			{/* History Card */}
			<div class="card" style="margin-top: 16px">
				<h3>History ({history.length})</h3>
				{history.length > 0 ? (
					<table>
						<thead>
							<tr>
								<th>Timestamp</th>
								<th>Result</th>
								<th>Summary</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{history.map((mem) => {
								const passed = mem.text.includes("passed");
								return (
									<tr>
										<td style="white-space: nowrap">
											{formatTimestamp(mem.created_at)}
										</td>
										<td>
											<span class={`badge ${passed ? "success" : "error"}`}>
												{passed ? "PASS" : "FAIL"}
											</span>
										</td>
										<td class="text-secondary" style="font-size: 13px">
											{mem.text}
										</td>
										<td>
											<button
												class="btn-ghost btn-sm"
												onclick={`deleteMemory('${mem.id}')`}
											>
												Delete
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				) : (
					<div class="empty-state">
						<p>No heartbeat history yet.</p>
					</div>
				)}
			</div>

			{raw(`<script>${heartbeatScript()}</script>`)}
		</Layout>
	);
};
