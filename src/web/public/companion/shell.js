/**
 * Companion shell — the Skill Dock companion home, built with real DOM + SVG
 * (CSS-gradient avatar, dashed SVG tether beams with purple particles, pill
 * ping rings). Driven by CompanionEngine (real data) and the chat page's
 * postMessage relay. Scaled to fit its tab so it never scrolls.
 *
 * Wrap dock: centered avatar → dynamic action subtitle → sub-agent orbs →
 * skills wrapping below → greeting → ops feed (the stat cards were removed).
 *
 * Reactivity layer: the face is the product's emotional surface, so every frame
 * the engine resolves a single expression (idle/sleepy/listening/thinking/
 * working/success/wince/worried/waiting) from REAL signals via the pure
 * CompanionExpression machine. That expression drives the antenna "thinking"
 * dots, the dynamic subtitle, a CompanionSpring squash/stretch pop, and the
 * gaze (pupils track the active pill / acting sub-agent / chat input). All
 * motion honours prefers-reduced-motion.
 */
(() => {
	const R = window.CompanionRouter;
	const E = window.CompanionExpression;
	const SP = window.CompanionSpring;
	const SVGNS = "http://www.w3.org/2000/svg";
	const DEFAULT_SUBTITLE =
		"Ask me to build something and it'll show up right here.";
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

	/** Strip control chars + clamp length on text that can embed remote tool
	 *  output (mirrors the server's sanitizePromptText control-char strip; tag
	 *  safety is covered because we only ever assign it via textContent). */
	function sanitizeText(s) {
		// biome-ignore lint: control-char strip is intentional
		return String(s == null ? "" : s)
			.replace(/[\u0000-\u001f\u007f]/g, " ")
			.slice(0, 80)
			.trim();
	}

	/** The plain-words line under the avatar — reflects the live action. */
	function captionFor(st, expr) {
		switch (expr) {
			case "working": {
				const names = [];
				for (const [k] of st.active) {
					const s = st.skills.find((x) => x.key === k);
					if (s) names.push(s.label);
					if (names.length >= 2) break;
				}
				if (names.length) return sanitizeText(`▸ ${names.join(", ")}`);
				const op = st.ops && st.ops[0];
				return op ? sanitizeText(`▸ ${op.label}`) : "Working…";
			}
			case "thinking":
				return "Thinking…";
			case "waiting":
				return "Waiting for your approval…";
			case "worried":
				return "A sub-agent ran into trouble…";
			case "wince":
				return "That didn't go through — retrying…";
			case "success":
				return "Done.";
			case "listening":
				return "Listening…";
			default:
				return DEFAULT_SUBTITLE;
		}
	}

	/** Split the agent list into the visible orbs + an overflow count (the cap'd
	 *  tail collapses into one "+N" orb). Pure → unit-tested. */
	function visibleAgents(all, cap) {
		const overflow = all.length > cap ? all.length - (cap - 1) : 0;
		const visible = overflow ? all.slice(0, cap - 1) : all;
		return { visible, overflow };
	}

	/** What the eyes look at: failed sub-agent (worried) > active pill > acting
	 *  sub-agent > input > center. */
	function gazeTarget(st, expr) {
		expr = expr || (st && st.expression) || "idle";
		if (expr === "worried" && st?.agents) {
			const fi = st.agents.findIndex((a) => a.status === "done" && a.ok === false);
			if (fi >= 0) return { kind: "sub", idx: fi };
		}
		if (st && st.active && st.active.size) {
			for (const [k] of st.active) return { kind: "pill", key: k };
		}
		if (st && st.agents) {
			const idx = st.agents.findIndex((a) => a.working);
			if (idx >= 0) return { kind: "sub", idx };
		}
		if (expr === "listening") return { kind: "input" };
		return { kind: "center" };
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

	function mount(root, cfg) {
		cfg = cfg || {};
		const docEl = root.ownerDocument.documentElement;
		if (cfg.accent) docEl.style.setProperty("--accent", cfg.accent);
		if (cfg.bg) docEl.style.setProperty("--bg", cfg.bg);

		const engine = new window.CompanionEngine();
		engine.start(cfg);
		const reduced = SP ? SP.prefersReducedMotion() : false;

		// ── DOM skeleton (built once) ──
		const fit = el("div", "fit");
		const home = el("div", "home");
		const tetherSvg = svg("svg");
		tetherSvg.setAttribute("class", "tether-svg");
		home.appendChild(tetherSvg);

		// Wrap-dock composition: centered avatar → sub-agents → skills wrapping →
		// greeting → dynamic subtitle → ops feed (no stat cards).
		const avatarZone = el("div", "avatar-zone");
		avatarZone.appendChild(buildAvatar());
		// Mood layer: a slow real-telemetry health scalar (0..1, injected from the
		// 1-hour tool_log failure rate) varies SATURATION / BRIGHTNESS / POSTURE
		// only — the avatar hue stays brand-driven (the white-label rule).
		const mood =
			typeof cfg.moodScalar === "number"
				? Math.max(0, Math.min(1, cfg.moodScalar))
				: 1;
		(() => {
			const av = avatarZone.firstChild;
			const ball = av?.querySelector("[data-avatar]");
			if (ball) {
				ball.style.filter = `saturate(${(0.7 + 0.3 * mood).toFixed(2)}) brightness(${(0.85 + 0.15 * mood).toFixed(2)})`;
			}
			if (av) av.style.transform = `translateY(${((1 - mood) * 6).toFixed(1)}px)`;
		})();
		const subRow = el("div", "subagent-row");
		const wrapDock = el("div", "wrap-dock");
		home.appendChild(avatarZone);
		home.appendChild(subRow);
		home.appendChild(wrapDock);

		const greeting = el("h1", "greeting", `Hi — I'm ${cfg.brandName || "Paw"}`);
		const subtitle = el("p", "subtitle", DEFAULT_SUBTITLE);
		const opsFeed = el("div", "ops-feed");
		home.appendChild(greeting);
		home.appendChild(subtitle);
		home.appendChild(opsFeed);

		fit.appendChild(home);
		root.appendChild(fit);

		window.addEventListener("message", (e) => {
			const d = e && e.data;
			if (!d) return;
			if (d.type === "paw:tool") engine.ingestTool(d);
			else if (d.type === "paw:input") engine.ingestInput(d.state);
			else if (d.type === "paw:ambient") {
				engine.setWaiting(d.pendingApprovals || 0);
				engine.setNotifications(d.unreadByKind || {});
			}
			else if (d.type === "paw:speak") onSpeak(d.phase);
		});

		// TTS mouth-sync: lip-flap the smile while speaking (masks the MOUTH only —
		// eyes/antenna keep their expression). Driven by real SpeechSynthesis events.
		function onSpeak(phase) {
			const av = avatarZone.firstChild;
			const smile = av.querySelector(".smile");
			if (phase === "start") {
				av.classList.add("speaking");
			} else if (phase === "boundary") {
				if (smile) smile.classList.toggle("talk");
			} else if (phase === "end") {
				av.classList.remove("speaking");
				if (smile) smile.classList.remove("talk");
			}
		}

		// ── incremental render state ──
		const pillByKey = new Map();
		const agentNodes = new Map(); // name | "overflow" -> orb node (keyed reconcile)
		const prevAgentStatus = new Map(); // name -> last status (nod on completion)
		const SUBAGENT_CAP = 8; // beyond this, the rest collapse into one "+N" orb
		let lastSkillSig = "";
		let lastAgentSig = "";
		let lastActiveKey = "x";
		let lastPops = -1;
		let lastExpr = "idle";
		let lastCaption = "";
		let renderedTs = [];
		let scale = 1;
		let tetherTimer = null;
		let raf = null;
		// Micro-physics: one spring kicked on entry into a busy face / orchestrator
		// pop; its value squashes the orb (reduced-motion snaps it flat).
		const pop = SP ? SP.make(0) : { value: 0, velocity: 0 };
		let lastTs = 0;

		function buildDock(st) {
			wrapDock.textContent = "";
			pillByKey.clear();
			// Density tier by count (prototype WrapDock): bigger pills when there
			// are few, shrinking as the set grows so everything stays on screen.
			const n = st.skills.length;
			const tier = n <= 20 ? "lg" : n <= 48 ? "md" : "sm";
			for (const s of st.skills) {
				const p = el("span", `pill ${tier}`);
				p.setAttribute("data-key", s.key);
				p.title = s.label;
				p.appendChild(el("span", "pill-dot"));
				p.appendChild(el("span", "pill-label", s.label));
				wrapDock.appendChild(p);
				pillByKey.set(s.key, p);
			}
		}

		function agentTargetFor(actor, agents) {
			const t = window.CompanionTopology.beamTarget({ agentName: actor }, agents);
			if (t.kind === "agent") {
				const idx = agents.findIndex((a) => a.id === t.id);
				if (idx >= 0) return `sub${idx}`;
			}
			return "main";
		}

		function renderActive(st) {
			for (const [key, p] of pillByKey) {
				const a = st.active.get(key);
				if (a) {
					p.classList.add("active");
					p.setAttribute("data-tether", agentTargetFor(a.actor, st.agents));
				} else {
					p.classList.remove("active");
					p.removeAttribute("data-tether");
				}
			}
		}

		// Badge a skill pill when there are unread notifications of its kind
		// (notification.kind === the skill key, e.g. "github", "slack").
		function renderBadges(st) {
			const byKind = st.unreadByKind || {};
			for (const [key, p] of pillByKey) {
				const count = byKind[key] || 0;
				if (count > 0) {
					if (!p._badge) {
						p._badge = el("span", "pill-badge");
						p.appendChild(p._badge);
					}
					p._badge.textContent = count > 99 ? "99+" : String(count);
					p.classList.add("has-alert");
				} else if (p._badge) {
					if (p._badge.parentNode) p._badge.parentNode.removeChild(p._badge);
					p._badge = null;
					p.classList.remove("has-alert");
				}
			}
		}

		function buildSubagent(a) {
			const node = el("div", "subagent");
			const ball = el("div", "subagent-ball");
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
			return node;
		}

		function buildOverflow() {
			const node = el("div", "subagent overflow");
			const ball = el("div", "subagent-ball overflow-ball");
			node.appendChild(ball);
			node.appendChild(el("span", "subagent-name", "+0"));
			node.appendChild(el("span", "subagent-status", "more"));
			return node;
		}

		function updateSubagent(node, a, idx) {
			const ball = node.firstChild;
			const status = node.lastChild;
			ball.setAttribute("data-subagent", String(idx));
			node.classList.remove("acting", "done", "failed");
			if (a.status === "done") {
				node.classList.add("done");
				ball.removeAttribute("data-working");
				if (a.ok === false) {
					node.classList.add("failed");
					status.textContent = "failed";
				} else {
					status.textContent = "done";
				}
			} else if (a.working) {
				node.classList.add("acting");
				ball.setAttribute("data-working", "1");
				status.textContent = "working";
			} else {
				ball.removeAttribute("data-working");
				status.textContent = "idle";
			}
			// Orchestrator nod the moment an agent finishes (spring pop on the main orb).
			if (prevAgentStatus.get(a.name) !== "done" && a.status === "done") {
				pop.velocity += 12;
			}
			prevAgentStatus.set(a.name, a.status);
		}

		// Keyed reconcile: one orb per spawned agent (lockstep with the chat rows),
		// capped — a 9th+ agent collapses into a single "+N" orb so the face stays
		// readable. New orbs bud in; finished orbs are removed once they've absorbed.
		function renderAgents(st) {
			const { visible, overflow } = visibleAgents(st.agents, SUBAGENT_CAP);
			const keys = visible.map((a) => a.name);
			if (overflow) keys.push("overflow");

			// Drop orbs whose agent left (absorbed / out of the window).
			for (const [k, node] of agentNodes) {
				if (keys.indexOf(k) === -1) {
					if (node.parentNode) node.parentNode.removeChild(node);
					agentNodes.delete(k);
					prevAgentStatus.delete(k);
				}
			}
			// Ensure + order + update each visible orb (appendChild moves existing
			// nodes, preserving their animation/classes — only new orbs bud).
			visible.forEach((a, i) => {
				let node = agentNodes.get(a.name);
				if (!node) {
					node = buildSubagent(a);
					node.classList.add("bud");
					agentNodes.set(a.name, node);
					const n = node;
					setTimeout(() => n.classList.remove("bud"), 600);
				}
				subRow.appendChild(node);
				updateSubagent(node, a, i);
			});
			if (overflow) {
				let node = agentNodes.get("overflow");
				if (!node) {
					node = buildOverflow();
					agentNodes.set("overflow", node);
				}
				subRow.appendChild(node);
				node.querySelector(".subagent-name").textContent = `+${overflow}`;
			}
			lastAgentSig = keys.join(",");
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
			const expr = st.expression || "idle";
			// Expression → classes. The 3 antenna dots animate ONLY while thinking
			// (user spec); busy keeps the orb glow up across thinking/working.
			if (expr === "thinking") av.classList.add("thinking");
			else av.classList.remove("thinking");
			if (expr === "working" || expr === "thinking") av.classList.add("busy");
			else av.classList.remove("busy");
			av.setAttribute("data-expr", expr);

			// Kick the squash spring on entry into a busy face or an orchestrator pop.
			const popOnExpr = E ? E.shouldPop(lastExpr, expr) : false;
			if (popOnExpr || st.mainPops !== lastPops) {
				lastPops = st.mainPops;
				pop.velocity += 16;
			}
			lastExpr = expr;

			// Dynamic subtitle = the live action line (default greeting when idle).
			const text = captionFor(st, expr);
			if (text !== lastCaption) {
				lastCaption = text;
				subtitle.textContent = text;
			}
		}

		function applyPhysics(st) {
			const now = Date.now();
			const dt = lastTs ? (now - lastTs) / 1000 : 0;
			lastTs = now;
			if (SP) SP.step(pop, 0, dt, { reduced });
			const ball = avatarZone.firstChild.querySelector("[data-avatar]");
			if (ball) {
				const e = Math.max(-0.12, Math.min(0.12, pop.value * 0.04));
				ball.style.transform = `scale(${(1 + e).toFixed(3)}, ${(1 - e).toFixed(3)})`;
			}
			applyGaze(st);
		}

		function applyGaze(st) {
			const ball = avatarZone.firstChild.querySelector("[data-avatar]");
			if (!ball) return;
			const pupils = ball.querySelectorAll(".pupil");
			if (!pupils || !pupils.length) return;
			const t = gazeTarget(st, st.expression);
			const br = ball.getBoundingClientRect();
			const bx = br.left + br.width / 2;
			const by = br.top + br.height / 2;
			let tx = null;
			let ty = null;
			if (t.kind === "pill") {
				const p = pillByKey.get(t.key);
				if (p) {
					const r = p.getBoundingClientRect();
					tx = r.left + r.width / 2;
					ty = r.top + r.height / 2;
				}
			} else if (t.kind === "sub") {
				const node = subRow.children[t.idx];
				if (node?.firstChild) {
					const r = node.firstChild.getBoundingClientRect();
					tx = r.left + r.width / 2;
					ty = r.top + r.height / 2;
				}
			} else if (t.kind === "input") {
				// the chat input lives below the companion (parent doc) → look down
				tx = bx;
				ty = by + 220;
			}
			let dx = 0;
			let dy = 0;
			if (tx != null && !reduced) {
				const vx = tx - bx;
				const vy = ty - by;
				const len = Math.hypot(vx, vy) || 1;
				const max = 4; // px of travel within the eye
				dx = (vx / len) * max;
				dy = (vy / len) * max;
			}
			for (const pu of pupils) {
				pu.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
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
				buildDock(st);
				lastActiveKey = "x";
			}
			renderAgents(st);
			renderActive(st);
			renderBadges(st);
			renderOps(st);
			renderAvatar(st);
			applyPhysics(st);
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

	window.Companion = { mount, gazeTarget, captionFor, visibleAgents };
})();
