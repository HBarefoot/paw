/* ===========================================================================
   dash.js — Agent Operations dashboard renderer (vanilla port of app/panels/
   panels2.jsx). Builds the shell once, then renders every panel from the REAL
   engine (window.AgentOps) on each ~2s poll + a 1s liveness tick. Charts +
   sparklines are persistent canvases redrawn each render; scroll panels keep
   their scrollTop. Exposed on window.OpsDash.
   =========================================================================== */
(() => {
	const ui = window.OpsUI;
	const charts = window.OpsCharts;
	const el = ui.el;

	function mount(root, cfg) {
		cfg = cfg || {};
		const eng = window.AgentOps;
		const refs = {};
		root.innerHTML = "";

		// ---- top bar ----------------------------------------------------------
		const brandMark = cfg.brandLogo
			? el("img", {
					class: "ops-brand-logo",
					src: cfg.brandLogo,
					alt: cfg.brandName || "",
				})
			: el("span", { class: "ops-brand-mark" });
		refs.connPill = el("span", { class: "ops-conn-pill" });
		refs.actChip = el("span", { class: "ops-activity-chip" });
		refs.modelChip = el("span", { class: "ops-model-chip" });
		refs.clock = el("span", { class: "v tnum" });
		refs.pauseBtn = el("button", {
			class: "ops-btn",
			type: "button",
			title: "Pause / resume the live feed",
			onclick: () => {
				eng.setRunning(!eng.running);
				render();
			},
		});
		const topbar = el("div", { class: "ops-topbar" }, [
			el("div", { class: "ops-brand" }, [
				brandMark,
				el("div", null, [
					el("div", { class: "name", text: "AGENT OPS" }),
					el("div", { class: "sub", text: "Operations monitor" }),
				]),
			]),
			refs.connPill,
			refs.actChip,
			refs.modelChip,
			el("div", { class: "ops-spacer" }),
			el("div", { class: "ops-top-clock" }, [
				refs.clock,
				el("span", { class: "k", text: "session uptime" }),
			]),
			el("div", { class: "ops-ctrl" }, [refs.pauseBtn]),
		]);

		// ---- KPI strip --------------------------------------------------------
		const KPIS = [
			{ id: "tps", k: "ops / sec", icon: "pulse", spark: ui.palette().accent },
			{ id: "inflight", k: "in flight", icon: "bars" },
			{ id: "err", k: "error rate", spark: ui.palette().red },
			{ id: "p95", k: "p95 latency", icon: "gauge", spark: ui.palette().amber },
			{ id: "tokens", k: "tokens", icon: "bars" },
			{ id: "cost", k: "est. cost" },
			{ id: "tasks", k: "tasks done" },
		];
		refs.kpi = {};
		const kpiNodes = KPIS.map((c) => {
			const v = el("div", { class: "v tnum" });
			const foot = el("div", { class: "foot" });
			const sparkCanvas = c.spark ? el("canvas") : null;
			refs.kpi[c.id] = { v, foot, spark: sparkCanvas, sparkColor: c.spark };
			const head = el("div", { class: "k" }, [
				c.icon ? frag(ui.icons[c.icon]) : null,
				c.k,
			]);
			return el("div", { class: "ops-kpi" }, [
				head,
				v,
				sparkCanvas ? el("div", { class: "spark" }, [sparkCanvas]) : null,
				foot,
			]);
		});
		const kpiStrip = el("div", { class: "ops-kpi-strip" }, kpiNodes);

		// ---- panels -----------------------------------------------------------
		function panel(title, icon, opts) {
			opts = opts || {};
			const meta = el("div", { class: "meta" });
			const body = el("div", {
				class: "ops-panel-bd" + (opts.tight ? " tight" : "") + (opts.scroll ? " scroll" : ""),
			});
			const p = el(
				"div",
				{ class: "ops-panel", style: opts.flex ? "flex:" + opts.flex : null },
				[
					el("div", { class: "ops-panel-hd" }, [
						el("div", { class: "ttl" }, [
							icon ? el("span", { class: "ico", html: ui.icons[icon] }) : null,
							title,
						]),
						meta,
					]),
					body,
				],
			);
			return { panel: p, meta, body };
		}

		// throughput
		const thr = panel("Throughput", "pulse", { flex: "1.5 1 0" });
		refs.thrNow = el("span", { class: "big tnum" });
		refs.thrState = el("span", { class: "unit", style: "margin-left:auto" });
		refs.thrCanvas = el("canvas");
		thr.body.appendChild(
			el("div", { class: "ops-chart-now" }, [
				refs.thrNow,
				el("span", { class: "unit", text: "ops/sec now" }),
				refs.thrState,
			]),
		);
		thr.body.appendChild(el("div", { class: "ops-chart-wrap" }, [refs.thrCanvas]));

		// latency
		const lat = panel("Latency", "gauge");
		refs.latNow = el("span", { class: "big tnum", style: "color:var(--ops-amber)" });
		refs.latP50 = el("span", { class: "unit", style: "margin-left:14px;color:var(--accent)" });
		refs.latCanvas = el("canvas");
		lat.body.appendChild(
			el("div", { class: "ops-chart-now" }, [
				refs.latNow,
				el("span", { class: "unit", text: "p95" }),
				refs.latP50,
			]),
		);
		lat.body.appendChild(el("div", { class: "ops-chart-wrap" }, [refs.latCanvas]));

		// by-tool
		const byTool = panel("Operations by tool", "bars", { scroll: true });
		refs.byToolMeta = byTool.meta;
		refs.byToolBody = byTool.body;

		const midrow = el("div", { class: "ops-midrow" }, [lat.panel, byTool.panel]);

		// ops log
		const log = panel("Operation log", "list", { tight: true, flex: "1.6 1 0" });
		refs.logMeta = log.meta;
		const logHd = el("div", { class: "ops-log-hd" }, [
			el("span", { text: "when" }),
			el("span", { text: "operation" }),
			el("span", { text: "tool" }),
			el("span", { text: "duration", style: "text-align:right" }),
			el("span", { text: "tokens", style: "text-align:right" }),
		]);
		refs.logBody = el("div", { class: "ops-log scroll" });
		log.body.appendChild(logHd);
		log.body.appendChild(refs.logBody);

		// connection card
		const conn = panel("Connection", "link");
		refs.connMeta = conn.meta;
		refs.connBody = conn.body;
		conn.body.className = "ops-panel-bd tight";

		// tool health
		const health = panel("Tool & MCP health", "grid", { tight: true, scroll: true, flex: "1.3 1 0" });
		refs.healthMeta = health.meta;
		refs.healthBody = health.body;

		// session recap
		const recap = panel("Session recap", "recap", { scroll: true, flex: "1 1 0" });
		refs.recapMeta = recap.meta;
		refs.recapBody = recap.body;

		const colL = el("div", { class: "ops-col" }, [thr.panel, midrow, log.panel]);
		const colR = el("div", { class: "ops-col" }, [conn.panel, health.panel, recap.panel]);
		const dash = el("div", { class: "ops-dash" }, [
			kpiStrip,
			el("div", { class: "ops-dash-body" }, [colL, colR]),
		]);

		root.appendChild(el("div", { class: "ops-shell" }, [topbar, dash]));

		// ---- render -----------------------------------------------------------
		function setScroll(node, html) {
			const top = node.scrollTop;
			node.innerHTML = html;
			node.scrollTop = top;
		}
		function trend(samples, key) {
			const n = samples.length;
			if (n < 8) return 0;
			const half = Math.min(15, Math.floor(n / 2));
			const recent = samples.slice(n - half);
			const prev = samples.slice(n - 2 * half, n - half);
			const a = recent.reduce((s, x) => s + key(x), 0) / Math.max(1, recent.length);
			const b = prev.reduce((s, x) => s + key(x), 0) / Math.max(1, prev.length);
			if (b === 0) return a > 0 ? 1 : 0;
			return (a - b) / b;
		}
		function deltaHTML(v, invert) {
			if (!Number.isFinite(v) || Math.abs(v) < 0.02)
				return '<span class="delta down">—</span>';
			const up = v > 0;
			const good = invert ? !up : up;
			const cls = good ? "up" : invert ? "bad" : "down";
			return (
				'<span class="delta ' +
				cls +
				'">' +
				(up ? "▲" : "▼") +
				" " +
				Math.abs(v * 100).toFixed(0) +
				"%</span>"
			);
		}

		function render() {
			const connected = eng.connected;
			const running = eng.running;
			const tot = eng.totals(5000);
			const sess = eng.sessionStats();
			const latency = eng.latencyPctl(8000);
			const act = eng.getActivity();
			const hist = eng.history();
			const now = eng.now();
			const working = running && act.state === "working";
			const p = ui.palette();

			// topbar
			refs.connPill.className = "ops-conn-pill" + (running ? "" : " paused");
			refs.connPill.innerHTML =
				'<span class="dot' +
				(running && connected ? " pulse" : "") +
				'" style="background:' +
				(running ? (connected ? p.accent : p.amber) : p.amber) +
				'"></span>' +
				(!running ? "PAUSED" : connected ? "CONNECTED" : "CONNECTING");
			refs.actChip.className = "ops-activity-chip" + (working ? "" : " standby");
			refs.actChip.innerHTML =
				'<span class="dot" style="background:' +
				(working ? p.accent : p.faint) +
				'"></span><span class="label">' +
				(working ? "WORKING" : "STANDBY") +
				"</span>";
			refs.modelChip.innerHTML =
				'<span class="dot" style="background:' +
				p.accent +
				'"></span>' +
				ui.esc(eng.model || cfg.model || "—");
			// Session uptime — the engine tracks time since first poll (server clock).
			refs.clock.textContent = ui.fmtClock(sess.durationMs);
			refs.pauseBtn.textContent = running ? "❚❚ Pause" : "▶ Resume";

			// KPIs
			const okSpark = hist.slice(-40).map((s) => s.ok + s.err);
			const errSpark = hist.slice(-40).map((s) => s.err);
			const latSpark = hist.slice(-40).map((s) => s.p95);
			setKpi("tps", tot.tps.toFixed(1), deltaHTML(trend(hist.slice(-30), (s) => s.ok + s.err)) + '<span class="sub">' + (working ? "live" : "standby") + "</span>", okSpark);
			setKpi("inflight", String(tot.active), '<span class="sub">' + (working ? "executing" : "queue clear") + "</span>");
			setKpi("err", ui.fmtPct(sess.errorRate), '<span class="sub">' + sess.errTotal + " of " + ui.fmtNum(sess.opsTotal) + " ops</span>", errSpark);
			setKpi("p95", ui.fmtMs(latency.p95), deltaHTML(trend(hist.slice(-30), (s) => s.p95), true) + '<span class="sub">p50 ' + ui.fmtMs(latency.p50) + "</span>", latSpark);
			setKpi("tokens", ui.fmtNum(sess.tokIn + sess.tokOut), '<span class="sub">' + ui.fmtNum(sess.tokIn) + " in · " + ui.fmtNum(sess.tokOut) + " out</span>");
			setKpi("cost", ui.fmtCost(sess.cost), '<span class="sub">' + (sess.tokPerSec ? ui.fmtNum(sess.tokPerSec) + " tok/s" : "—") + "</span>");
			setKpi("tasks", sess.tasksDone + '<small> / ' + sess.tasksStarted + "</small>", '<span class="sub">' + eng.tasks().filter((t) => t.status === "running").length + " running</span>");

			// throughput
			refs.thrNow.textContent = tot.tps.toFixed(1);
			refs.thrState.textContent = working ? "● working" : "○ standby";
			refs.thrState.style.color = working ? p.accent : p.faint;
			charts.throughput(refs.thrCanvas, hist, 120);

			// latency
			refs.latNow.textContent = ui.fmtMs(latency.p95);
			refs.latP50.textContent = ui.fmtMs(latency.p50) + " p50";
			charts.latency(refs.latCanvas, hist, 120);

			// by-tool
			const health = eng.toolHealth().filter((h) => h.opsTotal > 0).sort((a, b) => b.opsTotal - a.opsTotal);
			const maxOps = Math.max(1, ...health.map((h) => h.opsTotal));
			const totalOps = health.reduce((s, h) => s + h.opsTotal, 0);
			refs.byToolMeta.textContent = ui.fmtNum(totalOps) + " in window";
			refs.byToolBody.innerHTML = health.length
				? health
						.slice(0, 8)
						.map((h) => {
							const okN = h.opsTotal - h.errTotal;
							return (
								'<div class="ops-bar-row"><span class="nm"><span class="sw" style="background:' +
								h.tool.color +
								'"></span>' +
								ui.esc(h.tool.label) +
								'</span><span class="bar-track"><span class="ok" style="width:' +
								((okN / maxOps) * 100) +
								"%;background:" +
								ui.hexA(h.tool.color, 0.85) +
								'"></span>' +
								(h.errTotal ? '<span class="err" style="width:' + ((h.errTotal / maxOps) * 100) + '%"></span>' : "") +
								'</span><span class="val tnum">' +
								ui.fmtNum(h.opsTotal) +
								"</span></div>"
							);
						})
						.join("")
				: emptyHTML("No tool activity in the window yet.");

			// op log
			const rows = eng.recent(90);
			refs.logMeta.innerHTML =
				(working ? '<span class="dot pulse"></span> ' : "") + ui.fmtNum(rows.length) + " shown";
			setScroll(
				refs.logBody,
				rows.length
					? rows
							.map((o) => {
								const t = eng.toolById(o.toolId) || { label: o.toolId, color: p.faint };
								return (
									'<div class="ops-log-row"><span class="ago tnum">' +
									(o.status === "running"
										? '<span style="color:' + p.cyan + '">live</span>'
										: ui.agoMs(now, o.endAt)) +
									'</span><span class="op"><span class="led" style="background:' +
									ui.statusColor(o.status) +
									'"></span>' +
									ui.esc(o.op) +
									(o.args ? '<span class="arg"> ' + ui.esc(o.args) + "</span>" : "") +
									'</span><span class="tool"><span class="sw" style="background:' +
									t.color +
									'"></span>' +
									ui.esc(t.label) +
									'</span><span class="num bright">' +
									(o.status === "running" ? "—" : ui.fmtMs(o.duration)) +
									'</span><span class="num">' +
									ui.fmtNum((o.tokIn || 0) + (o.tokOut || 0)) +
									"</span></div>"
								);
							})
							.join("")
					: emptyHTML(
							"No operations yet this session.<br>Activity appears here the moment the agent runs a tool.",
						),
			);

			// connection card
			const allHealth = eng.toolHealth();
			const online = allHealth.filter((h) => h.status !== "never").length;
			const dot = !running ? p.amber : working ? p.accent : p.faint;
			const label = !running ? "Paused" : working ? "Working" : "Standby";
			refs.connMeta.textContent = eng.model || "—";
			refs.connBody.innerHTML =
				'<div class="ops-conn-status"><span class="status-dot" style="background:' +
				dot +
				(working ? ";box-shadow:0 0 8px " + p.accent : "") +
				'"></span><span class="big" style="color:' +
				(working ? p.ink : p.faint) +
				'">' +
				label +
				'</span><span class="cright">' +
				(working ? act.inFlight + " in flight" : "idle " + ui.fmtSince(act.since)) +
				"</span></div>" +
				'<div class="ops-conn-grid">' +
				connCell("Session uptime", ui.fmtClock(sess.durationMs)) +
				connCell("Last activity", ui.fmtSince(now - act.lastActivityAt), true) +
				connCell("Ops / min", sess.opsPerMin.toFixed(0)) +
				connCell("Tools online", online + '<small> / ' + allHealth.length + "</small>") +
				"</div>";

			// tool health board
			const order = { live: 0, degraded: 1, error: 1, idle: 2, never: 3 };
			const agentT = allHealth.filter((h) => h.group === "agent").sort((a, b) => order[a.status] - order[b.status]);
			const mcpT = allHealth.filter((h) => h.group === "mcp").sort((a, b) => order[a.status] - order[b.status]);
			const liveN = allHealth.filter((h) => h.status === "live").length;
			const degN = allHealth.filter((h) => h.status === "degraded" || h.status === "error").length;
			refs.healthMeta.innerHTML =
				'<span style="color:' + p.accent + '">' + liveN + " live</span>" +
				(degN ? '<span style="color:' + p.amber + '"> · ' + degN + " degraded</span>" : "");
			setScroll(
				refs.healthBody,
				(allHealth.length
					? '<div class="ops-group-hd">Built-in tools</div>' +
						(agentT.map((h) => healthRow(h, now)).join("") || emptyRow()) +
						'<div class="ops-group-hd">MCP servers</div>' +
						(mcpT.map((h) => healthRow(h, now)).join("") || emptyRow())
					: emptyHTML("No tools registered.")),
			);

			// session recap
			const ts = eng.tasks();
			const current = ts.filter((t) => t.status === "running");
			const feature = current[0] || ts.find((t) => t.status === "done");
			refs.recapMeta.textContent = sess.tasksDone + " done";
			setScroll(
				refs.recapBody,
				(feature
					? '<div class="ops-sub-hd">' + (current.length ? "In progress" : "Last sub-agent task") + "</div>" + recapCard(feature, now)
					: '<div class="ops-sub-hd">Sub-agent tasks</div>' + emptyHTML("No sub-agent tasks yet this session.")) +
					(ts.length
						? '<div class="ops-sub-hd" style="margin-top:6px">Recent tasks</div><div class="ops-tasklist">' +
							ts
								.slice(0, 7)
								.map((t) => {
									const ms = (t.endedAt || now) - t.startedAt;
									const led = t.status === "running" ? p.cyan : t.errCount ? p.amber : p.accent;
									return (
										'<div class="ops-task-row"><span class="led" style="background:' +
										led +
										'"></span><span class="nm">' +
										ui.esc(t.label) +
										'</span><span class="meta">' +
										(t.status === "running" ? "running · " + t.opCount + " ops" : ui.fmtDur(ms) + " · " + t.opCount + " ops") +
										"</span></div>"
									);
								})
								.join("") +
							"</div>"
						: ""),
			);

			// redraw KPI sparklines
			drawSpark("tps", okSpark);
			drawSpark("err", errSpark);
			drawSpark("p95", latSpark);
		}

		function setKpi(id, value, footHTML, sparkVals) {
			const r = refs.kpi[id];
			if (!r) return;
			r.v.innerHTML = value;
			r.foot.innerHTML = footHTML || "";
			r._spark = sparkVals;
		}
		function drawSpark(id, vals) {
			const r = refs.kpi[id];
			if (r && r.spark) charts.sparkline(r.spark, vals, { color: r.sparkColor, w: 58, h: 22 });
		}
		function connCell(k, v, noBorder) {
			return (
				'<div class="ops-conn-cell"' +
				(noBorder ? "" : "") +
				'><div class="k">' +
				k +
				'</div><div class="v">' +
				v +
				"</div></div>"
			);
		}
		function healthRow(h, now) {
			const st = h.status === "live" ? "Live" : h.status === "degraded" ? "Degraded" : h.status === "idle" ? "Idle" : h.status === "error" ? "Error" : "No calls";
			const led = ui.statusLed(h.status);
			return (
				'<div class="ops-health-row"><span class="led" style="background:' +
				led +
				'"></span><div class="health-main"><div class="nm"><span class="sw" style="background:' +
				h.tool.color +
				'"></span>' +
				ui.esc(h.tool.label) +
				'<span class="tag">' +
				h.group +
				'</span></div><div class="sub"><span><b>' +
				ui.fmtNum(h.opsTotal) +
				"</b> ops</span><span>err <b>" +
				ui.fmtPct(h.errorRate) +
				"</b></span><span>" +
				(h.status === "never" ? "never used" : ui.fmtSince(now - h.lastSeenAt)) +
				'</span></div></div><span class="st ' +
				h.status +
				'">' +
				st +
				"</span></div>"
			);
		}
		function recapCard(t, now) {
			const ms = (t.endedAt || now) - t.startedAt;
			const running = t.status === "running";
			const toolChips = [...t.tools]
				.map((id) => {
					const tt = eng.toolById(id) || { label: id, color: "#888" };
					return '<span class="chip"><span class="sw" style="background:' + tt.color + '"></span>' + ui.esc(tt.label) + "</span>";
				})
				.join("");
			return (
				'<div class="ops-recap-task"><div class="top"><span class="nm">' +
				ui.esc(t.label) +
				'</span><span class="badge ' +
				(running ? "running" : "done") +
				'">' +
				(running ? "running" : "completed") +
				'</span></div><div class="recap-stats">' +
				rc("ops", t.opCount) +
				rc("errors", t.errCount) +
				rc("tokens", ui.fmtNum(t.tokIn + t.tokOut)) +
				rc(running ? "elapsed" : "took", ui.fmtDur(ms)) +
				'</div><div class="recap-tools">' +
				toolChips +
				"</div></div>"
			);
		}
		function rc(k, v) {
			return '<div class="c"><div class="k">' + k + '</div><div class="v tnum">' + v + "</div></div>";
		}
		function emptyHTML(msg) {
			return '<div class="ops-empty">' + msg + "</div>";
		}
		function emptyRow() {
			return '<div class="ops-empty" style="padding:10px 14px">none</div>';
		}

		eng.on("data", render);
		render();
		setInterval(render, 1000);
		return { render };
	}

	// build a small wrapper node from an HTML string (for inline-SVG icons in a flex parent)
	function frag(html) {
		const s = ui.el("span", { class: "ico", html });
		return s;
	}

	window.OpsDash = { mount };
})();
