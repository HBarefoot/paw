import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";
import { CRON_ALLOWED_EVENTS } from "../../cron/scheduler.js";

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

export function cronScript(): string {
	return `
    async function toggleJob(id, enable) {
      var action = enable ? 'enable' : 'disable';
      var res = await fetch('/api/cron/jobs/' + id + '/' + action, { method: 'POST' });
      if (res.ok) window.location.reload();
      else pawModal.alert("Error", "Failed to " + action + " job.");
    }

    async function deleteJob(id) {
      var ok = await pawModal.confirm("Delete Job", "Are you sure you want to delete this cron job?", { confirmLabel: "Delete", danger: true });
      if (!ok) return;
      var res = await fetch('/api/cron/jobs/' + id, { method: 'DELETE' });
      if (res.ok) window.location.reload();
      else pawModal.alert("Error", "Failed to delete job.");
    }

    // Show only the payload field that matches the selected action type, and
    // disable the inactive fields so the browser does not submit them (a
    // disabled control is omitted from the form post — keeps a single
    // effective 'payload' value). Plain DOM only: no regex / no backslash
    // escapes (inline-script-template-trap guard).
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
	return (
		<Layout title="Cron Jobs" currentPath="/cron">
			{error && <div class="alert alert-error">{error}</div>}
			{success && <div class="alert alert-success">{success}</div>}

			<div class="card">
				<h3>Jobs ({jobs.length})</h3>
				{jobs.length > 0 ? (
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Expression</th>
								<th>Type</th>
								<th>Status</th>
								<th>Last Run</th>
								<th>Next Run</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{jobs.map((job) => (
								<tr>
									<td>{job.name}</td>
									<td>
										<code>{job.expression}</code>
									</td>
									<td>
										<span class="badge neutral">{job.action.type}</span>
									</td>
									<td>
										<span
											class={`badge ${job.enabled ? "success" : "neutral"}`}
										>
											{job.enabled ? "active" : "disabled"}
										</span>
									</td>
									<td>{job.lastRun ?? "never"}</td>
									<td>{job.nextRun}</td>
									<td>
										<div class="flex gap-xs">
											<button
												class="btn-ghost btn-sm"
												onclick={`toggleJob('${job.id}', ${!job.enabled})`}
											>
												{job.enabled ? "Disable" : "Enable"}
											</button>
											<button
												class="btn-danger btn-sm"
												onclick={`deleteJob('${job.id}')`}
											>
												Delete
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<div class="empty-state">
						<p>No cron jobs configured.</p>
					</div>
				)}
			</div>

			<div class="card">
				<h3>Create Job</h3>
				<form
					method="POST"
					action="/api/cron/jobs"
					class="flex-col gap-md max-w-form"
				>
					<div>
						<label>Name</label>
						<input
							type="text"
							name="name"
							required
							placeholder="e.g. daily-backup"
							class="w-full"
						/>
					</div>
					<div>
						<label>Cron Expression</label>
						<input
							type="text"
							name="expression"
							required
							placeholder="e.g. 0 9 * * *"
							class="w-full"
						/>
					</div>
					<div>
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

					<div data-cron-field="prompt">
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

					<div data-cron-field="tool" style="display: none">
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

					<div data-cron-field="event" style="display: none">
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
						Create Job
					</button>
				</form>
			</div>

			{raw(`<script>${cronScript()}</script>`)}
		</Layout>
	);
};
