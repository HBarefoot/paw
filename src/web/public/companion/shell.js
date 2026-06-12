/**
 * Companion shell — the Skill Dock v2 home, built with real DOM + SVG to match
 * the design prototype pixel-for-pixel (CSS-gradient avatar, dashed SVG tether
 * beams with purple particles, pill ping rings). Driven by CompanionEngine
 * (real data) and the chat page's postMessage relay. Scaled to fit its tab so
 * it never scrolls.
 *
 * Layout 1: left skill column (capped 16 + smart overflow chip) next to the
 * avatar, with the greeting + Tools/Operations/Income stats + ops feed below,
 * and sub-agent orbs with persistent orchestrator links.
 */
(() => {
	const R = window.CompanionRouter;
	const Dock = window.CompanionDock;
	const SVGNS = "http://www.w3.org/2000/svg";
	const CAP = 16;
	// Sub-agent orb gradients (cycled), verbatim from the design's skills-data.js.
	const SUB_GRADS = [
		{
			grad:
				"radial-gradient(120% 120% at 32% 24%, #cdd6f7 0%, #8fb2ef 45%, #5b8df0 78%)",
			glow: "rgba(91,141,240,.45)",
		},
		{
			grad:
				"radial-gradient(120% 120% at 32% 24%, #e3d2f7 0%, #b794ec 45%, #9163e8 78%)",
			glow: "rgba(145,99,232,.45)",
		},
		{
			grad:
				"radial-gradient(120% 120% at 32% 24%, #c8f0f4 0%, #7fdbe8 45%, #2ec3e6 78%)",
			glow: "rgba(46,195,230,.45)",
		},
	];

	function el(tag, cls, text) {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}
	function svg(tag) {
		return document.createElementNS(SVGNS, tag);
	}

	function buildAvatar() {
		const wrap = el("div", "avatar");
		wrap.appendChild(el("div", "avatar-glow"));
		const antenna = el("div", "antenna");
		antenna.appendChild(el("span"));
		antenna.appendChild(el("span"));
		antenna.appendChild(el("span"));
		wrap.appendChild(antenna);
		const ball = el("div", "avatar-ball");
		ball.setAttribute("data-avatar", "1");
		const eyeL = el("div", "eye eye-l");
		eyeL.appendChild(el("div", "pupil"));
		const eyeR = el("div", "eye eye-r");
		eyeR.appendChild(el("div", "pupil"));
		ball.appendChild(eyeL);
		ball.appendChild(eyeR);
		ball.appendChild(el("div", "smile"));
		wrap.appendChild(ball);
		return wrap;
	}

	function statCard(value, label) {
		if (value == null) {
			const c = el("div", "stat muted");
			c.appendChild(el("b", null, "—"));
			c.appendChild(el("span", null, `${label} · soon`));
			return c;
		}
		const c = el("div", "stat");
		c.appendChild(el("b", null, String(value)));
		c.appendChild(el("span", null, label));
		return c;
	}

	function mount(root, cfg) {
		cfg = cfg || {};
		const docEl = root.ownerDocument.documentElement;
		if (cfg.accent) docEl.style.setProperty("--accent", cfg.accent);
		if (cfg.bg) docEl.style.setProperty("--bg", cfg.bg);

		const engine = new window.CompanionEngine();
		engine.start(cfg);

		// ── DOM skeleton (built once) ──
		const fit = el("div", "fit");
		const home = el("div", "home");
		const tetherSvg = svg("svg");
		tetherSvg.setAttribute("class", "tether-svg");
		home.appendChild(tetherSvg);

		const topArea = el("div", "top-area");
		const skillCol = el("div", "skill-col");
		const avatarCell = el("div", "avatar-cell");
		const avatarZone = el("div", "avatar-zone");
		avatarZone.appendChild(buildAvatar());
		const caption = el("div", "activity-caption");
		caption.appendChild(el("span"));
		const subRow = el("div", "subagent-row");
		avatarCell.appendChild(avatarZone);
		avatarCell.appendChild(caption);
		avatarCell.appendChild(subRow);
		topArea.appendChild(skillCol);
		topArea.appendChild(avatarCell);
		home.appendChild(topArea);

		const greeting = el("h1", "greeting", `Hi — I'm ${cfg.brandName || "Paw"}`);
		const subtitle = el(
			"p",
			"subtitle",
			"Ask me to build something and it'll show up right here.",
		);
		const stats = el("div", "stats");
		stats.appendChild(statCard(cfg.tools, "Tools"));
		stats.appendChild(statCard(cfg.operations, "Operations"));
		stats.appendChild(statCard(null, "Income"));
		const opsFeed = el("div", "ops-feed");
		home.appendChild(greeting);
		home.appendChild(subtitle);
		home.appendChild(stats);
		home.appendChild(opsFeed);

		fit.appendChild(home);
		root.appendChild(fit);

		window.addEventListener("message", (e) => {
			const d = e && e.data;
			if (d && d.type === "paw:tool") engine.ingestTool(d);
		});

		// ── incremental render state ──
		const pillByKey = new Map();
		let hiddenKeys = [];
		let lastSkillSig = "";
		let lastAgentSig = "";
		let lastActiveKey = "x";
		let lastPops = -1;
		let renderedTs = [];
		let scale = 1;
		let tetherTimer = null;
		let raf = null;

		function buildColumn(st) {
			skillCol.textContent = "";
			pillByKey.clear();
			const tier = st.skills.length <= 14 ? "lg" : "md";
			const col = Dock.computeColumn(st.skills, { max: CAP });
			for (const s of col.visible) {
				const p = el("span", `pill ${tier}`);
				p.setAttribute("data-key", s.key);
				p.title = s.label;
				p.appendChild(el("span", "pill-dot"));
				p.appendChild(el("span", "pill-label", s.label));
				skillCol.appendChild(p);
				pillByKey.set(s.key, p);
			}
			hiddenKeys = st.skills.slice(CAP).map((s) => s.key);
			if (col.overflow) {
				const p = el("span", `pill ${tier} ovf`);
				p.setAttribute("data-overflow", "1");
				p.appendChild(el("span", "pill-dot"));
				p.appendChild(el("span", "pill-label", col.overflow.label));
				skillCol.appendChild(p);
				pillByKey.set("__overflow__", p);
			}
		}

		function agentTargetFor(actor, agents) {
			if (!actor) return "main";
			for (let i = 0; i < agents.length; i++) {
				if (agents[i].name === actor || agents[i].id === actor) return `sub${i}`;
			}
			return "main";
		}

		function renderActive(st) {
			// pills
			for (const [key, p] of pillByKey) {
				if (key === "__overflow__") continue;
				const a = st.active.get(key);
				if (a) {
					p.classList.add("active");
					p.setAttribute("data-tether", agentTargetFor(a.actor, st.agents));
				} else {
					p.classList.remove("active");
					p.removeAttribute("data-tether");
				}
			}
			// overflow chip: light + relabel when a hidden skill is active
			const chip = pillByKey.get("__overflow__");
			if (chip) {
				let hot = null;
				for (const k of hiddenKeys) {
					if (st.active.has(k)) {
						hot = k;
						break;
					}
				}
				const label = chip.querySelector(".pill-label");
				if (hot) {
					const name = (st.skills.find((s) => s.key === hot) || {}).label || hot;
					if (label) label.textContent = `+${hiddenKeys.length} · ${name}`;
					chip.classList.add("active");
					chip.setAttribute(
						"data-tether",
						agentTargetFor(st.active.get(hot).actor, st.agents),
					);
				} else {
					if (label) label.textContent = `+${hiddenKeys.length}`;
					chip.classList.remove("active");
					chip.removeAttribute("data-tether");
				}
			}
		}

		function renderAgents(st) {
			const sig = st.agents.map((a) => a.id).join(",");
			if (sig !== lastAgentSig) {
				lastAgentSig = sig;
				subRow.textContent = "";
				st.agents.forEach((a, i) => {
					const node = el("div", "subagent");
					const ball = el("div", "subagent-ball");
					ball.setAttribute("data-subagent", String(i));
					const g = SUB_GRADS[a.gradIndex % SUB_GRADS.length];
					ball.style.background = g.grad;
					ball.style.boxShadow = `0 0 26px ${g.glow}`;
					const eyeL = el("div", "eye eye-l sm");
					eyeL.appendChild(el("div", "pupil"));
					const eyeR = el("div", "eye eye-r sm");
					eyeR.appendChild(el("div", "pupil"));
					ball.appendChild(eyeL);
					ball.appendChild(eyeR);
					ball.appendChild(el("div", "smile sm"));
					node.appendChild(ball);
					node.appendChild(el("span", "subagent-name", a.name));
					node.appendChild(el("span", "subagent-status", "idle"));
					subRow.appendChild(node);
				});
			}
			// per-frame working state
			st.agents.forEach((a, i) => {
				const node = subRow.children[i];
				if (!node) return;
				const ball = node.firstChild;
				const status = node.lastChild;
				if (a.working) {
					node.classList.add("acting");
					ball.setAttribute("data-working", "1");
					status.textContent = "working";
				} else {
					node.classList.remove("acting");
					ball.removeAttribute("data-working");
					status.textContent = "idle";
				}
			});
		}

		function renderOps(st) {
			const tsList = st.ops.map((o) => o.ts);
			const sig = tsList.join(",");
			if (sig === renderedTs.join(",")) {
				// still refresh fail flags on existing rows
				st.ops.forEach((o, i) => {
					const row = opsFeed.children[i];
					if (row) {
						const dot = row.firstChild;
						dot.className = `op-dot${o.isError ? " fail" : ""}`;
					}
				});
				return;
			}
			renderedTs = tsList;
			opsFeed.textContent = "";
			for (const o of st.ops) {
				const row = el("div", "op");
				row.appendChild(el("span", `op-dot${o.isError ? " fail" : ""}`));
				row.appendChild(el("span", "op-label", o.label));
				if (o.agentName) row.appendChild(el("span", "op-agent", o.agentName));
				opsFeed.appendChild(row);
			}
		}

		function renderAvatar(st) {
			const av = avatarZone.firstChild;
			if (st.busy) av.classList.add("busy");
			else av.classList.remove("busy");
			// re-trigger the avatarPop when the orchestrator itself acts
			if (st.mainPops !== lastPops) {
				lastPops = st.mainPops;
				const ball = av.querySelector("[data-avatar]");
				if (ball) {
					ball.style.animation = "none";
					// reflow to restart the keyframe
					void ball.offsetWidth;
					ball.style.animation = "";
				}
			}
			const span = caption.firstChild;
			if (st.busy) {
				caption.classList.add("on");
				const names = [];
				for (const [k] of st.active) {
					const s = st.skills.find((x) => x.key === k);
					if (s) names.push(s.label);
					if (names.length >= 3) break;
				}
				span.textContent = names.length ? `▸ using ${names.join(", ")}` : " ";
			} else {
				caption.classList.remove("on");
				span.textContent = " ";
			}
		}

		function computeTethers(st) {
			const crect = home.getBoundingClientRect();
			const av = home.querySelector("[data-avatar]");
			if (!av || crect.width === 0) return { skills: [], links: [] };
			const edge = (r) => ({
				cx: (r.left + r.width / 2 - crect.left) / scale,
				cy: (r.top + r.height / 2 - crect.top) / scale,
				rad: r.width / 2 / scale,
			});
			const main = edge(av.getBoundingClientRect());
			const targets = { main };
			home.querySelectorAll("[data-subagent]").forEach((node) => {
				const t = edge(node.getBoundingClientRect());
				t.working = node.getAttribute("data-working") === "1";
				targets[`sub${node.getAttribute("data-subagent")}`] = t;
			});

			const skills = [];
			home.querySelectorAll("[data-tether]").forEach((node) => {
				const tgt = targets[node.getAttribute("data-tether")] || main;
				const r = node.getBoundingClientRect();
				const src = {
					cx: (r.left + r.width / 2 - crect.left) / scale,
					cy: (r.top + r.height / 2 - crect.top) / scale,
					w: r.width / scale,
					h: r.height / scale,
				};
				const a = R.anchor(src, tgt, 5, 10);
				const d = R.orthPath(a.sx, a.sy, a.ex, a.ey);
				if (d) skills.push(d);
			});

			const links = [];
			Object.keys(targets).forEach((k) => {
				if (k === "main") return;
				const t = targets[k];
				const a = R.anchor(
					{ cx: main.cx, cy: main.cy, w: main.rad * 2, h: main.rad * 2 },
					t,
					8,
					7,
				);
				const d = R.orthPath(a.sx, a.sy, a.ex, a.ey);
				if (d) links.push({ d, working: !!t.working });
			});
			return { skills, links };
		}

		function paintTethers(st) {
			const { skills, links } = computeTethers(st);
			tetherSvg.textContent = "";
			for (const l of links) {
				const path = svg("path");
				path.setAttribute("d", l.d);
				path.setAttribute("class", `agent-link${l.working ? " working" : ""}`);
				tetherSvg.appendChild(path);
				if (l.working) tetherSvg.appendChild(particle(l.d, 2.6, "1.3s"));
			}
			for (const d of skills) {
				const path = svg("path");
				path.setAttribute("d", d);
				path.setAttribute("class", "tether-line");
				tetherSvg.appendChild(path);
				tetherSvg.appendChild(particle(d, 3, "1.5s"));
			}
		}

		function particle(d, r, dur) {
			const c = svg("circle");
			c.setAttribute("r", String(r));
			c.setAttribute("class", "tether-particle");
			const m = svg("animateMotion");
			m.setAttribute("dur", dur);
			m.setAttribute("repeatCount", "indefinite");
			m.setAttribute("path", d);
			c.appendChild(m);
			return c;
		}

		function scaleToFit() {
			const rw = root.clientWidth;
			const rh = root.clientHeight;
			if (!rw || !rh) return;
			// Measure at natural size.
			const prev = fit.style.transform;
			fit.style.transform = "scale(1)";
			const cw = home.offsetWidth;
			const ch = home.offsetHeight;
			let s = Math.min(1, rw / cw, rh / ch);
			if (!Number.isFinite(s) || s <= 0) s = 1;
			scale = s;
			fit.style.transform = s === 1 ? prev || "" : `scale(${s})`;
		}

		function activeKey(st) {
			const parts = [];
			for (const [k, v] of st.active) parts.push(`${k}:${v.actor || ""}`);
			parts.push(`a${lastAgentSig}`);
			return parts.sort().join(",");
		}

		function frame() {
			const st = engine.getState();
			const skillSig = st.skills.map((s) => s.key).join(",");
			if (skillSig !== lastSkillSig) {
				lastSkillSig = skillSig;
				buildColumn(st);
				lastActiveKey = "x";
			}
			renderAgents(st);
			renderActive(st);
			renderOps(st);
			renderAvatar(st);
			scaleToFit();
			const ak = activeKey(st);
			if (ak !== lastActiveKey) {
				lastActiveKey = ak;
				if (tetherTimer) clearTimeout(tetherTimer);
				tetherTimer = setTimeout(() => paintTethers(engine.getState()), 90);
			}
			raf = window.requestAnimationFrame(frame);
		}
		frame();
		if (typeof ResizeObserver === "function") {
			new ResizeObserver(scaleToFit).observe(root);
		}

		return {
			stop() {
				engine.stop();
				if (raf) window.cancelAnimationFrame(raf);
				if (tetherTimer) clearTimeout(tetherTimer);
			},
		};
	}

	window.Companion = { mount };
})();
