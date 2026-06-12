/**
 * Companion shell — mounts the Skill Dock v2 companion on a single fitted canvas
 * and drives it from CompanionEngine. Everything is drawn to fit the container
 * (no scroll): a capped left skill column + overflow chip, orthogonal tether
 * beams to the avatar, spawned-agent orbs with an orchestrator link, antenna
 * thinking-dots, and an ops feed. Motion is event-driven (draws are cheap and
 * idempotent; only active beams/dots animate).
 */
(() => {
	const R = window.CompanionRouter;
	const Dock = window.CompanionDock;

	function hexToRgba(hex, a) {
		const h = (hex || "#7458f5").replace("#", "");
		const n = Number.parseInt(
			h.length === 3
				? h
						.split("")
						.map((c) => c + c)
						.join("")
				: h,
			16,
		);
		return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
	}

	function mount(root, cfg) {
		cfg = cfg || {};
		const accent = cfg.accent || "#7458f5";
		const canvas = document.createElement("canvas");
		canvas.className = "companion-canvas";
		root.appendChild(canvas);
		const ctx = canvas.getContext("2d");
		const engine = new window.CompanionEngine();
		engine.start(cfg);

		let w = 0;
		let h = 0;
		let dpr = 1;
		function fit() {
			const rect = root.getBoundingClientRect();
			w = Math.max(160, rect.width);
			h = Math.max(160, rect.height);
			dpr = window.devicePixelRatio || 1;
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			canvas.style.width = `${w}px`;
			canvas.style.height = `${h}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		fit();
		if (typeof ResizeObserver === "function") {
			new ResizeObserver(fit).observe(root);
		} else {
			window.addEventListener("resize", fit);
		}

		window.addEventListener("message", (e) => {
			const d = e && e.data;
			if (d && d.type === "paw:tool") engine.ingestTool(d);
		});

		let raf = null;
		function frame() {
			draw(ctx, engine.getState(), { w, h, accent });
			raf = window.requestAnimationFrame(frame);
		}
		frame();

		return {
			stop() {
				engine.stop();
				if (raf) window.cancelAnimationFrame(raf);
			},
		};
	}

	function draw(ctx, st, view) {
		const { w, h, accent } = view;
		const now = st.now;
		ctx.clearRect(0, 0, w, h);

		// --- layout (fractions of the fitted box → never overflows/scrolls) ---
		const colX = w * 0.06;
		const pillW = Math.min(150, w * 0.3);
		const avatar = { x: w * 0.52, y: h * 0.4, r: Math.min(46, h * 0.12) };
		const feedTop = h * 0.7;

		// Capped skill column. Reserve a row for the overflow chip; fit rows in
		// the column band so the whole thing stays on screen.
		const bandTop = h * 0.08;
		const bandH = feedTop - bandTop - 12;
		const pitch = 30;
		const maxRows = Math.max(3, Math.floor(bandH / pitch));
		const activeHiddenKey = firstActiveKey(st);
		// Cap at 16, but never overflow the band — reserve a row for the chip.
		const maxVisible = Math.min(16, Math.max(2, maxRows - 1));
		const col = Dock.computeColumn(st.skills, {
			max: maxVisible,
			activeHiddenKey,
		});
		const rows = col.visible.length + (col.overflow ? 1 : 0);
		const startY = bandTop + Math.max(0, (bandH - rows * pitch) / 2) + pitch / 2;

		// Pill positions (key → right-edge anchor for beams).
		const anchor = {};
		for (let i = 0; i < col.visible.length; i++) {
			const s = col.visible[i];
			const y = startY + i * pitch;
			const lit = st.active.has(s.key);
			drawPill(ctx, colX, y, pillW, s.label, lit, accent);
			anchor[s.key] = { x: colX + pillW, y };
		}
		let chip = null;
		if (col.overflow) {
			const y = startY + col.visible.length * pitch;
			drawChip(ctx, colX, y, pillW, col.overflow, accent);
			chip = { x: colX + pillW, y };
		}

		// --- beams: pill (or chip, for a hidden skill) → avatar or agent orb ---
		const agentPos = layoutAgents(st.agents, avatar, w);
		for (const b of st.beams) {
			let from = anchor[b.fromKey];
			if (!from && chip) from = chip; // hidden skill routes from the chip
			if (!from) continue;
			let to;
			if (b.target.kind === "agent" && agentPos[b.target.id]) {
				const o = agentPos[b.target.id];
				to = { x: o.x - o.r, y: o.y };
			} else {
				to = { x: avatar.x - avatar.r, y: avatar.y };
			}
			const pts = R.route(from, to);
			const age = (now - b.bornAt) / (b.untilTs - b.bornAt);
			ctx.save();
			ctx.strokeStyle = hexToRgba(accent, 0.55);
			ctx.lineWidth = 1.5;
			ctx.setLineDash([4, 4]);
			ctx.lineDashOffset = -now / 28;
			R.stroke(ctx, pts, 12);
			ctx.restore();
			// inward particle
			const p = R.pointAt(pts, R.length(pts) * Math.min(1, age));
			ctx.beginPath();
			ctx.fillStyle = hexToRgba(accent, 0.95);
			ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
			ctx.fill();
		}

		// --- agent orbs + persistent orchestrator link ---
		for (const a of st.agents) {
			const o = agentPos[a.id];
			if (!o) continue;
			const hot = st.agentActive.has(a.id);
			const link = R.route(
				{ x: avatar.x + avatar.r, y: avatar.y },
				{ x: o.x - o.r, y: o.y },
			);
			ctx.save();
			ctx.strokeStyle = hexToRgba(accent, hot ? 0.5 : 0.16);
			ctx.lineWidth = 1;
			ctx.setLineDash([3, 5]);
			if (hot) ctx.lineDashOffset = -now / 22;
			R.stroke(ctx, link, 10);
			ctx.restore();
			drawOrb(ctx, o.x, o.y, o.r, a, hot, accent);
		}

		// --- avatar + antenna thinking-dots ---
		drawAvatar(ctx, avatar, st.busy, accent);
		if (st.thinking) drawAntenna(ctx, avatar, now, accent);

		// --- stats + ops feed ---
		drawFeed(ctx, st, { w, h, feedTop, accent });
	}

	function firstActiveKey(st) {
		for (const k of st.active.keys()) return k;
		return null;
	}

	function layoutAgents(agents, avatar, w) {
		const pos = {};
		const n = agents.length;
		const cx = avatar.x + Math.min(w * 0.28, 180);
		for (let i = 0; i < n; i++) {
			const t = n === 1 ? 0 : i / (n - 1) - 0.5;
			pos[agents[i].id] = { x: cx, y: avatar.y + t * 90, r: 14 };
		}
		return pos;
	}

	function drawPill(ctx, x, y, wd, label, lit, accent) {
		const hgt = 22;
		roundRect(ctx, x, y - hgt / 2, wd, hgt, 7);
		ctx.fillStyle = lit ? hexToRgba(accent, 0.22) : "rgba(255,255,255,0.05)";
		ctx.fill();
		ctx.strokeStyle = lit ? hexToRgba(accent, 0.9) : "rgba(255,255,255,0.12)";
		ctx.lineWidth = lit ? 1.4 : 1;
		ctx.stroke();
		ctx.fillStyle = lit ? "#fff" : "rgba(255,255,255,0.62)";
		ctx.font = "11px system-ui, sans-serif";
		ctx.textBaseline = "middle";
		ctx.fillText(clip(ctx, label, wd - 16), x + 9, y);
	}

	function drawChip(ctx, x, y, wd, overflow, accent) {
		const hgt = 22;
		roundRect(ctx, x, y - hgt / 2, wd, hgt, 7);
		ctx.fillStyle = overflow.hot
			? hexToRgba(accent, 0.28)
			: "rgba(255,255,255,0.04)";
		ctx.fill();
		ctx.strokeStyle = overflow.hot
			? hexToRgba(accent, 0.95)
			: "rgba(255,255,255,0.16)";
		ctx.lineWidth = overflow.hot ? 1.6 : 1;
		ctx.stroke();
		ctx.fillStyle = overflow.hot ? "#fff" : "rgba(255,255,255,0.7)";
		ctx.font = "11px system-ui, sans-serif";
		ctx.textBaseline = "middle";
		ctx.fillText(clip(ctx, overflow.label, wd - 16), x + 9, y);
	}

	function drawAvatar(ctx, a, busy, accent) {
		ctx.save();
		const grd = ctx.createRadialGradient(a.x, a.y, 2, a.x, a.y, a.r);
		grd.addColorStop(0, hexToRgba(accent, busy ? 0.95 : 0.7));
		grd.addColorStop(1, hexToRgba(accent, 0.1));
		ctx.fillStyle = grd;
		ctx.beginPath();
		ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
		ctx.fill();
		// eyes
		ctx.fillStyle = "#fff";
		const ey = a.y - a.r * 0.1;
		const ex = a.r * 0.32;
		dot(ctx, a.x - ex, ey, 2.6);
		dot(ctx, a.x + ex, ey, 2.6);
		ctx.restore();
	}

	function drawAntenna(ctx, a, now, accent) {
		const baseY = a.y - a.r - 8;
		for (let i = 0; i < 3; i++) {
			const ph = Math.sin(now / 200 + i * 0.9) * 0.5 + 0.5;
			ctx.fillStyle = hexToRgba(accent, 0.4 + ph * 0.5);
			dot(ctx, a.x + (i - 1) * 8, baseY - ph * 4, 2.2);
		}
	}

	function drawOrb(ctx, x, y, r, agent, hot, accent) {
		ctx.beginPath();
		ctx.fillStyle = agent.done
			? agent.ok
				? "rgba(80,200,120,0.85)"
				: "rgba(240,90,90,0.85)"
			: hexToRgba(accent, hot ? 0.9 : 0.55);
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#fff";
		dot(ctx, x - 4, y - 1, 1.6);
		dot(ctx, x + 4, y - 1, 1.6);
		ctx.fillStyle = "rgba(255,255,255,0.7)";
		ctx.font = "9px system-ui, sans-serif";
		ctx.textBaseline = "middle";
		ctx.fillText(clip(ctx, agent.name, 90), x + r + 5, y);
	}

	function drawFeed(ctx, st, v) {
		const { w, feedTop, accent } = v;
		ctx.fillStyle = "rgba(255,255,255,0.45)";
		ctx.font = "10px system-ui, sans-serif";
		ctx.textBaseline = "middle";
		ctx.fillText(clip(ctx, st.model || "agent", w * 0.4), 14, feedTop - 10);
		const rowH = 18;
		const maxRows = Math.max(0, Math.floor((v.h - feedTop - 6) / rowH));
		for (let i = 0; i < Math.min(maxRows, st.feed.length); i++) {
			const f = st.feed[i];
			const y = feedTop + 8 + i * rowH;
			ctx.beginPath();
			ctx.fillStyle = f.isError ? "#f05a5a" : hexToRgba(accent, 0.85);
			ctx.arc(20, y, 3, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "rgba(255,255,255,0.72)";
			ctx.font = "11px system-ui, sans-serif";
			let label = f.label;
			if (f.agentName) label = `[${f.agentName}] ${label}`;
			ctx.fillText(clip(ctx, label, w - 44), 30, y);
		}
	}

	// --- small canvas helpers ---
	function roundRect(ctx, x, y, wd, hgt, r) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + wd, y, x + wd, y + hgt, r);
		ctx.arcTo(x + wd, y + hgt, x, y + hgt, r);
		ctx.arcTo(x, y + hgt, x, y, r);
		ctx.arcTo(x, y, x + wd, y, r);
		ctx.closePath();
	}
	function dot(ctx, x, y, r) {
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
	}
	function clip(ctx, text, maxW) {
		text = String(text == null ? "" : text);
		if (ctx.measureText(text).width <= maxW) return text;
		while (text.length > 1 && ctx.measureText(`${text}…`).width > maxW) {
			text = text.slice(0, -1);
		}
		return `${text}…`;
	}

	window.Companion = { mount, draw };
})();
