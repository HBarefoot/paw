import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { CRON_ALLOWED_EVENTS } from "../../cron/scheduler.js";
import { icon } from "./icons.js";
import { Layout } from "./layout.js";

interface CronTool {
	name: string;
	plugin: string;
	description: string;
}

interface CronJob {
	id: string;
	name: string;
	expression: string;
	timezone: string;
	action: {
		type: string;
		prompt?: string;
		tool?: string;
		event?: string;
		payload?: unknown;
	};
	enabled: boolean;
	lastRun: string | null;
	nextRun: string;
	createdAt: string;
}

interface CronPageProps {
	jobs: CronJob[];
	tools?: CronTool[];
	error?: string;
	success?: string;
}

// Short, human subtext for a job's action (the design shows a description line).
function actionSummary(action: CronJob["action"]): string {
	if (action.type === "tool" && action.tool) return `Tool · ${action.tool}`;
	if (action.type === "event" && action.event) return `Event · ${action.event}`;
	if (action.type === "prompt" && typeof action.prompt === "string") {
		const p = action.prompt.trim();
		return p
			? `Prompt · ${p.slice(0, 60)}${p.length > 60 ? "…" : ""}`
			: "Prompt";
	}
	return action.type;
}

// Nearest upcoming run across enabled jobs (best-effort parse; "—" if none).
function nextFire(jobs: CronJob[]): string {
	const upcoming = jobs
		.filter((j) => j.enabled && j.nextRun)
		.map((j) => ({ raw: j.nextRun, t: Date.parse(j.nextRun) }))
		.filter((x) => !Number.isNaN(x.t))
		.sort((a, b) => a.t - b.t);
	return upcoming[0]?.raw ?? "—";
}

export function cronScript(): string {
	return `
    async function toggleJob(id, enable) {
      var action = enable ? 'enable' : 'disable';
      var res = await fetch('/api/cron/jobs/' + id + '/' + action, { method: 'POST' });
      if (res.ok) window.location.reload();
      else pawModal.alert("Error", "Failed to " + action + " job.");
    }

    async function deleteJob(id, name) {
      var ok = await pawModal.confirm("Delete Job", "Delete the cron job " + (name || "") + "? This cannot be undone.", { confirmLabel: "Delete", danger: true });
      if (!ok) return;
      var res = await fetch('/api/cron/jobs/' + id, { method: 'DELETE' });
      if (res.ok) window.location.reload();
      else pawModal.alert("Error", "Failed to delete job.");
    }

    // Show only the payload field matching the selected action type, and disable
    // the inactive fields so the browser omits them from the post. Plain DOM only:
    // no regex / no backslash escapes (inline-script-template-trap guard).
    function pawCronSync() {
      var sel = document.getElementById('cron-action-type');
      if (!sel) return;
      var value = sel.value;
      var groups = document.querySelectorAll('[data-cron-field]');
      for (var i = 0; i < groups.length; i++) {
        var group = groups[i];
        var on = group.getAttribute('data-cron-field') === value;
        group.style.display = on ? '' : 'none';
        var fields = group.querySelectorAll('input, select, textarea');
        for (var j = 0; j < fields.length; j++) fields[j].disabled = !on;
      }
    }
    pawCronSync();
  `;
}

