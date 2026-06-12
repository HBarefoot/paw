/* Swarm lens — multi-agent network. The orchestrator (center) spawns a swarm of
   agents — one per live SUB-AGENT task (feed taskId !== 0). Each agent links to
   the skills it uses over COMPANION-STYLE TETHERS: orthogonal rounded-elbow
   routing (mirrors companion router.js orthPath) drawn as a dashed mint flow,
   with purple particles (#9b87f5) streaming along them. Agents bud in when
   spawned and dissolve with a burst when their task ends.

   Brand-green (#3fe08f) is routed through ctx.accent so a brand re-skins the
   core/command/agents + the mint tethers; the purple particle + the red error
   particle stay fixed (the companion's tether constants).

   ctx = { canvas, size:{w,h,dpr}, engine, ui, accent, state:{enabled:Set,
   viewTime, selectedId}, actions:{toggleTool(id), selectOp(op)} }. */
(function () {
	"use strict";

	function hex(c, a) {
		var n = parseInt(c.slice(1), 16);
		return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
	}
	var PARTICLE = "#9b87f5"; // companion tether particle (fixed, not brand-driven)
	var ELBOW_R = 12; // rounded-elbow radius (matches companion router.js)

	// Orthogonal connector waypoints — mirrors companion router.js `orthPath`:
	// dominant-axis H-V-H / V-H-V; near-aligned pairs collapse to a straight line.
	function orthWaypoints(sx, sy, ex, ey) {
		var dx = ex - sx,
			dy = ey - sy;
		if (Math.abs(dx) >= Math.abs(dy)) {
			if (Math.abs(dy) < 8) return [{ x: sx, y: sy }, { x: ex, y: ey }];
			var midX = (sx + ex) / 2;
			return [{ x: sx, y: sy }, { x: midX, y: sy }, { x: midX, y: ey }, { x: ex, y: ey }];
		}
		if (Math.abs(dx) < 8) return [{ x: sx, y: sy }, { x: ex, y: ey }];
		var midY = (sy + ey) / 2;
		return [{ x: sx, y: sy }, { x: sx, y: midY }, { x: ex, y: midY }, { x: ex, y: ey }];
	}
	// Trace an orthogonal polyline with rounded elbows (arcTo ≈ the companion's
	// quadratic elbow).
	function tracePath(g, pts, r) {
		g.beginPath();
		g.moveTo(pts[0].x, pts[0].y);
		for (var i = 1; i < pts.length - 1; i++) {
			g.arcTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, r);
		}
		g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
	}
	// Point at fraction t∈[0,1] along the polyline (cumulative-length walk) — so a
	// particle can flow the tether the same way <animateMotion> walks the SVG path.
	function ptAt(pts, t) {
		if (!pts.length) return { x: 0, y: 0 };
		if (pts.length < 2) return pts[0];
		var segs = [],
			total = 0;
		for (var i = 0; i < pts.length - 1; i++) {
			var L = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
			segs.push(L);
			total += L;
		}
		if (total === 0) return pts[0];
		var d = Math.max(0, Math.min(1, t)) * total;
		for (var j = 0; j < segs.length; j++) {
			if (d <= segs[j] || j === segs.length - 1) {
				var f = segs[j] ? d / segs[j] : 0;
				return {
					x: pts[j].x + (pts[j + 1].x - pts[j].x) * f,
					y: pts[j].y + (pts[j + 1].y - pts[j].y) * f,
				};
			}
			d -= segs[j];
		}
		return pts[pts.length - 1];
	}
	// A dashed mint orthogonal tether (companion .tether-line / .agent-link).
	function tether(g, sx, sy, ex, ey, kind, active, T, alpha, accent, ui) {
		var pts = orthWaypoints(sx, sy, ex, ey);
		var w = kind === "skill" ? 1.6 : 1.4;
		var aDash = kind === "skill" ? 0.5 : active ? 0.55 : 0.22;
		// faint under-glow for legibility on the dark bg
		tracePath(g, pts, ELBOW_R);
		g.setLineDash([]);
		g.lineWidth = w + 5;
		g.strokeStyle = ui.hexToRgba(accent, 0.05 * alpha);
		g.stroke();
		// the dashed mint flow
		tracePath(g, pts, ELBOW_R);
		g.setLineDash([7, 7]);
		g.lineDashOffset = -((T * 0.03) % 14);
		g.lineWidth = w;
		g.strokeStyle = ui.hexToRgba(accent, aDash * alpha);
		g.stroke();
		g.setLineDash([]);
		return pts;
	}
	// A glowing particle (+ short tail) at fraction p along the tether polyline.
	function particle(g, pts, p, color, sizeMul, alpha) {
		var tailN = 4;
		for (var k = tailN; k > 0; k--) {
			var a = ptAt(pts, p - k * 0.05),
				b = ptAt(pts, p - (k - 1) * 0.05);
			g.globalAlpha = (1 - k / tailN) * 0.5 * alpha;
			g.lineWidth = (1 - k / tailN) * 1.8 + 0.4;
			g.strokeStyle = color;
			g.beginPath();
			g.moveTo(a.x, a.y);
			g.lineTo(b.x, b.y);
			g.stroke();
		}
		var hd = ptAt(pts, p);
		g.globalAlpha = Math.min(1, alpha);
		g.shadowColor = color;
		g.shadowBlur = 6 * sizeMul;
		g.beginPath();
		g.arc(hd.x, hd.y, 1.9 * sizeMul, 0, 7);
		g.fillStyle = color;
		g.fill();
		g.shadowBlur = 0;
		g.globalAlpha = 1;
	}

	window.VizSwarm = function (ctx) {
		var engine = ctx.engine,
			ui = ctx.ui;
		var skills = [];
		var idx = {};
		var lastW = 0,
			lastH = 0;
		var hits = [];
		var hover = null;

		function layout(w, h) {
			var cx = w / 2,
				cy = h / 2 + 8;
			var R = Math.min(w, h) * 0.4;
			var tools = engine.TOOLS;
			var N = tools.length;
			skills = tools.map(function (t, i) {
				var a = -Math.PI / 2 + (i / N) * Math.PI * 2;
				return { id: t.id, tool: t, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, a: a, cx: cx, cy: cy };
			});
			idx = {};
			tools.forEach(function (t, i) {
				idx[t.id] = i;
			});
			lastW = w;
			lastH = h;
		}

		function frame() {
			var c = ctx.canvas;
			if (!c) return;
			var size = ctx.size,
				w = size.w,
				h = size.h,
				dpr = size.dpr;
			if (!w || !h) return;
			var g = c.getContext("2d");
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			g.clearRect(0, 0, w, h);
			if (w !== lastW || h !== lastH || skills.length !== engine.TOOLS.length) layout(w, h);
			if (!skills.length) return;

			var accent = ctx.accent || "#3fe08f";
			var cx = skills[0].cx,
				cy = skills[0].cy;
			var vt = ctx.state.viewTime;
			var now = vt === "live" ? engine.simNow : vt;
			var T = now;
			var coreX = cx,
				coreY = cy;
			var Rmid = Math.min(w, h) * 0.185;
			var enabled = ctx.state.enabled;
			hits = [];

			// ---- build the swarm: one agent per recent sub-agent task ----
			var tasks = new Map();
			var ops = engine.ops;
			for (var i = ops.length - 1; i >= 0; i--) {
				var o = ops[i];
				if (o.startedAt < now - 14000 && o.status !== "running") break;
				if (!o.taskId) continue;
				var t = tasks.get(o.taskId);
				if (!t) {
					t = { id: o.taskId, label: o.taskLabel, ops: [], first: o.startedAt, last: 0, running: false };
					tasks.set(o.taskId, t);
				}
				t.ops.push(o);
				t.first = Math.min(t.first, o.startedAt);
				t.last = Math.max(t.last, o.status === "running" ? now : o.endAt);
				if (o.status === "running") t.running = true;
			}
			var FADE = 1600;
			var agents = [];
			tasks.forEach(function (t) {
				if (!t.running && now - t.last > FADE) return;
				var spawnK = Math.min(1, (now - t.first) / 420);
				var dieK = t.running ? 0 : Math.min(1, (now - t.last) / FADE);
				var alpha = spawnK * (1 - dieK);
				if (alpha <= 0.02) return;
				var ang = (t.id * 2.399963) % (Math.PI * 2);
				var wob = Math.sin(T * 0.0008 + t.id) * 7;
				var r = (Rmid + ((t.id * 37) % 26) + wob) * (0.4 + 0.6 * (1 - Math.pow(1 - spawnK, 2)));
				var x = coreX + Math.cos(ang) * r,
					y = coreY + Math.sin(ang) * r;
				var traffic = {};
				var active = 0;
				t.ops.forEach(function (o2) {
					var run = o2.status === "running";
					if (run) active++;
					if (run || o2.endAt > now - 6000) traffic[o2.toolId] = (traffic[o2.toolId] || 0) + (run ? 1.6 : 0.5);
				});
				agents.push({ t: t, x: x, y: y, alpha: alpha, active: active, traffic: traffic });
			});

			// ---- pass 1: tethers (core->agent command, agent->skill) ----
			agents.forEach(function (ag) {
				tether(g, coreX, coreY, ag.x, ag.y, "command", ag.active > 0, T, ag.alpha * 0.85, accent, ui);
				Object.keys(ag.traffic).forEach(function (toolId) {
					if (!enabled.has(toolId)) return;
					var sk = skills[idx[toolId]];
					if (!sk) return;
					tether(g, ag.x, ag.y, sk.x, sk.y, "skill", true, T, ag.alpha, accent, ui);
				});
			});

			// ---- pass 2: purple particles flowing along the tethers ----
			agents.forEach(function (ag) {
				Object.keys(ag.traffic).forEach(function (toolId) {
					if (!enabled.has(toolId)) return;
					var sk = skills[idx[toolId]];
					if (!sk) return;
					var pts = orthWaypoints(ag.x, ag.y, sk.x, sk.y);
					var n = Math.min(5, Math.ceil(ag.traffic[toolId]));
					for (var iO = 0; iO < n; iO++) {
						var pO = ((T / 1500) + iO / n + ag.t.id * 0.13) % 1;
						particle(g, pts, pO, PARTICLE, 0.8, 0.5 * ag.alpha);
					}
				});
				ag.t.ops.forEach(function (o3) {
					if (!enabled.has(o3.toolId)) return;
					var sk = skills[idx[o3.toolId]];
					if (!sk) return;
					var opts = orthWaypoints(ag.x, ag.y, sk.x, sk.y);
					if (o3.status === "running") {
						var p = Math.max(0, Math.min(1, (now - o3.startedAt) / Math.max(1, o3.duration)));
						particle(g, opts, p, PARTICLE, 1.3, ag.alpha);
					} else if (now - o3.endAt < 650) {
						var p2 = (now - o3.endAt) / 650;
						particle(g, opts, p2, o3.status === "error" ? ui.COLORS.red : PARTICLE, 1.15, ag.alpha);
					}
				});
			});

			// ---- core glow ----
			var coreActive = Math.min(1, agents.reduce(function (s, a) { return s + a.active; }, 0) / 12);
			var breathe = 1 + 0.05 * Math.sin(T * 0.002);
			var gr = g.createRadialGradient(coreX, coreY, 4, coreX, coreY, (95 + coreActive * 60) * breathe);
			gr.addColorStop(0, ui.hexToRgba(accent, 0.24 + coreActive * 0.22));
			gr.addColorStop(0.45, ui.hexToRgba(accent, 0.08 + coreActive * 0.1));
			gr.addColorStop(1, ui.hexToRgba(accent, 0));
			g.fillStyle = gr;
			g.beginPath();
			g.arc(coreX, coreY, 180, 0, 7);
			g.fill();

			// ---- agents (swarm) ----
			agents.forEach(function (ag) {
				var rr = 4.5 + Math.min(4, ag.active * 0.9);
				var hov = hover === "a" + ag.t.id;
				g.globalAlpha = ag.alpha;
				if (ag.active) {
					var pulse = 1 + 0.2 * Math.sin(T * 0.005 + ag.t.id);
					g.beginPath();
					g.arc(ag.x, ag.y, (rr + 5) * pulse, 0, 7);
					g.fillStyle = "rgba(159,240,198,0.10)";
					g.fill();
				}
				if (!ag.t.running) {
					var k = Math.min(1, (now - ag.t.last) / FADE);
					g.beginPath();
					g.arc(ag.x, ag.y, rr + k * 22, 0, 7);
					g.strokeStyle = "rgba(159,240,198," + (1 - k) * 0.35 + ")";
					g.lineWidth = 1.2;
					g.stroke();
				}
				g.beginPath();
				g.arc(ag.x, ag.y, rr, 0, 7);
				g.fillStyle = "#0b1410";
				g.fill();
				g.lineWidth = hov ? 2 : 1.3;
				g.strokeStyle = hov ? "#eef4ef" : "#9ff0c6";
				g.stroke();
				g.beginPath();
				g.arc(ag.x, ag.y, 1.6, 0, 7);
				g.fillStyle = "#9ff0c6";
				g.fill();
				g.fillStyle = "rgba(159,240,198,0.75)";
				g.font = "9px 'JetBrains Mono', monospace";
				g.textAlign = "center";
				g.textBaseline = "top";
				g.fillText("a·" + String(ag.t.id).padStart(3, "0"), ag.x, ag.y + rr + 4);
				g.globalAlpha = 1;
				hits.push({ kind: "agent", x: ag.x, y: ag.y, r: rr + 8, ag: ag });
			});

			// ---- skills (outer ring) ----
			skills.forEach(function (sk) {
				var on = enabled.has(sk.id);
				var s = engine.windowStats(sk.id);
				var rr = 5 + Math.min(9, s.tps * 2);
				var hov = hover === "s" + sk.id;
				g.globalAlpha = on ? 1 : 0.26;
				if (on && s.active) {
					g.beginPath();
					g.arc(sk.x, sk.y, rr + 6, 0, 7);
					g.fillStyle = hex(sk.tool.color, 0.12);
					g.fill();
				}
				g.beginPath();
				g.arc(sk.x, sk.y, rr, 0, 7);
				g.fillStyle = sk.tool.color;
				g.fill();
				if (hov) {
					g.lineWidth = 1.5;
					g.strokeStyle = "#eef4ef";
					g.stroke();
				}
				g.fillStyle = on ? "#c8d0c9" : "#5a635c";
				g.font = "11px 'JetBrains Mono', monospace";
				var lx = sk.x + Math.cos(sk.a) * (rr + 12),
					ly = sk.y + Math.sin(sk.a) * (rr + 12);
				g.textAlign = Math.cos(sk.a) > 0.25 ? "left" : Math.cos(sk.a) < -0.25 ? "right" : "center";
				g.textBaseline = "middle";
				g.fillText(sk.tool.label, lx, ly);
				g.globalAlpha = 1;
				hits.push({ kind: "skill", x: sk.x, y: sk.y, r: Math.max(16, rr + 6), sk: sk });
			});

			// ---- orchestrator core ----
			g.beginPath();
			g.arc(coreX, coreY, 16, 0, 7);
			g.fillStyle = "#070b0c";
			g.fill();
			g.lineWidth = 1;
			g.strokeStyle = ui.hexToRgba(accent, 0.45);
			g.stroke();
			g.fillStyle = "#0f1514";
			g.beginPath();
			g.arc(coreX - 4, coreY, 2.2, 0, 7);
			g.fill();
			g.beginPath();
			g.arc(coreX + 4, coreY, 2.2, 0, 7);
			g.fill();
			g.fillStyle = "#c8d0c9";
			g.font = "600 11px 'JetBrains Mono', monospace";
			g.textAlign = "center";
			g.textBaseline = "top";
			g.fillText(engine.model || "orchestrator", coreX, coreY + 24);
			g.fillStyle = "#7c887f";
			g.font = "9.5px 'JetBrains Mono', monospace";
			var swarmN = agents.filter(function (a) { return a.t.running; }).length;
			g.fillText(swarmN + " agents in swarm", coreX, coreY + 38);
		}

		function hit(e) {
			var rect = ctx.canvas.getBoundingClientRect();
			var x = e.clientX - rect.left,
				y = e.clientY - rect.top;
			var best = null,
				bd = 1e9;
			hits.forEach(function (hh) {
				var d = Math.hypot(hh.x - x, hh.y - y);
				if (d < hh.r && d < bd) {
					bd = d;
					best = hh;
				}
			});
			return best;
		}
		function agentTip(ag) {
			var el = (ag.t.last > ag.t.first ? ag.t.last : engine.simNow) - ag.t.first;
			return (
				'<div class="tt">agent·' + String(ag.t.id).padStart(3, "0") + "</div>" +
				'<div class="tr"><span>mission</span><b>' + ui.esc(ag.t.label || "sub-agent") + "</b></div>" +
				'<div class="tr"><span>status</span><b style="color:' + (ag.t.running ? "#45c8d8" : "#3fe08f") + '">' +
				(ag.t.running ? "working" : "complete") + "</b></div>" +
				'<div class="tr"><span>operations</span><b>' + ag.t.ops.length + "</b></div>" +
				'<div class="tr"><span>elapsed</span><b>' + ui.fmtMs(el) + "</b></div>"
			);
		}
		function onMove(e) {
			var hh = hit(e);
			if (hh && hh.kind === "agent") {
				hover = "a" + hh.ag.t.id;
				ui.Tip.show(agentTip(hh.ag), e.clientX, e.clientY);
				ctx.canvas.style.cursor = "pointer";
			} else if (hh && hh.kind === "skill") {
				hover = "s" + hh.sk.id;
				var s = engine.windowStats(hh.sk.id);
				s.tool = hh.sk.tool;
				ui.Tip.show(ui.toolTipHTML(s), e.clientX, e.clientY);
				ctx.canvas.style.cursor = "pointer";
			} else {
				hover = null;
				ui.Tip.hide();
				ctx.canvas.style.cursor = "default";
			}
		}
		function onClick(e) {
			var hh = hit(e);
			if (!hh) return;
			if (hh.kind === "skill") ctx.actions.toggleTool(hh.sk.id);
			else if (hh.kind === "agent") {
				var latest = hh.ag.t.ops[hh.ag.t.ops.length - 1];
				if (latest) ctx.actions.selectOp(latest);
			}
		}
		function onLeave() {
			ui.Tip.hide();
			hover = null;
		}

		return { frame: frame, onMove: onMove, onClick: onClick, onLeave: onLeave };
	};
	window.VizSwarm._route = orthWaypoints; // exposed for unit tests
})();
