/* Stream lens — swimlane operation flow. One lane per tool; every op is a bar on
   a moving time axis (now at right), width = real duration, running ops grow at
   the leading edge. Scrub-aware. Vanilla port of the design's viz-stream.jsx
   (canvas drawing kept faithful; React props → a lens factory over `ctx`).

   ctx = { canvas, size:{w,h,dpr}, engine, ui, state:{enabled:Set, viewTime,
   selectedId}, actions:{toggleTool(id), selectOp(op)} }. */
(function () {
	"use strict";

	var GUT = 104,
		PAD_T = 14,
		PAD_B = 12,
		WINDOW = 22000;

	function roundRect(ctx, x, y, w2, h2, r2) {
		r2 = Math.min(r2, h2 / 2, w2 / 2);
		ctx.beginPath();
		ctx.moveTo(x + r2, y);
		ctx.arcTo(x + w2, y, x + w2, y + h2, r2);
		ctx.arcTo(x + w2, y + h2, x, y + h2, r2);
		ctx.arcTo(x, y + h2, x, y, r2);
		ctx.arcTo(x, y, x + w2, y, r2);
		ctx.closePath();
	}

	window.VizStream = function (ctx) {
		var engine = ctx.engine,
			ui = ctx.ui;
		var bars = [];
		var hoverId = null;

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

			var tools = engine.TOOLS;
			if (!tools.length) return;
			var laneH = (h - PAD_T - PAD_B) / tools.length;
			var plotW = w - GUT - 18;
			var vt = ctx.state.viewTime;
			var nowRef = vt === "live" ? engine.simNow : vt;
			var t0 = nowRef - WINDOW;
			var X = function (t) {
				return GUT + ((t - t0) / WINDOW) * plotW;
			};
			var enabled = ctx.state.enabled;

			// grid: vertical time ticks every 5s
			g.font = "9px 'JetBrains Mono', monospace";
			g.textBaseline = "alphabetic";
			for (var s = Math.ceil(t0 / 5000) * 5000; s <= nowRef; s += 5000) {
				var gx = X(s);
				g.strokeStyle = "rgba(120,200,165,0.05)";
				g.lineWidth = 1;
				g.beginPath();
				g.moveTo(gx, PAD_T);
				g.lineTo(gx, h - PAD_B);
				g.stroke();
				g.fillStyle = "#4a534c";
				g.textAlign = "center";
				g.fillText("-" + Math.round((nowRef - s) / 1000) + "s", gx, h - 2);
			}

			// lanes: separator + gutter label
			for (var i = 0; i < tools.length; i++) {
				var t = tools[i];
				var on = enabled.has(t.id);
				var y0 = PAD_T + i * laneH;
				var cy = y0 + laneH / 2;
				g.strokeStyle = "rgba(120,200,165,0.05)";
				g.lineWidth = 1;
				g.beginPath();
				g.moveTo(0, y0 + laneH);
				g.lineTo(w, y0 + laneH);
				g.stroke();
				g.globalAlpha = on ? 1 : 0.32;
				g.beginPath();
				g.arc(14, cy, 3, 0, 7);
				g.fillStyle = t.color;
				g.fill();
				g.fillStyle = on ? "#c8d0c9" : "#5a635c";
				g.font = "10.5px 'JetBrains Mono', monospace";
				g.textAlign = "left";
				g.textBaseline = "middle";
				g.fillText(t.label, 24, cy);
				g.globalAlpha = 1;
			}

			// bars
			bars = [];
			var list = engine.ops;
			var selId = ctx.state.selectedId;
			for (var k = list.length - 1; k >= 0; k--) {
				var o = list[k];
				var end = o.status === "running" ? Math.min(nowRef, o.endAt) : o.endAt;
				if (end < t0 || o.startedAt > nowRef) continue;
				var li = -1;
				for (var ti = 0; ti < tools.length; ti++) {
					if (tools[ti].id === o.toolId) {
						li = ti;
						break;
					}
				}
				if (li < 0) continue;
				var onb = enabled.has(o.toolId);
				var by0 = PAD_T + li * laneH;
				var bh = Math.min(15, laneH - 7);
				var by = by0 + (laneH - bh) / 2;
				var x1 = X(Math.max(o.startedAt, t0)),
					x2 = X(Math.min(end, nowRef));
				var bw = Math.max(3, x2 - x1);
				var tool = engine.TOOL_BY_ID[o.toolId] || { color: "#3fe08f" };
				var sel = o.id === selId,
					hov = o.id === hoverId;
				var fade = onb ? Math.max(0.25, 1 - ((nowRef - end) / WINDOW) * 0.7) : 0.12;
				g.globalAlpha = fade;
				if (o.status === "error") {
					g.fillStyle = "rgba(229,96,77,0.22)";
					roundRect(g, x1, by, bw, bh, 3);
					g.fill();
					g.strokeStyle = "#e5604d";
					g.lineWidth = 1;
					roundRect(g, x1, by, bw, bh, 3);
					g.stroke();
				} else {
					g.fillStyle = tool.color;
					roundRect(g, x1, by, bw, bh, 3);
					g.fill();
					if (o.status === "running") {
						g.fillStyle = "#eef4ef";
						g.globalAlpha = fade;
						g.fillRect(x2 - 2, by, 2, bh);
					}
				}
				if (sel || hov) {
					g.globalAlpha = 1;
					g.strokeStyle = "#eef4ef";
					g.lineWidth = sel ? 1.5 : 1;
					roundRect(g, x1, by, bw, bh, 3);
					g.stroke();
				}
				g.globalAlpha = 1;
				if (bw > 54 && onb) {
					g.fillStyle = o.status === "error" ? "#e5604d" : "#06100b";
					g.font = "9.5px 'JetBrains Mono', monospace";
					g.textAlign = "left";
					g.textBaseline = "middle";
					g.save();
					g.beginPath();
					g.rect(x1, by, bw, bh);
					g.clip();
					g.fillText(o.op, x1 + 5, by + bh / 2 + 0.5);
					g.restore();
				}
				bars.push({ x: x1, y: by, w: bw, h: bh, o: o });
			}

			// now line
			var nx = X(nowRef);
			g.strokeStyle = vt === "live" ? "rgba(63,224,143,0.5)" : "rgba(230,178,72,0.6)";
			g.lineWidth = 1.5;
			g.beginPath();
			g.moveTo(nx, PAD_T - 4);
			g.lineTo(nx, h - PAD_B);
			g.stroke();
		}

		function hitTest(e) {
			var rect = ctx.canvas.getBoundingClientRect();
			var x = e.clientX - rect.left,
				y = e.clientY - rect.top;
			for (var i = 0; i < bars.length; i++) {
				var b = bars[i];
				if (x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2)
					return b.o;
			}
			if (x < GUT) {
				var tools = engine.TOOLS;
				var size = ctx.size;
				var idx = Math.floor((y - PAD_T) / ((size.h - PAD_T - PAD_B) / tools.length));
				if (idx >= 0 && idx < tools.length) return { _tool: tools[idx].id };
			}
			return null;
		}

		function onMove(e) {
			var o = hitTest(e);
			if (o && !o._tool) {
				hoverId = o.id;
				ui.Tip.show(ui.opTipHTML(o, engine), e.clientX, e.clientY);
				ctx.canvas.style.cursor = "pointer";
			} else {
				hoverId = null;
				ui.Tip.hide();
				ctx.canvas.style.cursor = o && o._tool ? "pointer" : "default";
			}
		}
		function onClick(e) {
			var o = hitTest(e);
			if (!o) return;
			if (o._tool) ctx.actions.toggleTool(o._tool);
			else ctx.actions.selectOp(o);
		}
		function onLeave() {
			ui.Tip.hide();
			hoverId = null;
		}

		return { frame: frame, onMove: onMove, onClick: onClick, onLeave: onLeave };
	};
})();
