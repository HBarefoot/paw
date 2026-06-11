import { raw } from "hono/html";
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
	nodes?: Array<{ key: string; label: string; kind: string }>;
	sceneModel?: string;
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
	nodes,
	sceneModel,
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

					{/* Hero — live pseudo-3D constellation of the LLM core + skills */}
					<div class="card ops-card">
						<div class="flex justify-between items-center mb-md">
							<span class="label-xs">Live operations</span>
							<span class="ops-hud">
								<span class="ops-dot" id="ops-status" />
								<span class="mono text-xs" id="ops-model">
									{sceneModel || "—"}
								</span>
							</span>
						</div>
						<div class="ops-stage">
							<canvas
								id="ops-canvas"
								class="ops-scene"
								data-nodes={JSON.stringify(nodes ?? [])}
								data-model={sceneModel ?? ""}
							/>
						</div>
						<div class="ops-ticker" id="ops-ticker">
							{(activity ?? [])
								.filter((a) => a.kind === "tool")
								.slice(0, 6)
								.map((a) => (
									<div class="tk-row" key={`${a.ts}-${a.label}`}>
										<span class={a.ok === false ? "tk-dot err" : "tk-dot"} />
										<span class="tk-name mono">{a.label}</span>
										<span class="tk-skill mono">{a.sub ?? ""}</span>
									</div>
								))}
						</div>
					</div>

					<div class="dash-split">
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

					{/* Recent conversations */}
					<div class="card mt-md">
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

					{raw(OPS_SCENE_SCRIPT)}
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

