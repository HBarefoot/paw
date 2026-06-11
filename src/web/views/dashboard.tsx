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
	activity?: Array<{
		ts: string;
		kind: "tool" | "turn" | "note";
		label: string;
		sub?: string;
		ok?: boolean;
	}>;
	timeline?: {
		requests: number[];
		tokens: number[];
		totalRequests: number;
		totalTokens: number;
		peak: number;
	};
	recentSessions?: Array<{
		id: string;
		channel: string;
		message_count: number;
		updated_at: string;
		snippet: string | null;
	}>;
	toolUsage?: Array<{ name: string; count: number; errors: number }>;
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
	activity,
	timeline,
	recentSessions,
	toolUsage,
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
	const toolMax = toolUsage ? Math.max(...toolUsage.map((t) => t.count), 1) : 1;
	const hasAgentOps = Boolean(
		activity?.length ||
			(timeline && timeline.totalRequests > 0) ||
			recentSessions?.length ||
			toolUsage?.length,
	);
	const kindLabel: Record<string, string> = {
		tool: "tool",
		turn: "turn",
		note: "note",
	};

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

			{/* Agent operations */}
			{hasAgentOps && (
				<>
					<div class="flex items-center gap-sm mt-md mb-md">
						<span class="label-xs">Agent operations</span>
						<span class="badge badge-accent">live</span>
					</div>

					<div class="dash-split">
						{/* Live activity feed */}
						<div class="card">
							<div class="flex justify-between items-center mb-md">
								<span class="label-xs">Activity</span>
								{activity && activity.length > 0 && (
									<span class="badge badge-neutral mono">
										{activity.length}
									</span>
								)}
							</div>
							{activity && activity.length > 0 ? (
								<div class="flex-col gap-sm">
									{activity.map((a) => (
										<div class="act-row" key={`${a.kind}-${a.ts}-${a.label}`}>
											<span
												class={`act-kind act-${a.kind}`}
												style={a.ok === false ? "background:var(--danger)" : ""}
											/>
											<span class="act-tag mono">{kindLabel[a.kind]}</span>
											<span class="act-label mono">{a.label}</span>
											{a.sub && <span class="act-sub mono">{a.sub}</span>}
											<span class="act-time mono">{ago(a.ts)}</span>
										</div>
									))}
								</div>
							) : (
								<div class="empty-state">
									<p>No agent activity yet</p>
								</div>
							)}
						</div>

						{/* Activity timeline */}
						<div class="card">
							<div class="flex justify-between items-center mb-md">
								<span class="label-xs">Requests · 24h</span>
								<span class="badge badge-accent">24h</span>
							</div>
							{timeline && timeline.totalRequests > 0 ? (
								<>
									<div class="spark" style="height:90px">
										{timeline.requests.map((v) => (
											<span
												class={v === timeline.peak && v > 0 ? "hi" : ""}
												style={`height:${Math.max(4, Math.round((v / Math.max(timeline.peak, 1)) * 100))}%`}
											/>
										))}
									</div>
									<div class="flex flex-wrap gap-sm mt-sm">
										<span class="text-xs text-muted mono">
											{timeline.totalRequests} calls
										</span>
										<span class="text-xs text-muted mono">
											{formatTokens(timeline.totalTokens)} tok
										</span>
										<span class="text-xs text-muted mono">
											peak {timeline.peak}/h
										</span>
									</div>
								</>
							) : (
								<div class="empty-state">
									<p>No model calls in the last 24h</p>
								</div>
							)}
						</div>
					</div>

					<div class="dash-split">
						{/* Recent conversations */}
						<div class="card">
							<span class="label-xs">Recent conversations</span>
							<div class="flex-col gap-sm mt-sm">
								{recentSessions && recentSessions.length > 0 ? (
									recentSessions.map((s) => (
										<div class="sess-row" key={s.id}>
											<div class="flex items-center gap-sm justify-between">
												<span class="flex items-center gap-sm">
													<span class="badge badge-neutral">{s.channel}</span>
													<span class="text-xs text-muted mono">
														{s.message_count} msg
													</span>
												</span>
												<span class="text-xs text-muted mono">
													{ago(s.updated_at)}
												</span>
											</div>
											{s.snippet && (
												<span class="sess-snippet">
													{truncate(s.snippet, 96)}
												</span>
											)}
										</div>
									))
								) : (
									<div class="empty-state">
										<p>No conversations yet</p>
									</div>
								)}
							</div>
						</div>

						{/* Tool usage */}
						<div class="card">
							<div class="flex justify-between items-center mb-md">
								<span class="label-xs">Tool usage</span>
								<span class="badge badge-accent">7d</span>
							</div>
							{toolUsage && toolUsage.length > 0 ? (
								<div class="flex-col gap-sm">
									{toolUsage.map((t) => (
										<div class="tool-row" key={t.name}>
											<span class="tool-name mono">{t.name}</span>
											<span class="tool-bar">
												<span
													class="tool-bar-fill"
													style={`width:${Math.max(6, Math.round((t.count / toolMax) * 100))}%`}
												/>
											</span>
											<span class="tool-count mono">
												{t.count}
												{t.errors > 0 && (
													<span class="tool-err"> · {t.errors} err</span>
												)}
											</span>
										</div>
									))}
								</div>
							) : (
								<div class="empty-state">
									<p>No tool calls recorded yet</p>
								</div>
							)}
						</div>
					</div>
				</>
			)}

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

/** Compact relative time from a SQLite "YYYY-MM-DD HH:MM:SS" (UTC) timestamp. */
function ago(ts: string): string {
	const t = Date.parse(ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`);
	if (Number.isNaN(t)) return "";
	const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h`;
	return `${Math.floor(h / 24)}d`;
}

function truncate(s: string, n: number): string {
	const clean = s.replace(/\s+/g, " ").trim();
	return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}
