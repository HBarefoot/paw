import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

interface DashboardProps {
	health: Record<string, { ok: boolean; details?: string }>;
	memoryStats: {
		totalMemories: number;
		byCategory: Record<string, number>;
	} | null;
	cronJobs: Array<{
		id: string;
		name: string;
		expression: string;
		enabled: boolean;
		lastRun: string | null;
		nextRun: string;
	}>;
	provider: string;
	plugins: string[];
	uptime: number;
	usage?: {
		totalInputTokens: number;
		totalOutputTokens: number;
		estimatedCostUsd: number;
		byProvider: Record<
			string,
			{ inputTokens: number; outputTokens: number; costUsd: number }
		>;
	} | null;
	feedback?: {
		thumbsUp: number;
		thumbsDown: number;
		corrections: number;
	} | null;
	totals?: {
		sessions: number;
		messages: number;
	} | null;
}

export const DashboardPage: FC<DashboardProps> = ({
	health,
	memoryStats,
	cronJobs,
	provider,
	plugins,
	uptime,
	usage,
	feedback,
	totals,
}) => {
	const uptimeStr = formatUptime(uptime);
	const formatTokens = (n: number): string =>
		n >= 1_000_000
			? `${(n / 1_000_000).toFixed(2)}M`
			: n >= 1_000
				? `${(n / 1_000).toFixed(1)}k`
				: String(n);
	const formatUsd = (n: number): string =>
		n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;

	return (
		<Layout title="Dashboard" currentPath="/">
			<div class="grid">
				<div class="card">
					<h3>System</h3>
					<div class="stat-value">{uptimeStr}</div>
					<div class="stat-label">Uptime</div>
					<p class="mt-sm text-secondary">
						Provider: <strong>{provider}</strong>
					</p>
					<p class="text-secondary">
						Plugins: <strong>{plugins.join(", ") || "none"}</strong>
					</p>
				</div>

				<div class="card">
					<h3>Memory</h3>
					{memoryStats ? (
						<div>
							<div class="stat-value">{memoryStats.totalMemories}</div>
							<div class="stat-label">Memories stored</div>
							{Object.entries(memoryStats.byCategory).map(([cat, count]) => (
								<p class="mt-sm text-secondary">
									{cat}: {count}
								</p>
							))}
						</div>
					) : (
						<div class="empty-state">
							<p>Memory system disabled</p>
						</div>
					)}
				</div>

				{usage && (
					<div class="card">
						<h3>Usage (7d)</h3>
						<div class="stat-value">
							{formatTokens(
								usage.totalInputTokens + usage.totalOutputTokens,
							)}
						</div>
						<div class="stat-label">Tokens total</div>
						<p class="mt-sm text-secondary">
							Estimated cost:{" "}
							<strong>{formatUsd(usage.estimatedCostUsd)}</strong>
						</p>
						{Object.keys(usage.byProvider).length > 0 && (
							<div class="mt-sm">
								{Object.entries(usage.byProvider).map(([name, v]) => (
									<p class="text-xs text-muted">
										{name}: {formatTokens(v.inputTokens + v.outputTokens)}{" "}
										tokens · {formatUsd(v.costUsd)}
									</p>
								))}
							</div>
						)}
					</div>
				)}

				{feedback && (
					<div class="card">
						<h3>Feedback</h3>
						<div class="flex gap-sm items-center">
							<span class="badge success">
								👍 {feedback.thumbsUp}
							</span>
							<span class="badge danger">
								👎 {feedback.thumbsDown}
							</span>
							<span class="badge warning">
								✎ {feedback.corrections} corrections
							</span>
						</div>
						<p class="text-xs text-muted mt-sm">
							Last 7 days — corrections feed the feedback context so future
							responses avoid repeat mistakes.
						</p>
					</div>
				)}

				{totals && (
					<div class="card">
						<h3>Totals</h3>
						<div class="stat-value">{totals.sessions}</div>
						<div class="stat-label">Sessions</div>
						<p class="mt-sm text-secondary">
							Messages: <strong>{totals.messages}</strong>
						</p>
					</div>
				)}

				<div class="card">
					<h3>Health</h3>
					{Object.entries(health).map(([name, result]) => (
						<div
							class="flex justify-between items-center"
							style="padding: 6px 0"
						>
							<span>{name}</span>
							<span class={`badge ${result.ok ? "success" : "error"}`}>
								{result.ok ? "OK" : "FAIL"}
							</span>
						</div>
					))}
					{Object.keys(health).length === 0 && (
						<div class="empty-state">
							<p>No plugins running</p>
						</div>
					)}
				</div>
			</div>

			<div class="card mt-md">
				<h3>Cron Jobs ({cronJobs.length})</h3>
				{cronJobs.length > 0 ? (
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Expression</th>
								<th>Status</th>
								<th>Last Run</th>
								<th>Next Run</th>
							</tr>
						</thead>
						<tbody>
							{cronJobs.map((job) => (
								<tr>
									<td>{job.name}</td>
									<td>
										<code>{job.expression}</code>
									</td>
									<td>
										<span
											class={`badge ${job.enabled ? "success" : "neutral"}`}
										>
											{job.enabled ? "active" : "disabled"}
										</span>
									</td>
									<td>
										{job.lastRun
											? new Date(job.lastRun).toLocaleString()
											: "never"}
									</td>
									<td>{new Date(job.nextRun).toLocaleString()}</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<div class="empty-state">
						<p>
							No cron jobs configured. Use <code>paw cron add</code> to create
							one.
						</p>
					</div>
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
