import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

interface DashboardProps {
  health: Record<string, { ok: boolean; details?: string }>;
  memoryStats: { totalMemories: number; byCategory: Record<string, number> } | null;
  cronJobs: Array<{ id: string; name: string; expression: string; enabled: boolean; lastRun: string | null; nextRun: string }>;
  provider: string;
  plugins: string[];
  uptime: number;
}

export const DashboardPage: FC<DashboardProps> = ({ health, memoryStats, cronJobs, provider, plugins, uptime }) => {
  const uptimeStr = formatUptime(uptime);

  return (
    <Layout title="Dashboard" currentPath="/">
      <div class="grid">
        <div class="card">
          <h3>System</h3>
          <div class="stat-value">{uptimeStr}</div>
          <div class="stat-label">Uptime</div>
          <p class="mt-sm text-secondary">Provider: <strong>{provider}</strong></p>
          <p class="text-secondary">Plugins: <strong>{plugins.join(", ") || "none"}</strong></p>
        </div>

        <div class="card">
          <h3>Memory</h3>
          {memoryStats ? (
            <div>
              <div class="stat-value">{memoryStats.totalMemories}</div>
              <div class="stat-label">Memories stored</div>
              {Object.entries(memoryStats.byCategory).map(([cat, count]) => (
                <p class="mt-sm text-secondary">{cat}: {count}</p>
              ))}
            </div>
          ) : (
            <div class="empty-state"><p>Memory system disabled</p></div>
          )}
        </div>

        <div class="card">
          <h3>Health</h3>
          {Object.entries(health).map(([name, result]) => (
            <div class="flex justify-between items-center" style="padding: 6px 0">
              <span>{name}</span>
              <span class={`badge ${result.ok ? "success" : "error"}`}>
                {result.ok ? "OK" : "FAIL"}
              </span>
            </div>
          ))}
          {Object.keys(health).length === 0 && (
            <div class="empty-state"><p>No plugins running</p></div>
          )}
        </div>
      </div>

      <div class="card mt-md">
        <h3>Cron Jobs ({cronJobs.length})</h3>
        {cronJobs.length > 0 ? (
          <table>
            <thead>
              <tr><th>Name</th><th>Expression</th><th>Status</th><th>Last Run</th><th>Next Run</th></tr>
            </thead>
            <tbody>
              {cronJobs.map((job) => (
                <tr>
                  <td>{job.name}</td>
                  <td><code>{job.expression}</code></td>
                  <td><span class={`badge ${job.enabled ? "success" : "neutral"}`}>{job.enabled ? "active" : "disabled"}</span></td>
                  <td>{job.lastRun ? new Date(job.lastRun).toLocaleString() : "never"}</td>
                  <td>{new Date(job.nextRun).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div class="empty-state"><p>No cron jobs configured. Use <code>paw cron add</code> to create one.</p></div>
        )}
      </div>
    </Layout>
  );
};

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
