/* ===========================================================================
   charts.js — canvas chart primitives for the Agent Operations dashboard
   (vanilla port of the design's charts.jsx). Sparkline · Throughput · Latency.
   Each takes a <canvas>, sizes it to its parent with devicePixelRatio, and reads
   theme colors from OpsUI.palette() so light/dark + brand --accent apply live.
   Exposed on window.OpsCharts.
   =========================================================================== */
(() => {
	const ui = window.OpsUI;
	const DPR = () => Math.min(2, window.devicePixelRatio || 1);

	function fit(canvas, fallbackW, fallbackH) {
		const dpr = DPR();
		const wrap = canvas.parentElement;
		const w = Math.round((wrap && wrap.clientWidth) || fallbackW || canvas.clientWidth || 0);
		const h = Math.round((wrap && wrap.clientHeight) || fallbackH || canvas.clientHeight || 0);
		if (!w || !h) return null;
		if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
			canvas.width = w * dpr;
			canvas.height = h * dpr;
		}
		const ctx = canvas.getContext("2d");
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		return { ctx, w, h };
	}

	/* ---- Sparkline: tiny line+area, fixed pixel size ---------------------- */
	function sparkline(canvas, values, opts) {
		opts = opts || {};
		const w = opts.w || 58;
		const h = opts.h || 22;
		const color = opts.color || ui.palette().accent;
		const fill = opts.fill !== false;
		const strokeW = opts.strokeW || 1.4;
		const dpr = DPR();
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		canvas.style.width = w + "px";
		canvas.style.height = h + "px";
		const ctx = canvas.getContext("2d");
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		const vals = values && values.length ? values : [0, 0];
		const max = Math.max(1, ...vals);
		const n = vals.length;
		const x = (i) => (n <= 1 ? 0 : (i / (n - 1)) * (w - 2) + 1);
		const y = (v) => h - 2 - (v / max) * (h - 4);
		if (fill) {
			ctx.beginPath();
			ctx.moveTo(x(0), h);
			vals.forEach((v, i) => ctx.lineTo(x(i), y(v)));
			ctx.lineTo(x(n - 1), h);
			ctx.closePath();
			const g = ctx.createLinearGradient(0, 0, 0, h);
			g.addColorStop(0, ui.hexA(color, 0.32));
			g.addColorStop(1, ui.hexA(color, 0));
			ctx.fillStyle = g;
			ctx.fill();
		}
		ctx.beginPath();
		vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
		ctx.strokeStyle = color;
		ctx.lineWidth = strokeW;
		ctx.lineJoin = "round";
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(x(n - 1), y(vals[n - 1]), 1.7, 0, Math.PI * 2);
		ctx.fillStyle = color;
		ctx.fill();
	}

	function timeAxis(ctx, padL, plotW, H, windowSec, faint) {
		ctx.fillStyle = faint;
		ctx.textAlign = "center";
		ctx.textBaseline = "alphabetic";
		[0, 0.5, 1].forEach((f) => {
			const a = Math.round((1 - f) * windowSec);
			ctx.fillText(a === 0 ? "now" : "-" + a + "s", padL + f * plotW, H - 4);
		});
	}

	/* ---- ThroughputChart: completed area + error bars + in-flight line ---- */
	function throughput(canvas, history, windowSec) {
		const r = fit(canvas, 320, 120);
		if (!r) return;
		const { ctx, w: W, h: H } = r;
		const p = ui.palette();
		const padB = 16;
		const padT = 6;
		const padL = 26;
		const plotW = W - padL;
		const plotH = H - padB - padT;
		const samples = history.slice(Math.max(0, history.length - windowSec));
		if (!samples.length) return;
		let max = 1;
		samples.forEach((s) => (max = Math.max(max, s.ok + s.err)));
		max = Math.ceil(max / 2) * 2 || 2;

		ctx.strokeStyle = p.grid;
		ctx.lineWidth = 1;
		ctx.fillStyle = p.faint;
		ctx.font = '9px "JetBrains Mono", monospace';
		ctx.textAlign = "right";
		ctx.textBaseline = "middle";
		const rows = 3;
		for (let g = 0; g <= rows; g++) {
			const y = padT + (g / rows) * plotH;
			ctx.beginPath();
			ctx.moveTo(padL, y);
			ctx.lineTo(W, y);
			ctx.stroke();
			ctx.fillText(String(Math.round(max * (1 - g / rows))), padL - 6, y);
		}

		const n = samples.length;
		const x = (i) => padL + (n <= 1 ? plotW : (i / (n - 1)) * plotW);
		const yBase = padT + plotH;
		const yFor = (v) => yBase - (v / max) * plotH;

		ctx.beginPath();
		ctx.moveTo(x(0), yBase);
		samples.forEach((s, i) => ctx.lineTo(x(i), yFor(s.ok + s.err)));
		ctx.lineTo(x(n - 1), yBase);
		ctx.closePath();
		const g = ctx.createLinearGradient(0, padT, 0, yBase);
		g.addColorStop(0, ui.hexA(p.accent, 0.34));
		g.addColorStop(1, ui.hexA(p.accent, 0.02));
		ctx.fillStyle = g;
		ctx.fill();

		ctx.beginPath();
		samples.forEach((s, i) =>
			i ? ctx.lineTo(x(i), yFor(s.ok + s.err)) : ctx.moveTo(x(i), yFor(s.ok + s.err)),
		);
		ctx.strokeStyle = p.accent;
		ctx.lineWidth = 1.5;
		ctx.lineJoin = "round";
		ctx.stroke();

		ctx.fillStyle = ui.hexA(p.red, 0.85);
		const bw = Math.max(1.5, plotW / n - 0.5);
		samples.forEach((s, i) => {
			if (!s.err) return;
			const eh = (s.err / max) * plotH;
			ctx.fillRect(x(i) - bw / 2, yBase - eh, bw, eh);
		});

		ctx.beginPath();
		ctx.setLineDash([3, 3]);
		samples.forEach((s, i) => {
			const y = yFor(Math.min(max, s.inFlight));
			return i ? ctx.lineTo(x(i), y) : ctx.moveTo(x(i), y);
		});
		ctx.strokeStyle = ui.hexA(p.cyan, 0.55);
		ctx.lineWidth = 1.1;
		ctx.stroke();
		ctx.setLineDash([]);

		timeAxis(ctx, padL, plotW, H, windowSec, p.faint);
	}

	/* ---- LatencyChart: p50 + p95 lines over history ---------------------- */
	function latency(canvas, history, windowSec) {
		const r = fit(canvas, 320, 120);
		if (!r) return;
		const { ctx, w: W, h: H } = r;
		const p = ui.palette();
		const padB = 16;
		const padT = 6;
		const padL = 34;
		const plotW = W - padL;
		const plotH = H - padB - padT;
		const samples = history.slice(Math.max(0, history.length - windowSec));
		if (!samples.length) return;
		let max = 200;
		samples.forEach((s) => (max = Math.max(max, s.p95)));
		max = Math.ceil(max / 200) * 200;

		ctx.strokeStyle = p.grid;
		ctx.lineWidth = 1;
		ctx.fillStyle = p.faint;
		ctx.font = '9px "JetBrains Mono", monospace';
		ctx.textAlign = "right";
		ctx.textBaseline = "middle";
		const rows = 3;
		for (let g = 0; g <= rows; g++) {
			const y = padT + (g / rows) * plotH;
			ctx.beginPath();
			ctx.moveTo(padL, y);
			ctx.lineTo(W, y);
			ctx.stroke();
			const val = Math.round(max * (1 - g / rows));
			ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + "s" : val + "ms", padL - 6, y);
		}

		const n = samples.length;
		const x = (i) => padL + (n <= 1 ? plotW : (i / (n - 1)) * plotW);
		const yBase = padT + plotH;
		const yFor = (v) => yBase - (Math.min(max, v) / max) * plotH;

		function plot(key, color, width, fillIt) {
			if (fillIt) {
				ctx.beginPath();
				let started = false;
				samples.forEach((s, i) => {
					if (s[key] <= 0) return;
					if (!started) {
						ctx.moveTo(x(i), yBase);
						started = true;
					}
					ctx.lineTo(x(i), yFor(s[key]));
				});
				for (let i = n - 1; i >= 0; i--) {
					if (samples[i][key] > 0) {
						ctx.lineTo(x(i), yBase);
						break;
					}
				}
				ctx.closePath();
				const grad = ctx.createLinearGradient(0, padT, 0, yBase);
				grad.addColorStop(0, ui.hexA(color, 0.18));
				grad.addColorStop(1, ui.hexA(color, 0));
				ctx.fillStyle = grad;
				ctx.fill();
			}
			ctx.beginPath();
			let pen = false;
			samples.forEach((s, i) => {
				if (s[key] <= 0) {
					pen = false;
					return;
				}
				if (!pen) {
					ctx.moveTo(x(i), yFor(s[key]));
					pen = true;
				} else ctx.lineTo(x(i), yFor(s[key]));
			});
			ctx.strokeStyle = color;
			ctx.lineWidth = width;
			ctx.lineJoin = "round";
			ctx.stroke();
		}
		plot("p95", p.amber, 1.5, true);
		plot("p50", p.accent, 1.5, false);

		timeAxis(ctx, padL, plotW, H, windowSec, p.faint);
	}

	window.OpsCharts = { sparkline, throughput, latency };
})();
