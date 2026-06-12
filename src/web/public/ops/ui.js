/* Agent Ops — shared UI kit (vanilla port of the design's ui.jsx).
   Formatting helpers, status colors, a tooltip singleton, tooltip HTML builders,
   and the mode glyphs as inline-SVG strings. Exposed on window.OpsUI. No React,
   no template-literal cooking (served as a real .js file from 'self'). */
(function () {
	"use strict";

	var COLORS = {
		green: "#3fe08f",
		greenSoft: "#2bbd78",
		cyan: "#45c8d8",
		amber: "#e6b248",
		red: "#e5604d",
		ink: "#d6ddd7",
		inkDim: "#7c887f",
		inkFaint: "#4a534c",
		line: "rgba(120,200,165,0.10)",
		line2: "rgba(120,200,165,0.18)",
		bg: "#050708",
		panel: "#0a0e0f",
	};

	function statusColor(s) {
		return s === "running" ? COLORS.cyan : s === "error" ? COLORS.red : COLORS.green;
	}

	function fmtNum(n) {
		if (n == null || isNaN(n)) return "0";
		if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
		return Math.round(n).toString();
	}
	function fmtMs(ms) {
		if (ms == null) return "—";
		if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
		return Math.round(ms) + "ms";
	}
	function fmtPct(x) {
		return (x * 100).toFixed(x >= 0.1 ? 0 : 1) + "%";
	}
	function fmtClock(ms) {
		var s = Math.floor(ms / 1000);
		var hh = String(Math.floor(s / 3600) % 24).padStart(2, "0");
		var mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
		var ss = String(s % 60).padStart(2, "0");
		return hh + ":" + mm + ":" + ss;
	}

	// Brand accent (hex) → rgba() for canvas fills; falls back to the design green.
	function hexToRgba(hex, a) {
		if (typeof hex !== "string") return "rgba(63,224,143," + a + ")";
		var h = hex.replace("#", "");
		if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
		var n = h.length >= 6 ? parseInt(h.slice(0, 6), 16) : NaN;
		if (isNaN(n)) return "rgba(63,224,143," + a + ")";
		return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
	}

	function esc(v) {
		return String(v == null ? "" : v)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	}

	/* Tooltip singleton — same behavior as the design's Tip. innerHTML is built
	   only from escaped values + our own markup (no raw user strings). */
	var Tip = (function () {
		var el = null;
		function ensure() {
			if (el) return el;
			el = document.createElement("div");
			el.className = "ops-tip";
			el.style.display = "none";
			document.body.appendChild(el);
			return el;
		}
		return {
			show: function (html, x, y) {
				var e = ensure();
				e.innerHTML = html;
				e.style.display = "block";
				var r = e.getBoundingClientRect();
				var nx = x + 16,
					ny = y + 16;
				if (nx + r.width > window.innerWidth - 8) nx = x - r.width - 16;
				if (ny + r.height > window.innerHeight - 8) ny = y - r.height - 16;
				e.style.left = nx + "px";
				e.style.top = ny + "px";
			},
			hide: function () {
				if (el) el.style.display = "none";
			},
		};
	})();

	function row(k, v, color) {
		var b = color ? '<b style="color:' + color + '">' + esc(v) + "</b>" : "<b>" + esc(v) + "</b>";
		return '<div class="tr"><span>' + esc(k) + "</span>" + b + "</div>";
	}

	function opTipHTML(o, engine) {
		var t = engine.TOOL_BY_ID[o.toolId] || { label: o.toolId };
		var st = o.status === "running" ? "running" : o.status === "error" ? "error" : "ok";
		return (
			'<div class="tt">' + esc(o.op) + "</div>" +
			row("tool", t.label) +
			row("status", st, statusColor(o.status)) +
			row("duration", fmtMs(o.duration)) +
			row("latency", o.latency == null ? "—" : o.latency + "ms") +
			row("tokens", fmtNum(o.tokIn) + " in · " + fmtNum(o.tokOut) + " out") +
			(o.args ? row("arg", o.args) : "") +
			(o.taskLabel ? row("task", o.taskLabel) : "")
		);
	}

	function toolTipHTML(s) {
		return (
			'<div class="tt">' + esc(s.tool.label) + "</div>" +
			row("throughput", s.tps.toFixed(1) + "/s") +
			row("active", s.active) +
			row("avg latency", Math.round(s.avgLatency) + "ms") +
			row("avg duration", fmtMs(s.avgDuration)) +
			row("errors", fmtPct(s.errorRate), s.errorRate > 0.04 ? COLORS.red : COLORS.ink)
		);
	}

	/* Mode glyphs — geometric inline SVGs (HTML strings). 22×22 in the rail. */
	function svg(inner) {
		return (
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" ' +
			'stroke-linecap="round" stroke-linejoin="round" class="glyph">' + inner + "</svg>"
		);
	}
	var MODE_GLYPHS = {
		swarm: svg(
			'<circle cx="12" cy="12" r="2.4"/><circle cx="5" cy="6" r="1.3"/>' +
			'<circle cx="19" cy="7" r="1.3"/><circle cx="6" cy="18" r="1.3"/>' +
			'<circle cx="18" cy="18" r="1.3"/><path d="M10 11 6 7M14 11 18 8M11 14 7 17M13 14 17 17" opacity="0.6"/>',
		),
		stream: svg(
			'<path d="M3 7h13M3 12h18M3 17h9"/>' +
			'<circle cx="19" cy="7" r="1.4" fill="currentColor" stroke="none"/>' +
			'<circle cx="14" cy="17" r="1.4" fill="currentColor" stroke="none"/>',
		),
		pipeline: svg(
			'<circle cx="4" cy="12" r="1.8"/><circle cx="12" cy="7" r="1.8"/>' +
			'<circle cx="12" cy="17" r="1.8"/><circle cx="20" cy="12" r="1.8"/>' +
			'<path d="M6 11 10 8M6 13 10 16M14 8 18 11M14 16 18 13" opacity="0.7"/>',
		),
		matrix: svg(
			'<rect x="3.5" y="3.5" width="5" height="5" rx="1"/>' +
			'<rect x="10" y="3.5" width="5" height="5" rx="1" opacity="0.5"/>' +
			'<rect x="16.5" y="3.5" width="4" height="5" rx="1"/>' +
			'<rect x="3.5" y="10" width="5" height="5" rx="1" opacity="0.5"/>' +
			'<rect x="10" y="10" width="5" height="5" rx="1"/>' +
			'<rect x="16.5" y="10" width="4" height="5" rx="1" opacity="0.5"/>' +
			'<rect x="3.5" y="16.5" width="5" height="4" rx="1"/>' +
			'<rect x="10" y="16.5" width="5" height="4" rx="1" opacity="0.5"/>',
		),
		radar: svg(
			'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5" opacity="0.5"/>' +
			'<path d="M12 12 19 8"/><circle cx="16" cy="9" r="1" fill="currentColor" stroke="none"/>',
		),
		pulse: svg('<path d="M3 12h3l2-6 3 12 3-9 2 5h5"/>'),
	};

	window.OpsUI = {
		COLORS: COLORS,
		statusColor: statusColor,
		fmtNum: fmtNum,
		fmtMs: fmtMs,
		fmtPct: fmtPct,
		fmtClock: fmtClock,
		hexToRgba: hexToRgba,
		esc: esc,
		Tip: Tip,
		opTipHTML: opTipHTML,
		toolTipHTML: toolTipHTML,
		MODE_GLYPHS: MODE_GLYPHS,
	};
})();