// ── Live agent-ops scene (Canvas2D pseudo-3D constellation) ─────────────────
// Served inline. HARD RULE: no regex literals and no backslash escapes in this
// string — it's a template literal, so the runtime "cooks" backslashes (the trap
// that broke the canvas portrait twice). String methods + real characters only.
const OPS_SCENE_SCRIPT = `<script data-cfasync="false">(function(){
  var cv = document.getElementById("ops-canvas");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");
  var ticker = document.getElementById("ops-ticker");
  var elModel = document.getElementById("ops-model");
  var elStatus = document.getElementById("ops-status");
  var nodes = [];
  try { nodes = JSON.parse(cv.getAttribute("data-nodes") || "[]"); } catch (e) {}
  var model = cv.getAttribute("data-model") || "";
  var REDUCE = false;
  try { REDUCE = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) {}

  function cssVar(n, fb){ try { var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || fb; } catch (e) { return fb; } }
  function hexToRgb(h){ h = (h || "").trim(); if (h.charAt(0) === "#") h = h.slice(1); if (h.length === 3) h = h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2); var num = parseInt(h, 16); if (isNaN(num)) return [116,88,245]; return [(num>>16)&255,(num>>8)&255,num&255]; }
  var ACCENT = hexToRgb(cssVar("--accent", "#7458f5"));
  var BRIGHT = hexToRgb(cssVar("--accent-bright", "#a78bfa"));
  var DANGER = [239,90,90];
  var WHITE = [255,255,255];
  function rgba(c, a){ return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  var W=0, H=0, CX=0, CY=0, R=0, DPR=1;
  function resize(){ DPR = Math.min(window.devicePixelRatio || 1, 2); var r = cv.getBoundingClientRect(); W = r.width || 600; H = r.height || 300; cv.width = Math.round(W*DPR); cv.height = Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0); CX = W/2; CY = H*0.46; }
  resize();
  window.addEventListener("resize", resize);

  var N = nodes.length || 1;
  var byKey = {};
  for (var i=0;i<nodes.length;i++){ nodes[i].base = (i/N)*Math.PI*2; nodes[i].lit = 0; nodes[i].err = 0; byKey[nodes[i].key] = nodes[i]; }

  var packets = [], ripples = [], spin = 0, working = false, corePulse = 0;
  var T = 0, blinkUntil = 0, nextBlink = 1.5, sats = {};
  var TILT = 0.6;
  function project(a){ var z = Math.sin(a); return { x: CX + Math.cos(a)*R, y: CY + z*R*TILT, depth: (z+1)/2 }; }
  function clip(s, n){ s = String(s || ""); return s.length > n ? s.slice(0, n-1) + "…" : s; }
  function eyes(x, y, r, a){ var open = (T < blinkUntil) ? 0.18 : 1; var look = Math.sin(T*0.6)*r*0.18; ctx.fillStyle = rgba([12,10,22], 0.82*a); ctx.beginPath(); ctx.ellipse(x - r*0.34 + look, y - r*0.08, r*0.18, r*0.3*open, 0, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(x + r*0.34 + look, y - r*0.08, r*0.18, r*0.3*open, 0, 0, Math.PI*2); ctx.fill(); }

  function fireTool(skill, ok){ var node = skill ? byKey[skill] : null; if (node){ node.lit = 1; if (!ok) node.err = 1; } if (!REDUCE) packets.push({ node: node, t: 0, err: !ok }); else { corePulse = 1; } }

  function drawCore(){
    var pr = Math.min(W,H)*0.12 * (1 + corePulse*0.18 + (working?0.06:0));
    var g = ctx.createRadialGradient(CX,CY,0,CX,CY,pr*2.4);
    g.addColorStop(0, rgba(BRIGHT, 0.9)); g.addColorStop(0.4, rgba(ACCENT, 0.5)); g.addColorStop(1, rgba(ACCENT, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX,CY,pr*2.4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = rgba(BRIGHT, 0.95); ctx.beginPath(); ctx.arc(CX,CY,pr*0.55,0,Math.PI*2); ctx.fill();
    eyes(CX, CY - pr*0.04, pr*0.55, 1);
    ctx.fillStyle = rgba(WHITE, 0.85); ctx.font = "600 11px ui-monospace, SFMono-Regular, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(model || "LLM", CX, CY + pr*0.55 + 15);
  }
  function drawNode(nn){
    var p = project(nn.base + spin);
    var size = 3 + p.depth*4 + nn.lit*3;
    var col = nn.err>0 ? DANGER : (nn.lit>0 ? BRIGHT : ACCENT);
    if (nn.lit>0){ var gg = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,size*4.5); gg.addColorStop(0, rgba(col, 0.6*nn.lit)); gg.addColorStop(1, rgba(col,0)); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x,p.y,size*4.5,0,Math.PI*2); ctx.fill(); }
    ctx.fillStyle = rgba(col, 0.35 + p.depth*0.5 + nn.lit*0.4); ctx.beginPath(); ctx.arc(p.x,p.y,size,0,Math.PI*2); ctx.fill();
    if (p.depth > 0.32){ ctx.fillStyle = rgba(WHITE, 0.22 + p.depth*0.45 + nn.lit*0.3); ctx.font = (p.depth>0.7 ? "11px" : "10px") + " ui-monospace, SFMono-Regular, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(nn.label, p.x, p.y + size + 4); }
  }
  function drawWire(nn){ var p = project(nn.base + spin); var mx = (p.x+CX)/2, my = (p.y+CY)/2 - 8; ctx.strokeStyle = rgba(nn.err>0?DANGER:ACCENT, 0.08 + p.depth*0.2 + nn.lit*0.5); ctx.lineWidth = 1 + p.depth*0.6; ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.quadraticCurveTo(mx,my,CX,CY); ctx.stroke(); }
  function drawPacket(pk){ var from = pk.node ? project(pk.node.base + spin) : { x: CX, y: CY - R }; var mx = (from.x+CX)/2, my = (from.y+CY)/2 - 8, t = pk.t; var x = (1-t)*(1-t)*from.x + 2*(1-t)*t*mx + t*t*CX; var y = (1-t)*(1-t)*from.y + 2*(1-t)*t*my + t*t*CY; var col = pk.err ? DANGER : BRIGHT; var gg = ctx.createRadialGradient(x,y,0,x,y,8); gg.addColorStop(0, rgba(col,0.95)); gg.addColorStop(1, rgba(col,0)); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x,y,8,0,Math.PI*2); ctx.fill(); ctx.fillStyle = rgba(col,1); ctx.beginPath(); ctx.arc(x,y,2.4,0,Math.PI*2); ctx.fill(); }
  function drawRipple(rp){ var rad = Math.min(W,H)*0.12 + rp.t*Math.min(W,H)*0.24; ctx.strokeStyle = rgba(BRIGHT, 0.5*(1-rp.t)); ctx.lineWidth = 2*(1-rp.t) + 0.4; ctx.beginPath(); ctx.arc(CX,CY,rad,0,Math.PI*2); ctx.stroke(); }
  // A spawned sub-agent: a mini face on an inner arc, wired back to the core.
  function drawSat(s, idx, n){
    var ang = Math.PI*0.5 + (idx - (n-1)/2) * 0.55;
    var Rs = Math.min(W*0.7, H*1.3) * 0.34;
    var sx = CX + Math.cos(ang)*Rs;
    var sy = CY + Math.sin(ang)*Rs + (REDUCE ? 0 : Math.sin(T*1.4 + idx)*3);
    var a = s.alpha;
    var running = !s.done;
    var col = s.done ? (s.ok ? [120,200,140] : DANGER) : BRIGHT;
    var mx = (sx+CX)/2, my = (sy+CY)/2;
    ctx.strokeStyle = rgba(col, 0.5*a); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(sx,sy); ctx.quadraticCurveTo(mx,my,CX,CY); ctx.stroke();
    if (running && !REDUCE){ var tt = (T*0.8 + idx*0.3) % 1; var px = (1-tt)*(1-tt)*sx + 2*(1-tt)*tt*mx + tt*tt*CX; var py = (1-tt)*(1-tt)*sy + 2*(1-tt)*tt*my + tt*tt*CY; ctx.fillStyle = rgba(col, 0.9*a); ctx.beginPath(); ctx.arc(px,py,2,0,Math.PI*2); ctx.fill(); }
    var rs = 11 + (running && !REDUCE ? Math.sin(T*3 + idx)*1.4 : 0);
    var gg = ctx.createRadialGradient(sx,sy,0,sx,sy,rs*2.4); gg.addColorStop(0, rgba(col, 0.5*a)); gg.addColorStop(1, rgba(col,0)); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(sx,sy,rs*2.4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = rgba(col, 0.92*a); ctx.beginPath(); ctx.arc(sx,sy,rs,0,Math.PI*2); ctx.fill();
    eyes(sx, sy, rs, a);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillStyle = rgba(WHITE, 0.85*a); ctx.font = "600 10px ui-monospace, SFMono-Regular, monospace"; ctx.fillText(clip(s.name, 18), sx, sy + rs + 4);
    if (s.task){ ctx.fillStyle = rgba(WHITE, 0.4*a); ctx.font = "9px ui-monospace, SFMono-Regular, monospace"; ctx.fillText(clip(s.task, 24), sx, sy + rs + 16); }
  }

  var last = 0;
  function frame(ts){
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last)/1000); last = ts;
    T += dt;
    if (T > nextBlink){ blinkUntil = T + 0.12; nextBlink = T + 2.5 + Math.random()*3; }
    if (!REDUCE) spin += dt*0.12;
    R = Math.min(W*0.82, H*1.5)*0.4;
    ctx.clearRect(0,0,W,H);
    corePulse = Math.max(0, corePulse - dt*1.6);
    for (var i=0;i<nodes.length;i++){ nodes[i].lit = Math.max(0, nodes[i].lit - dt*0.8); nodes[i].err = Math.max(0, nodes[i].err - dt*0.8); }
    var order = nodes.slice().sort(function(a,b){ return project(a.base+spin).depth - project(b.base+spin).depth; });
    for (var w=0; w<order.length; w++) drawWire(order[w]);
    drawCore();
    for (var n2=0; n2<order.length; n2++) drawNode(order[n2]);
    var sl = [];
    for (var sid in sats){ var sv = sats[sid]; if (sv.removing){ sv.alpha -= dt*2; if (sv.alpha <= 0){ delete sats[sid]; continue; } } else { sv.alpha = Math.min(1, sv.alpha + dt*3); } sl.push(sv); }
    sl.sort(function(a,b){ return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    for (var s2=0; s2<sl.length; s2++) drawSat(sl[s2], s2, sl.length);
    for (var k=packets.length-1;k>=0;k--){ var pk = packets[k]; pk.t += dt/0.85; if (pk.t >= 1){ corePulse = 1; ripples.push({ t: 0 }); packets.splice(k,1); continue; } drawPacket(pk); }
    for (var r2=ripples.length-1;r2>=0;r2--){ ripples[r2].t += dt/0.9; if (ripples[r2].t >= 1){ ripples.splice(r2,1); continue; } drawRipple(ripples[r2]); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function addTicker(t){ if (!ticker) return; var row = document.createElement("div"); row.className = "tk-row"; var dot = document.createElement("span"); dot.className = t.ok ? "tk-dot" : "tk-dot err"; var name = document.createElement("span"); name.className = "tk-name mono"; name.textContent = t.tool; var sk = document.createElement("span"); sk.className = "tk-skill mono"; sk.textContent = t.skill || ""; row.appendChild(dot); row.appendChild(name); row.appendChild(sk); ticker.insertBefore(row, ticker.firstChild); while (ticker.children.length > 6) ticker.removeChild(ticker.lastChild); }

  var cursor = 0, first = true, delay = 2200;
  function poll(){
    fetch("/api/agent-ops?since=" + cursor).then(function(r){ return r.json(); }).then(function(d){
      if (!d) return;
      working = !!d.working; if (d.model) model = d.model; cursor = d.cursor || cursor;
      if (elModel && model) elModel.textContent = model;
      if (elStatus) elStatus.className = working ? "ops-dot on" : "ops-dot";
      var tools = d.tools || [];
      if (first){ first = false; } else { for (var i=0;i<tools.length;i++){ fireTool(tools[i].skill, tools[i].ok); addTicker(tools[i]); } }
      var agents = d.agents || [], liveIds = {};
      for (var ai=0; ai<agents.length; ai++){ var ag = agents[ai]; liveIds[ag.id] = true; if (!sats[ag.id]) sats[ag.id] = { id: ag.id, name: ag.name, task: ag.task, alpha: 0, removing: false }; var sv = sats[ag.id]; sv.task = ag.task; sv.done = ag.done; sv.ok = ag.ok; sv.removing = false; }
      for (var rid in sats){ if (!liveIds[rid]) sats[rid].removing = true; }
      delay = (working || agents.length) ? 1300 : 2400;
    }).catch(function(){}).then(function(){ setTimeout(poll, delay); });
  }
  poll();
})();</script>`;
