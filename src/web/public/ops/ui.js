/* ===========================================================================
   ui.js — Agent Operations shared kit (vanilla). Formatting, theme-aware
   palette (reads CSS vars so light/dark + brand --accent flow through),
   a tooltip singleton, tooltip HTML, header icons, and tiny DOM helpers.
   Exposed on window.OpsUI. No React, no template-literal cooking traps.
   =========================================================================== */
(() => {
	// --- formatting ----------------------------------------------------------
	function fmtNum(n) {
		if (n == null || Number.isNaN(n)) return "0";
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
		const s = Math.floor(ms / 1000);
		const hh = String(Math.floor(s / 3600)).padStart(2, "0");
		const mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
		const ss = String(s % 60).padStart(2, "0");
		return hh + ":" + mm + ":" + ss;
	}
	function fmtCost(usd) {
		if (usd == null || Number.isNaN(usd)) return "$0.00";
		return "$" + (usd >= 1 ? usd.toFixed(2) : usd.toFixed(3));
	}
	function fmtDur(ms) {
		const s = Math.floor(ms / 1000);
		if (s < 60) return s + "s";
		const m = Math.floor(s / 60);
		if (m < 60) return m + "m " + (s % 60) + "s";
		return Math.floor(m / 60) + "h " + (m % 60) + "m";
	}
	function fmtSince(ms) {
		if (ms < 0 || !Number.isFinite(ms)) return "—";
		if (ms < 1500) return "just now";
		if (ms < 60000) return Math.round(ms / 1000) + "s ago";
		return Math.floor(ms / 60000) + "m ago";
	}
	function agoMs(now, t) {
		const d = now - t;
		if (d < 1000) return Math.max(0, Math.round(d)) + "ms";
		return (d / 1000).toFixed(1) + "s";
	}

	// --- theme-aware palette (CSS vars → canvas colors) ----------------------
	function cssVar(name, fallback) {
		try {
			const v = getComputedStyle(document.documentElement)
				.getPropertyValue(name)
				.trim();
			return v || fallback;
		} catch (_e) {
			return fallback;
		}
	}
	// Fixed semantic colors; accent + ink/grid resolve from the active theme.
	const FIXED = { cyan: "#45c8d8", amber: "#e6b248", red: "#e5604d" };
	function palette() {
		return {
			accent: cssVar("--accent", "#3fe08f"),
			ink: cssVar("--ops-ink", "#d6ddd7"),
			faint: cssVar("--ops-faint", "#4a534c"),
			grid: cssVar("--ops-grid", "rgba(120,200,165,0.08)"),
			cyan: FIXED.cyan,
			amber: FIXED.amber,
			red: FIXED.red,
		};
	}
	function statusColor(s) {
		return s === "running"
			? FIXED.cyan
			: s === "error"
				? FIXED.red
				: cssVar("--accent", "#3fe08f");
	}
	function statusLed(status) {
		const p = palette();
		return status === "live"
			? p.accent
			: status === "degraded"
				? p.amber
				: status === "error"
					? p.red
					: status === "idle"
						? p.faint
						: p.faint;
	}
	function hexA(hex, a) {
		if (!hex || hex[0] !== "#") return hex;
		let h = hex.slice(1);
		if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
		const r = parseInt(h.slice(0, 2), 16);
		const g = parseInt(h.slice(2, 4), 16);
		const b = parseInt(h.slice(4, 6), 16);
		return "rgba(" + r + "," + g + "," + b + "," + a + ")";
	}

	// --- tiny DOM helpers ----------------------------------------------------
	function esc(s) {
		return String(s == null ? "" : s)
			.split("&")
			.join("&amp;")
			.split("<")
			.join("&lt;")
			.split(">")
			.join("&gt;");
	}
	function el(tag, attrs, children) {
		const n = document.createElement(tag);
		if (attrs)
			for (const k in attrs) {
				const v = attrs[k];
				if (v == null || v === false) continue;
				if (k === "class") n.className = v;
				else if (k === "text") n.textContent = v;
				else if (k === "html") n.innerHTML = v;
				else if (k === "style") n.setAttribute("style", v);
				else if (k.indexOf("on") === 0 && typeof v === "function")
					n.addEventListener(k.slice(2), v);
				else n.setAttribute(k, v);
			}
		if (children != null) {
			const arr = Array.isArray(children) ? children : [children];
			for (const ch of arr) {
				if (ch == null || ch === false) continue;
				n.appendChild(typeof ch === "string" ? document.createTextNode(ch) : ch);
			}
		}
		return n;
	}

	// --- tooltip singleton ---------------------------------------------------
	const Tip = (() => {
		let node = null;
		function ensure() {
			if (node) return node;
			node = document.createElement("div");
			node.className = "ops-tip";
			node.style.display = "none";
			document.body.appendChild(node);
			return node;
		}
		return {
			show(html, x, y) {
				const e = ensure();
				e.innerHTML = html;
				e.style.display = "block";
				const r = e.getBoundingClientRect();
				let nx = x + 16;
				let ny = y + 16;
				if (nx + r.width > window.innerWidth - 8) nx = x - r.width - 16;
				if (ny + r.height > window.innerHeight - 8) ny = y - r.height - 16;
				e.style.left = nx + "px";
				e.style.top = ny + "px";
			},
			hide() {
				if (node) node.style.display = "none";
			},
		};
	})();

	function row(k, v) {
		return '<div class="tr"><span>' + esc(k) + "</span><b>" + v + "</b></div>";
	}
	function opTipHTML(o, label) {
		return (
			'<div class="tt">' +
			esc(o.op) +
			"</div>" +
			row("tool", esc(label || o.toolId)) +
			row(
				"status",
				'<span style="color:' + statusColor(o.status) + '">' + o.status + "</span>",
			) +
			row("duration", o.status === "running" ? "—" : fmtMs(o.duration)) +
			row("tokens", fmtNum(o.tokIn) + " in · " + fmtNum(o.tokOut) + " out") +
			(o.args ? row("arg", esc(o.args)) : "") +
			(o.taskLabel ? row("task", esc(o.taskLabel)) : "")
		);
	}

	// --- header icons (inline SVG strings) -----------------------------------
	const SVG = (d) =>
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">' +
		d +
		"</svg>";
	const icons = {
		pulse: SVG('<path d="M3 12h4l2-6 4 12 2-6h6"/>'),
		gauge: SVG('<path d="M5 18a8 8 0 1 1 14 0"/><path d="M12 14l4-3"/>'),
		grid: SVG(
			'<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
		),
		list: SVG('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
		bars: SVG('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
		link: SVG(
			'<path d="M9 15l6-6M10.5 6.5l1-1a4 4 0 0 1 6 6l-1 1M13.5 17.5l-1 1a4 4 0 0 1-6-6l1-1"/>',
		),
		recap: SVG('<path d="M5 4h11l3 3v13H5z"/><path d="M9 12h6M9 16h6M9 8h3"/>'),
	};

	window.OpsUI = {
		fmtNum,
		fmtMs,
		fmtPct,
		fmtClock,
		fmtCost,
		fmtDur,
		fmtSince,
		agoMs,
		palette,
		statusColor,
		statusLed,
		hexA,
		esc,
		el,
		Tip,
		opTipHTML,
		icons,
	};
})();
