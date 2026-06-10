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

	const healthEntries = Object.entries(health);
	const healthyCount = healthEntries.filter(([, r]) => r.ok).length;
	const totalServices = healthEntries.length;
	const allHealthy = totalServices > 0 && healthyCount === totalServices;
	const totalTokens = usage
		? usage.totalInputTokens + usage.totalOutputTokens
		: 0;

	// Sparkline values drawn from real category/provider distribution —
	// not a fabricated time series. Tallest bar gets the bright accent.
	const sparkValues: number[] = memoryStats
		? Object.values(memoryStats.byCategory)
		: usage
			? Object.values(usage.byProvider).map(
					(v) => v.inputTokens + v.outputTokens,
				)
			: [];
	const sparkMax = Math.max(...sparkValues, 1);

	return (
		<Layout title="Dashboard" currentPath="/">
			{/* Status strip */}
			<div class="flex items-center gap-sm flex-wrap mb-md">
				<span class="badge badge-neutral" style="gap:8px">
					{allHealthy ? (
						<span class="live-dot" />
					) : (
						<span
							class="dot"
							style={`background:${totalServices === 0 ? "var(--text-tertiary)" : "var(--warning)"}`}
						/>
					)}
					{totalServices > 0
						? `${healthyCount}/${totalServices} services healthy`
						: "no plugins running"}
				</span>
				<span class="badge badge-accent">{provider}</span>
				{plugins.length > 0 && (
					<span class="badge badge-neutral">
						{plugins.length} plugin{plugins.length === 1 ? "" : "s"}
					</span>
				)}
				<span class="badge badge-neutral mono">up {uptimeStr}</span>
			</div>

			{/* Metric tiles */}
			<div class="grid">
				<div class="card metric">
					<span class="m-label">Uptime</span>
					<span class="m-value">{uptimeStr}</span>
					<span class="m-sub">
						<span>
							provider <span class="mono">{provider}</span>
						</span>
					</span>
				</div>

				<div class="card metric">
					<span class="m-label">Memories</span>
					<span class="m-value">
						{memoryStats ? memoryStats.totalMemories : "—"}
					</span>
					<span class="m-sub">
						{memoryStats
							? `${Object.keys(memoryStats.byCategory).length} categories`
							: "memory disabled"}
					</span>
				</div>

				{usage ? (
					<div class="card metric">
						<span class="m-label">Tokens · 7d</span>
						<span class="m-value">{formatTokens(totalTokens)}</span>
						<span class="m-sub">
							<span class="mono">{formatUsd(usage.estimatedCostUsd)}</span> est.
							cost
						</span>
					</div>
				) : (
					<div class="card metric">
						<span class="m-label">Services</span>
						<span
							class="m-value"
							style={allHealthy ? "" : "color:var(--warning)"}
						>
							{totalServices > 0 ? `${healthyCount}/${totalServices}` : "0"}
						</span>
						<span class="m-sub">healthy</span>
					</div>
				)}

				{totals ? (
					<div class="card metric">
						<span class="m-label">Sessions</span>
						<span class="m-value">{totals.sessions}</span>
						<span class="m-sub">
							<span class="mono">{totals.messages}</span> messages
						</span>
					</div>
				) : feedback ? (
					<div class="card metric">
						<span class="m-label">Feedback · 7d</span>
						<span class="m-value">
							{feedback.thumbsUp + feedback.thumbsDown}
						</span>
						<span class="m-sub">
							<span class="m-delta-up">▲ {feedback.thumbsUp}</span>
							<span class="m-delta-down">▼ {feedback.thumbsDown}</span>
							<span class="mono">{feedback.corrections} fixes</span>
						</span>
					</div>
				) : (
					<div class="card metric">
						<span class="m-label">Plugins</span>
						<span class="m-value">{plugins.length}</span>
						<span class="m-sub">{plugins.join(", ") || "none"}</span>
					</div>
				)}
			</div>

			{/* Distribution + health feed */}
			<div class="dash-split">
				<div class="card">
					<div class="flex justify-between items-center mb-md">
						<span class="label-xs">
							{memoryStats
								? "Memory by category"
								: usage
									? "Tokens by provider"
									: "Distribution"}
						</span>
						{usage && <span class="badge badge-accent">7d</span>}
					</div>
					{sparkValues.length > 0 ? (
						<>
							<div class="spark" style="height:90px">
								{sparkValues.map((v) => (
									<span
										class={v === sparkMax ? "hi" : ""}
										style={`height:${Math.max(6, Math.round((v / sparkMax) * 100))}%`}
									/>
								))}
							</div>
							<div class="flex flex-wrap gap-sm mt-sm">
								{memoryStats
									? Object.entries(memoryStats.byCategory).map(([cat, n]) => (
											<span class="text-xs text-muted mono">
												{cat}:{n}
											</span>
										))
									: usage
										? Object.entries(usage.byProvider).map(([name, v]) => (
												<span class="text-xs text-muted mono">
													{name}:{formatTokens(v.inputTokens + v.outputTokens)}
												</span>
											))
										: null}
							</div>
						</>
					) : (
						<div class="empty-state">
							<p>No activity data yet</p>
						</div>
					)}
				</div>

				<div class="card">
					<span class="label-xs">System health</span>
					<div class="flex-col gap-sm mt-sm">
						{healthEntries.map(([name, result]) => (
							<div class="flex items-center gap-sm justify-between">
								<span class="flex items-center gap-sm">
									<span
										class="dot"
										style={`width:7px;height:7px;border-radius:50%;flex:none;background:${result.ok ? "var(--success)" : "var(--danger)"}`}
									/>
									<span class="text-sm">{name}</span>
								</span>
								<span
									class={`badge ${result.ok ? "badge-success" : "badge-danger"}`}
								>
									{result.ok ? "ok" : "fail"}
								</span>
							</div>
						))}
						{totalServices === 0 && (
							<div class="empty-state">
								<p>No plugins running</p>
							</div>
						)}
					</div>
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
