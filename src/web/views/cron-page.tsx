import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";

interface CronJob {
  id: string;
  name: string;
  expression: string;
  timezone: string;
  action: { type: string; prompt?: string; tool?: string; event?: string; payload?: unknown };
  enabled: boolean;
  lastRun: string | null;
  nextRun: string;
  createdAt: string;
}

interface CronPageProps {
  jobs: CronJob[];
  error?: string;
  success?: string;
}

function cronScript(): string {
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
  `;
}

export const CronPage: FC<CronPageProps> = ({ jobs, error, success }) => {
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
                  <td><code>{job.expression}</code></td>
                  <td><span class="badge neutral">{job.action.type}</span></td>
                  <td>
                    <span class={`badge ${job.enabled ? "success" : "neutral"}`}>
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
          <div class="empty-state"><p>No cron jobs configured.</p></div>
        )}
      </div>

      <div class="card">
        <h3>Create Job</h3>
        <form method="POST" action="/api/cron/jobs" class="flex-col gap-md max-w-form">
          <div>
            <label>Name</label>
            <input type="text" name="name" required placeholder="e.g. daily-backup" class="w-full" />
          </div>
          <div>
            <label>Cron Expression</label>
            <input type="text" name="expression" required placeholder="e.g. 0 9 * * *" class="w-full" />
          </div>
          <div>
            <label>Action Type</label>
            <select name="actionType" class="w-full">
              <option value="prompt">Prompt (send to AI)</option>
              <option value="tool">Tool (execute tool)</option>
              <option value="event">Event (emit event)</option>
            </select>
          </div>
          <div>
            <label>Action Payload</label>
            <textarea name="payload" rows={3} required placeholder="For prompt: the prompt text. For tool: tool name. For event: event name." class="w-full" style="resize: vertical" />
          </div>
          <button type="submit" class="btn-primary self-start">Create Job</button>
        </form>
      </div>

      {raw(`<script>${cronScript()}</script>`)}
    </Layout>
  );
};