export const CronPage: FC<CronPageProps> = ({
	jobs,
	tools = [],
	error,
	success,
}) => {
	const events = [...CRON_ALLOWED_EVENTS];
	const enabled = jobs.filter((j) => j.enabled).length;
	return (
		<Layout title="Cron" currentPath="/cron">
			<div class="page-grid">
				{error && <div class="alert alert-error">{error}</div>}
				{success && <div class="alert alert-success">{success}</div>}

				<div class="kpi-strip cols-4">
					<div class="kpi">
						<div class="k">{raw(icon("cron", 13))} Total Jobs</div>
						<div class="v">{jobs.length}</div>
						<div class="foot" />
					</div>
					<div class="kpi">
						<div class="k">{raw(icon("check", 13))} Enabled</div>
						<div class="v ok">{enabled}</div>
						<div class="foot" />
					</div>
					<div class="kpi">
						<div class="k">{raw(icon("pause", 13))} Disabled</div>
						<div class="v">{jobs.length - enabled}</div>
						<div class="foot" />
					</div>
					<div class="kpi">
						<div class="k">{raw(icon("zap", 13))} Next Fire</div>
						<div class="v" style="font-size:16px">
							{nextFire(jobs)}
						</div>
						<div class="foot" />
					</div>
				</div>

				<div class="panel">
					<div class="panel-hd">
						<div class="ttl">
							<span class="ico">{raw(icon("calendar", 16))}</span>
							Scheduled Jobs
						</div>
						<span class="meta">{jobs.length} total</span>
					</div>
					<div class="panel-bd tight">
						{jobs.length > 0 ? (
							<table class="tbl">
								<thead>
									<tr>
										<th style="width:16px" />
										<th>Job</th>
										<th>Schedule</th>
										<th>Next run</th>
										<th>Last run</th>
										<th style="width:60px">On</th>
										<th style="text-align:right" />
									</tr>
								</thead>
								<tbody>
									{jobs.map((job) => (
										<tr key={job.id}>
											<td>
												<span class={`led ${job.enabled ? "live" : "idle"}`} />
											</td>
											<td>
												<div class="nm">{job.name}</div>
												<div class="dim" style="font-size:11px;margin-top:3px">
													{actionSummary(job.action)}
												</div>
											</td>
											<td>
												<span class="tag mono">{job.expression}</span>
												<span
													class="dim"
													style="margin-left:8px;font-size:10.5px"
												>
													{job.action.type}
												</span>
											</td>
											<td
												class="tnum"
												style={
													job.enabled
														? "color:var(--ink)"
														: "color:var(--ink-faint)"
												}
											>
												{job.enabled ? job.nextRun : "—"}
											</td>
											<td class="dim tnum">{job.lastRun ?? "never"}</td>
											<td>
												<button
													type="button"
													class={`toggle${job.enabled ? " on" : ""}`}
													title={job.enabled ? "Disable" : "Enable"}
													data-id={job.id}
													data-enable={job.enabled ? "0" : "1"}
													onclick="toggleJob(this.dataset.id, this.dataset.enable === '1')"
												/>
											</td>
											<td>
												<div class="actions">
													<button
														type="button"
														class="icobtn danger"
														title="Delete"
														data-id={job.id}
														data-name={job.name}
														onclick="deleteJob(this.dataset.id, this.dataset.name)"
													>
														{raw(icon("trash", 15))}
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						) : (
							<div class="empty-state">
								{raw(icon("calendar", 30))}
								<div class="t">No cron jobs yet</div>
								<div class="s">Schedule one below.</div>
							</div>
						)}
					</div>
				</div>

				<div class="panel">
					<div class="panel-hd">
						<div class="ttl">
							<span class="ico">{raw(icon("plus", 16))}</span>
							Create Job
						</div>
					</div>
					<div class="panel-bd">
						<form
							method="POST"
							action="/api/cron/jobs"
							class="flex-col gap-md max-w-form"
						>
							<div class="field">
								<label>Name</label>
								<input
									type="text"
									name="name"
									required
									placeholder="e.g. daily-backup"
									class="w-full"
								/>
							</div>
							<div class="field">
								<label>Cron Expression</label>
								<input
									type="text"
									name="expression"
									required
									placeholder="e.g. 0 9 * * *"
									class="w-full mono"
								/>
							</div>
							<div class="field">
								<label>Action Type</label>
								<select
									id="cron-action-type"
									name="actionType"
									class="w-full"
									onchange="pawCronSync()"
								>
									<option value="prompt">Prompt (send to AI)</option>
									<option value="tool">Tool (execute tool)</option>
									<option value="event">Event (emit event)</option>
								</select>
							</div>

							<div class="field" data-cron-field="prompt">
								<label for="cron-prompt">Prompt</label>
								<textarea
									id="cron-prompt"
									name="payload"
									rows={3}
									placeholder="What should the AI do when this fires?"
									class="w-full"
									style="resize: vertical"
								/>
							</div>

							<div class="field" data-cron-field="tool" style="display: none">
								<label for="cron-tool">Tool</label>
								<select id="cron-tool" name="payload" class="w-full">
									{tools.length > 0 ? (
										tools.map((t) => (
											<option key={t.name} value={t.name} title={t.description}>
												{t.name} — {t.plugin}
											</option>
										))
									) : (
										<option value="" disabled>
											No tools registered
										</option>
									)}
								</select>
								<label for="cron-tool-args" class="mt-sm">
									Arguments (optional JSON)
								</label>
								<textarea
									id="cron-tool-args"
									name="toolArgs"
									rows={2}
									placeholder="{}"
									class="w-full"
									style="resize: vertical"
								/>
							</div>

							<div class="field" data-cron-field="event" style="display: none">
								<label for="cron-event">Event</label>
								<select id="cron-event" name="payload" class="w-full">
									{events.map((e) => (
										<option key={e} value={e}>
											{e}
										</option>
									))}
								</select>
							</div>

							<button type="submit" class="btn-primary self-start">
								{raw(icon("check", 14))} Create Job
							</button>
						</form>
					</div>
				</div>
			</div>

			{raw(`<script>${cronScript()}</script>`)}
		</Layout>
	);
};
