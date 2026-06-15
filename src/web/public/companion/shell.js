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
	const INBOX = window.CompanionInbox;
	const SVGNS = "http://www.w3.org/2000/svg";
	const DEFAULT_SUBTITLE =
		"Ask me to build something and it'll show up right here.";
	// Gel-sphere theme presets (verbatim stops from the design's companion.jsx).
	// One face can be mint (the brand orchestrator), another blue/violet/cyan
	// (the spawned sub-agents) — so each little agent reads as its own colour.
	const THEMES = {
		mint: { s1: "#b9c2f5", s2: "#7fc9dd", s3: "#3fe08f", s4: "#14b87e", glow: "rgba(46,230,168,.5)", accent: "#2ee6a8", mouth: "rgba(5,38,26,.92)" },
		teal: { s1: "#b3c1f2", s2: "#74cbe4", s3: "#34d6e0", s4: "#119fc0", glow: "rgba(37,196,220,.5)", accent: "#25c4dc", mouth: "rgba(6,36,42,.92)" },
		blue: { s1: "#cdd6f7", s2: "#9bb6ef", s3: "#6f8ff0", s4: "#4f6fe0", glow: "rgba(91,141,240,.5)", accent: "#6f8ff0", mouth: "rgba(12,20,52,.92)" },
		violet: { s1: "#ddd0f7", s2: "#c0a2ec", s3: "#a06fe8", s4: "#8a4fe0", glow: "rgba(145,99,232,.5)", accent: "#a06fe8", mouth: "rgba(28,14,52,.92)" },
		cyan: { s1: "#c8f0f4", s2: "#88dbe8", s3: "#34cfe0", s4: "#14a6c4", glow: "rgba(46,195,230,.5)", accent: "#34cfe0", mouth: "rgba(6,34,42,.92)" },
	};
	// Distinct colour per spawned sub-agent (cycled in spawn order).
	const SUB_THEME_CYCLE = ["blue", "violet", "cyan"];

	// expression → facial params. eyeSY squashes the eyes, pupil scales them,
	// biasY tilts the resting gaze, mouth picks the SVG mouth shape. Covers all
	// nine states the CompanionExpression machine can resolve.
	const FACE_EXP = {
		// `state` is the CSS state category (idle | thinking | working | success |
		// error) that drives the aura / ring / tint layers — kept SEPARATE from
		// `mouth` so the working face can smile while still showing the working ring.
		idle: { eyeSY: 1.0, pupil: 1.0, biasY: 0.0, mouth: "idle", state: "idle" },
		sleepy: { eyeSY: 0.55, pupil: 0.92, biasY: 0.2, mouth: "idle", state: "idle" },
		listening: { eyeSY: 1.02, pupil: 1.12, biasY: -0.1, mouth: "idle", state: "idle" },
		thinking: { eyeSY: 0.95, pupil: 1.0, biasY: -0.85, mouth: "thinking", state: "thinking" },
		working: { eyeSY: 0.9, pupil: 0.92, biasY: 0.0, mouth: "smile", state: "working" },
		waiting: { eyeSY: 0.92, pupil: 1.04, biasY: -0.3, mouth: "thinking", state: "thinking" },
		success: { eyeSY: 0.52, pupil: 1.02, biasY: -0.22, mouth: "success", state: "success" },
		worried: { eyeSY: 1.12, pupil: 0.78, biasY: 0.14, mouth: "error", state: "error" },
		wince: { eyeSY: 1.16, pupil: 0.72, biasY: 0.16, mouth: "error", state: "error" },
	};
	const TREMOR_EXP = { error: 1, wince: 1, worried: 1 };

	// SVG mouth path per shape key (viewBox 0..100), verbatim from the design.
	function mouthFor(key) {
		switch (key) {
			case "thinking": return { d: "M41.5 62 Q50 59.5 58.5 62", fill: false, sw: 4.2 };
			case "working": return { d: "M39 61 Q50 68.5 61 61", fill: false, sw: 5 };
			// happy open smile while using a skill (the face stays friendly/engaged,
			// not just concentrating) — a touch gentler than the success grin.
			case "smile": return { d: "M34 58 Q50 65 66 58 Q61 78 50 78 Q39 78 34 58 Z", fill: true };
			case "success": return { d: "M30 56.5 Q50 63 70 56.5 Q64.5 83 50 83 Q35.5 83 30 56.5 Z", fill: true };
			case "error": return { d: "M35 61 Q50 71 65 61", fill: false, sw: 4.8 };
			// TTS lip-flap: a small open oval, alternated with the resting mouth.
			case "talk": return { d: "M41 60 Q50 57 59 60 Q59 71 50 71 Q41 71 41 60 Z", fill: true };
			default: return { d: "M33 59 Q50 73 67 59", fill: false, sw: 5 };
		}
	}

	function el(tag, cls, text) {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}
	function svg(tag) {
		return document.createElementNS(SVGNS, tag);
	}

	// ── the glossy "gel sphere" living face ─────────────────────────────────────
	// Builds one face (main OR a sub-agent). Geometry is % of the sphere (sized by
	// --sz), so the same DOM works at 178px and 54px. Refs + per-face animation
	// state are cached on node._face; stepFace() drives it each rAF frame.
	function buildFace(size) {
		const cmp = el("div", "cmp");
		cmp.style.setProperty("--sz", `${size}px`);
		cmp.appendChild(el("div", "cmp-aura"));
		cmp.appendChild(el("div", "cmp-ring"));
		const sphere = el("div", "cmp-sphere");
		const face = el("div", "cmp-face");
		const mkEye = (cls) => {
			const eye = el("div", `cmp-eye eye ${cls}`);
			// keep `.pupil` so the test-pinned gaze query (querySelectorAll(".pupil"))
			// still finds the pupils.
			const pup = el("div", "cmp-pupil pupil");
			pup.appendChild(el("div", "cmp-catch"));
			eye.appendChild(pup);
			return { eye, pup };
		};
		const L = mkEye("eye-l");
		const Rr = mkEye("eye-r");
		face.appendChild(L.eye);
		face.appendChild(Rr.eye);
		sphere.appendChild(face);
		const ms = svg("svg");
		ms.setAttribute("class", "cmp-mouth");
		ms.setAttribute("viewBox", "0 0 100 100");
		ms.setAttribute("preserveAspectRatio", "none");
		const mp = svg("path");
		ms.appendChild(mp);
		sphere.appendChild(ms);
		sphere.appendChild(el("div", "cmp-tint"));
		sphere.appendChild(el("div", "cmp-gloss"));
		sphere.appendChild(el("div", "cmp-spark"));
		cmp.appendChild(sphere);
		cmp._face = {
			sphere,
			eyeL: L.eye,
			eyeR: Rr.eye,
			pupL: L.pup,
			pupR: Rr.pup,
			mouth: ms,
			mouthPath: mp,
			size,
			gazeX: 0,
			gazeY: 0,
			cur: { x: 0, y: 0 },
			sacc: { x: 0, y: 0 },
			nextSacc: 0,
			blinkStart: -9999,
			nextBlink: 700 + Math.random() * 800,
			lastMouth: "",
			mouthTo: "",
			mouthT: 1,
		};
		return cmp;
	}

	// Paint a face with a theme preset (mint | teal | blue | violet | cyan) via the
	// per-instance CSS vars the gel gradient + glow + mouth colour read.
	function themeFace(cmp, themeKey) {
		const th = THEMES[themeKey] || THEMES.mint;
		const s = cmp.style;
		s.setProperty("--s1", th.s1);
		s.setProperty("--s2", th.s2);
		s.setProperty("--s3", th.s3);
		s.setProperty("--s4", th.s4);
		s.setProperty("--glow", th.glow);
		s.setProperty("--accent", th.accent);
		s.setProperty("--mouth", th.mouth);
	}

	// One frame of face physics: gaze easing, blink (+ double-blink), breathing,
	// squash pop, error tremor, per-expression eye-squash + pupil-scale, and the
	// morphing mouth. `popValue` is the externally-stepped squash (the main face
	// gets it from CompanionSpring; sub-agents pass 0 and breathe only). `gaze` is
	// a viewport target {x,y} or null (→ idle saccades). Honours reduced-motion.
	function stepFace(cmp, expr, now, opts) {
		const f = cmp._face;
		if (!f) return;
		const reduced = opts.reduced;
		const dt = opts.dt || 0;
		const ep = FACE_EXP[expr] || FACE_EXP.idle;
		const t = now / 1000;

		// ── desired gaze (fraction -1..1) ──
		let desX = 0;
		let desY = 0;
		const tgt = !reduced && opts.gaze ? opts.gaze : null;
		if (tgt) {
			const r = f.sphere.getBoundingClientRect();
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			const vx = tgt.x - cx;
			const vy = tgt.y - cy;
			const dist = Math.hypot(vx, vy) || 1;
			const mg = Math.min(1, dist / 260);
			desX = (vx / dist) * mg;
			desY = (vy / dist) * mg;
		} else if (!reduced) {
			if (now > f.nextSacc) {
				if (Math.random() < 0.32) { f.sacc.x = 0; f.sacc.y = 0; }
				else { f.sacc.x = (Math.random() * 2 - 1) * 0.7; f.sacc.y = (Math.random() * 2 - 1) * 0.45; }
				f.nextSacc = now + 1300 + Math.random() * 2200;
			}
			desX = f.sacc.x;
			desY = f.sacc.y;
		}
		desY += ep.biasY;
		const dlen = Math.hypot(desX, desY);
		if (dlen > 1.05) { desX = (desX / dlen) * 1.05; desY = (desY / dlen) * 1.05; }
		// Frame-rate-independent glide (rate 10.5 ≈ the old 0.16/frame at 60 fps),
		// so gaze feels identical at 60 fps but consistent at 30/120.
		f.cur.x = SP ? SP.damp(f.cur.x, desX, 10.5, dt, reduced) : desX;
		f.cur.y = SP ? SP.damp(f.cur.y, desY, 10.5, dt, reduced) : desY;
		// pupil travel in px (17% of eye width), then glide via the damp below.
		const ew = f.size * 0.185;
		const dx = f.cur.x * 0.17 * ew;
		const dy = f.cur.y * 0.17 * ew;
		// rate 12 ≈ the old 0.18/frame at 60 fps; snaps under reduced-motion.
		const gazeX = SP ? SP.damp(f.gazeX, dx, 12, dt, reduced) : dx;
		const gazeY = SP ? SP.damp(f.gazeY, dy, 12, dt, reduced) : dy;
		f.gazeX = gazeX;
		f.gazeY = gazeY;

		// ── blink (occasional double) ──
		if (now > f.nextBlink) {
			f.blinkStart = now;
			f.nextBlink = now + (Math.random() < 0.18 ? 220 : 2600 + Math.random() * 3600);
		}
		const bAge = now - f.blinkStart;
		let blink = 1;
		if (bAge >= 0 && bAge < 150 && !reduced) blink = 1 - Math.sin((bAge / 150) * Math.PI) * 0.93;

		// ── breathing + external pop + tremor → sphere transform ──
		let sx = 1;
		let sy = 1;
		let ty = 0;
		let tx = 0;
		if (!reduced) {
			const b = Math.sin(t * 1.5);
			sx = 1 + b * 0.013;
			sy = 1 - b * 0.013;
			ty = Math.sin(t + 0.4) * (f.size * 0.022);
		}
		const e = Math.max(-0.12, Math.min(0.12, (opts.popValue || 0) * 0.04));
		sx *= 1 + e;
		sy *= 1 - e;
		// ~16 Hz (was ~22 Hz): same ±1.5px shake, but clear of the 30 Hz Nyquist
		// of a 60 Hz display so it reads as a smooth tremor, not aliased buzz.
		if (TREMOR_EXP[expr] && !reduced) tx += Math.sin(now / 64) * 1.5;
		f.sphere.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;

		// ── eyes / pupils ──
		const eyeT = `scaleY(${(blink * ep.eyeSY).toFixed(3)})`;
		f.eyeL.style.transform = eyeT;
		f.eyeR.style.transform = eyeT;
		const pupT = `translate(-50%, -50%) translate(${gazeX.toFixed(2)}px, ${gazeY.toFixed(2)}px) scale(${ep.pupil.toFixed(3)})`;
		f.pupL.style.transform = pupT;
		f.pupR.style.transform = pupT;

		// ── state class for the aura / ring / tint layers (idle | thinking |
		// working | success | error) — independent of the mouth shape ──
		if (ep.state !== f.lastExp) {
			f.lastExp = ep.state;
			cmp.setAttribute("data-exp", ep.state);
		}

		// ── mouth: morph between shapes with a quick vertical squash-and-reform
		// (the shapes mix stroke vs fill, so a per-point path tween is fragile;
		// a scaleY dip hides the geometry swap and reads as the mouth changing).
		const mouthKey = f.speaking && f.talkOpen ? "talk" : ep.mouth;
		if (mouthKey !== f.mouthTo) {
			f.mouthTo = mouthKey;
			// First-ever paint (or reduced-motion) is instant; otherwise dip.
			if (reduced || f.lastMouth === "") {
				f.mouthT = 1;
				paintMouth(f, mouthKey);
			} else {
				f.mouthT = 0;
			}
		}
		if (f.mouthT < 1) {
			const prev = f.mouthT;
			f.mouthT = SP ? Math.min(1, SP.damp(f.mouthT, 1.04, 22, dt, reduced)) : 1;
			// Swap the path at the thinnest point (crossing 0.5) so it's unseen.
			if (prev < 0.5 && f.mouthT >= 0.5) paintMouth(f, f.mouthTo);
			const sc = 1 - Math.sin(Math.min(1, f.mouthT) * Math.PI) * 0.8;
			f.mouth.style.transform = `scaleY(${sc.toFixed(3)})`;
		} else if (f.mouth.style.transform) {
			f.mouth.style.transform = "";
		}
	}

	/** Paint the mouth path/class/stroke for a shape key (the geometry swap). */
	function paintMouth(f, key) {
		f.lastMouth = key;
		const m = mouthFor(key);
		f.mouthPath.setAttribute("d", m.d);
		if (m.fill) {
			f.mouthPath.setAttribute("class", "fill");
			f.mouthPath.removeAttribute("stroke-width");
		} else {
			f.mouthPath.setAttribute("class", "");
			f.mouthPath.setAttribute("stroke-width", String(m.sw));
		}
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
				return st.waitingLabel
					? sanitizeText(st.waitingLabel)
					: "Waiting for your approval…";
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

	// ── Avatar renderer registry ────────────────────────────────────────────────
	// An "avatar" is a face TYPE (the gel sphere, or a future robot). Each renderer
	// is { key, label, build(opts) -> a `.cmp` node whose `_face.sphere` is the
	// visible orb, step(node, expr, now, opts) }. The registry lets a picker swap the
	// face type while the engine, expression machine, gaze, mouth-sync, springs,
	// --accent and light/dark all stay central. The gel sphere is the default; an
	// unknown key falls back to it. `build` returns just the face — the callers wrap
	// it (main avatar antenna / sub-agent node).
	const GEL_AVATAR = {
		key: "gel",
		label: "Gel Sphere",
		build(opts) {
			const cmp = buildFace((opts && opts.size) || 178);
			themeFace(cmp, (opts && opts.theme) || "mint");
			return cmp;
		},
		step: stepFace,
	};

	// ── Robot avatars (ported from the "Robotic Faces" design) ──────────────────
	// A curated set of CSS-state-driven robot faces. They share ONE step (robotStep)
	// and ONE expression mapping; each variant differs only in build markup + CSS.
	// The art is self-coloured (reads on light + dark, like the gel sphere); the
	// glow/eyes/mouth follow the brand --accent. Native art is 188px, scaled to the
	// requested size so the same markup serves the 178px main face and 54px subs.
	const ROBOT_NATIVE = 188;
	// engine state (9) → design state (7).
	function mapRobotExp(expr) {
		switch (expr) {
			case "sleepy":
				return "sleepy";
			case "listening":
				return "happy";
			case "thinking":
			case "waiting":
				return "thinking";
			case "working":
				return "working";
			case "success":
				return "success";
			case "worried":
			case "wince":
				return "error";
			default:
				return "idle";
		}
	}
	function robotOrb(extra) {
		const o = el("div", `orb${extra ? ` ${extra}` : ""}`);
		o.setAttribute("data-body", "");
		o.appendChild(el("div", "gloss"));
		return o;
	}
	function trackEye(cls) {
		const e = el("div", cls);
		e.setAttribute("data-track", "");
		return e;
	}
	// Each builder appends its markup to `scaler` and returns the [data-body] orb.
	const ROBOT_VARIANTS = {
		halo(scaler) {
			const ant = el("div", "antenna");
			ant.appendChild(el("i", "glow"));
			scaler.appendChild(ant);
			const orb = robotOrb("");
			orb.appendChild(el("div", "ring"));
			orb.appendChild(trackEye("eye l"));
			orb.appendChild(trackEye("eye r"));
			orb.appendChild(el("div", "mouth"));
			scaler.appendChild(orb);
			return orb;
		},
		visor(scaler) {
			const orb = robotOrb("teal");
			const visor = el("div", "visor");
			visor.appendChild(trackEye("veye l"));
			visor.appendChild(trackEye("veye r"));
			visor.appendChild(el("div", "vsmile"));
			orb.appendChild(visor);
			scaler.appendChild(orb);
			return orb;
		},
		cylon(scaler) {
			const orb = robotOrb("");
			const band = el("div", "band");
			band.appendChild(el("div", "slit"));
			orb.appendChild(band);
			orb.appendChild(el("div", "mouth"));
			scaler.appendChild(orb);
			return orb;
		},
		lcd(scaler) {
			const orb = robotOrb("");
			const screen = el("div", "screen");
			const eyes = el("div", "eyes");
			eyes.appendChild(trackEye("reye"));
			eyes.appendChild(trackEye("reye"));
			screen.appendChild(eyes);
			const smile = el("div", "smile");
			for (let i = 0; i < 5; i++) smile.appendChild(el("span"));
			screen.appendChild(smile);
			orb.appendChild(screen);
			scaler.appendChild(orb);
			return orb;
		},
	};
	function buildRobotFace(size, variantKey) {
		const px = size || 178;
		const cmp = el("div", `cmp robot-face rf-${variantKey}`);
		cmp.style.setProperty("--sz", `${px}px`);
		cmp.style.width = `${px}px`;
		cmp.style.height = `${px}px`;
		const scaler = el("div", "rf-scale");
		scaler.style.transform = `scale(${(px / ROBOT_NATIVE).toFixed(4)})`;
		const body = ROBOT_VARIANTS[variantKey](scaler);
		cmp.appendChild(scaler);
		cmp._face = {
			sphere: body, // the [data-body] orb (gets data-avatar + the ping ring)
			size: px,
			phase: Math.random() * 6.28,
			sx: 0,
			sy: 0,
			nextSacc: 0,
			bNext: 0,
			bUntil: 0,
		};
		return cmp;
	}
	// One frame for a robot face: map expression → data-exp, ease gaze (from the
	// central look-toward target, NOT a private mousemove), breathe/tilt/tremor, and
	// blink — all CSS-var driven (--gx/--gy/--blink) + a transform on the orb.
	function robotStep(cmp, expr, now, opts) {
		const f = cmp._face;
		if (!f) return;
		const reduced = opts.reduced;
		const exp = mapRobotExp(expr);
		if (cmp.dataset.exp !== exp) cmp.dataset.exp = exp;
		const body = f.sphere;
		const t = now / 1000;
		let gx = 0;
		let gy = 0;
		const tgt = !reduced && opts.gaze ? opts.gaze : null;
		if (tgt) {
			const r = body.getBoundingClientRect();
			const dx = tgt.x - (r.left + r.width / 2);
			const dy = tgt.y - (r.top + r.height / 2);
			const dist = Math.hypot(dx, dy) || 1;
			const m = Math.min(1, dist / 330);
			gx = (dx / dist) * m * 6;
			gy = (dy / dist) * m * 6;
		} else if (!reduced) {
			if (now > f.nextSacc) {
				if (Math.random() < 0.32) {
					f.sx = 0;
					f.sy = 0;
				} else {
					f.sx = (Math.random() * 2 - 1) * 5;
					f.sy = (Math.random() * 2 - 1) * 3;
				}
				f.nextSacc = now + 1300 + Math.random() * 2400;
			}
			gx = f.sx;
			gy = f.sy;
		}
		if (exp === "thinking") {
			gy -= 5;
			gx *= 0.5;
		} else if (exp === "sleepy") {
			gy = 6;
			gx *= 0.3;
		} else if (exp === "success" || exp === "happy") {
			gy += 1;
		}
		cmp.style.setProperty("--gx", `${gx.toFixed(2)}px`);
		cmp.style.setProperty("--gy", `${gy.toFixed(2)}px`);
		let by = 0;
		let bs = 1;
		let bx = 0;
		let rot = 0;
		if (!reduced) {
			by = Math.sin(t * 1.25 + f.phase) * 2.4 + Math.sin(t * 0.66 + f.phase) * 1.3;
			bs = 1 + Math.sin(t * 1.25 + f.phase) * 0.011;
			rot = gx * 0.45;
			if (exp === "sleepy") {
				by += Math.sin(t * 0.8 + f.phase) * 1.5;
				bs = 1;
				rot *= 0.3;
			}
			if (exp === "error") bx = Math.sin(now / 64) * 1.3;
			if (exp === "working") bs += 0.004;
		}
		body.style.transform = `translate(${bx.toFixed(2)}px,${by.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${bs.toFixed(4)})`;
		if (!reduced && exp !== "sleepy") {
			if (now > f.bNext) {
				f.bUntil = now + 120;
				f.bNext = now + (Math.random() < 0.18 ? 250 : 2800 + Math.random() * 4200);
			}
			cmp.style.setProperty("--blink", now < f.bUntil ? "0.1" : "1");
		} else {
			cmp.style.setProperty("--blink", "1");
		}
	}
	function makeRobot(key, label, variantKey) {
		return {
			key,
			label,
			build(opts) {
				return buildRobotFace((opts && opts.size) || 178, variantKey);
			},
			step: robotStep,
		};
	}

	const AVATARS = {
		gel: GEL_AVATAR,
		"robot-halo": makeRobot("robot-halo", "Robot · Halo", "halo"),
		"robot-visor": makeRobot("robot-visor", "Robot · Visor", "visor"),
		"robot-cylon": makeRobot("robot-cylon", "Robot · Cylon", "cylon"),
		"robot-lcd": makeRobot("robot-lcd", "Robot · LCD", "lcd"),
	};
	const DEFAULT_AVATAR_KEY = "gel";
	// The active face type for ALL faces (main + sub-agents). PR1 leaves it at the
	// default; the picker (PR2) sets it from config/localStorage and live-swaps.
	let activeAvatarKey = DEFAULT_AVATAR_KEY;
	function getAvatar(key) {
		return AVATARS[key] || AVATARS[DEFAULT_AVATAR_KEY];
	}
	function avatarList() {
		return Object.keys(AVATARS).map((k) => ({ key: k, label: AVATARS[k].label }));
	}

	function buildAvatar(themeKey) {
		const wrap = el("div", "avatar");
		const antenna = el("div", "antenna");
		antenna.appendChild(el("span"));
		antenna.appendChild(el("span"));
		antenna.appendChild(el("span"));
		wrap.appendChild(antenna);
		const cmp = getAvatar(activeAvatarKey).build({ size: 178, theme: themeKey || "mint" });
		// data-avatar stays on the transformed/visible orb (the sphere) so the mood
		// filter, the physics transform, and the gaze/tether lookups all target it.
		cmp._face.sphere.setAttribute("data-avatar", "1");
		wrap.appendChild(cmp);
		return wrap;
	}

	function mount(root, cfg) {
		cfg = cfg || {};
		const docEl = root.ownerDocument.documentElement;
		if (cfg.accent) docEl.style.setProperty("--accent", cfg.accent);
		// Intentionally do NOT inject the brand `--bg`: styles.css owns the
		// per-theme ground (light :root / dark html.dark). An inline `--bg` here
		// beats the stylesheet and froze the companion to the brand's black bg,
		// breaking light mode. Accent is theme-independent, so it stays.

		const engine = new window.CompanionEngine();
		engine.start(cfg);
		const reduced = SP ? SP.prefersReducedMotion() : false;

		// ── DOM skeleton (built once) ──
		const fit = el("div", "fit");
		const home = el("div", "home");
		const tetherSvg = svg("svg");
		tetherSvg.setAttribute("class", "tether-svg");
		home.appendChild(tetherSvg);

		// Avatar choice: per-user localStorage["paw-avatar"] wins over the brand /
		// config default (cfg.avatar); unknown keys fall back to the gel sphere.
		function isKnownAvatar(k) {
			return !!k && getAvatar(k).key === k;
		}
		function resolveAvatarKey() {
			try {
				const stored = window.localStorage.getItem("paw-avatar");
				if (isKnownAvatar(stored)) return stored;
			} catch (e) {
				/* localStorage blocked — fall through to config/default */
			}
			return isKnownAvatar(cfg.avatar) ? cfg.avatar : DEFAULT_AVATAR_KEY;
		}
		activeAvatarKey = resolveAvatarKey();

		// Wrap-dock composition: centered avatar → sub-agents → skills wrapping →
		// greeting → dynamic subtitle → ops feed (no stat cards).
		const avatarZone = el("div", "avatar-zone");
		avatarZone.appendChild(buildAvatar(cfg.faceTheme));
		// Mood layer: a slow real-telemetry health scalar (0..1, injected from the
		// 1-hour tool_log failure rate) varies SATURATION / BRIGHTNESS / POSTURE
		// only — the avatar hue stays brand-driven (the white-label rule).
		const mood =
			typeof cfg.moodScalar === "number"
				? Math.max(0, Math.min(1, cfg.moodScalar))
				: 1;
		function applyMood() {
			const av = avatarZone.firstChild;
			const ball = av?.querySelector("[data-avatar]");
			if (ball) {
				ball.style.filter = `saturate(${(0.7 + 0.3 * mood).toFixed(2)}) brightness(${(0.85 + 0.15 * mood).toFixed(2)})`;
			}
			if (av) av.style.transform = `translateY(${((1 - mood) * 6).toFixed(1)}px)`;
		}
		applyMood();
		// Live avatar swap: the picker (a same-origin page) writes paw-avatar; the
		// `storage` event reaches this iframe → rebuild the main avatar in place (no
		// reload, no flash). Sub-agents pick up the new key when next (re)built.
		function swapAvatar(key) {
			if (!isKnownAvatar(key) || key === activeAvatarKey) return;
			activeAvatarKey = key;
			const old = avatarZone.firstChild;
			if (old) avatarZone.removeChild(old);
			avatarZone.appendChild(buildAvatar(cfg.faceTheme));
			applyMood();
		}
		function onAvatarStorage(e) {
			if (e.key === "paw-avatar") swapAvatar(e.newValue || DEFAULT_AVATAR_KEY);
		}
		if (window.addEventListener) {
			window.addEventListener("storage", onAvatarStorage);
		}
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

		// On-brand status chip: a breathing LED + the REAL live skill count, pinned
		// to the visible TOP-LEFT corner. It lives on `root` (the full-iframe,
		// non-scaled layer) — NOT inside `.home`, which is a narrow column centered
		// by #companion-root and shrunk by scaleToFit, so a chip in there floats
		// next to the avatar and drifts as the screen gets busier. count refreshed
		// in buildDock.
		const statusChip = el("div", "status-chip");
		statusChip.appendChild(el("span", "led"));
		const statusText = el("span", "status-text", "Online");
		statusChip.appendChild(statusText);

		fit.appendChild(home);
		root.appendChild(fit);
		root.appendChild(statusChip);

		window.addEventListener("message", (e) => {
			const d = e && e.data;
			if (!d) return;
			if (d.type === "paw:tool") engine.ingestTool(d);
			else if (d.type === "paw:input") engine.ingestInput(d.state);
			else if (d.type === "paw:ambient") {
				engine.setWaiting(d.pendingApprovals || 0, d.pendingApprovalsLabel);
				engine.setNotifications(d.unreadByKind || {});
			}
			else if (d.type === "paw:speak") onSpeak(d.phase);
		});

		// TTS mouth-sync: lip-flap the SVG mouth while speaking (masks the MOUTH only
		// — eyes keep their expression). Sets flags read by stepFace's mouth morph.
		// Driven by real SpeechSynthesis events relayed via postMessage.
		function onSpeak(phase) {
			const av = avatarZone.firstChild;
			const f = av && av.querySelector(".cmp") && av.querySelector(".cmp")._face;
			if (!f) return;
			if (phase === "start") {
				f.speaking = true;
				av.classList.add("speaking");
			} else if (phase === "boundary") {
				f.talkOpen = !f.talkOpen;
			} else if (phase === "end") {
				f.speaking = false;
				f.talkOpen = false;
				av.classList.remove("speaking");
			}
		}

		// ── skill inbox + approve/decline ──
		// Clicking a skill pill opens an inbox of that skill's notifications +
		// pending approvals. The companion is same-origin, so the controller talks
		// to /api/* directly; badges flow back through the engine (the single source
		// renderBadges reads) so a live paw:ambient tick reconciles by REPLACE.
		const inbox =
			INBOX && INBOX.create
				? INBOX.create({
						doc: root.ownerDocument,
						host: root,
						fetch: (u, o) => window.fetch(u, o),
						getSkills: () => engine.getState().skills || [],
						getUnreadByKind: () => engine.getState().unreadByKind || {},
						setUnreadByKind: (m) => engine.setNotifications(m),
						setPending: (n, label) => engine.setWaiting(n, label),
					})
				: null;

		function onDockClick(ev) {
			if (!inbox) return;
			const t = ev.target;
			const pill = t && t.closest ? t.closest(".pill") : null;
			const key = pill && pill.getAttribute("data-key");
			if (key) inbox.open(key);
		}
		function onDocKeydown(ev) {
			if (inbox && ev.key === "Escape" && inbox.isOpen()) inbox.close();
		}
		function onDocClick(ev) {
			if (!inbox || !inbox.isOpen()) return;
			const t = ev.target;
			if (
				t &&
				t.closest &&
				(t.closest(".inbox-panel") ||
					t.closest(".pill") ||
					t.closest(".inbox-fallback-chip"))
			)
				return;
			inbox.close();
		}
		if (inbox) {
			wrapDock.addEventListener("click", onDockClick);
			root.ownerDocument.addEventListener("keydown", onDocKeydown);
			root.ownerDocument.addEventListener("click", onDocClick);
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
		let captionFadeTimer = null;
		let renderedTs = [];
		let scale = 1;
		// `.fit` starts visibility:hidden (styles.css) and is revealed on the first
		// successful fit, so a 0-height first paint never flashes the orb clipped.
		let fitted = false;
		const tetherEls = new Map();
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
			// Keep the status chip's count in sync with the live skill set.
			statusText.textContent = `Online · ${n} ${n === 1 ? "skill" : "skills"}`;
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
			// Each little agent is the SAME gel face, just small (54px) and themed a
			// distinct colour (blue/violet/cyan) by spawn order — so it reads as its
			// own agent, linked to the mint orchestrator.
			const cmp = getAvatar(activeAvatarKey).build({
				size: 54,
				theme: SUB_THEME_CYCLE[a.gradIndex % SUB_THEME_CYCLE.length],
			});
			node.appendChild(cmp); // node.firstChild = the face (carries data-subagent)
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
			// Crossfade on change (fade out → swap → fade in) so captions don't
			// hard-cut. A single timer means the latest text always wins.
			const text = captionFor(st, expr);
			if (text !== lastCaption) {
				lastCaption = text;
				if (reduced) {
					subtitle.textContent = text;
				} else {
					subtitle.style.opacity = "0";
					if (captionFadeTimer) clearTimeout(captionFadeTimer);
					captionFadeTimer = setTimeout(() => {
						subtitle.textContent = lastCaption;
						subtitle.style.opacity = "1";
						captionFadeTimer = null;
					}, 150);
				}
			}
		}

		// Resolve the MAIN face's gaze target to viewport px (null → idle saccades).
		// Mirrors gazeTarget()'s priority: active pill > acting sub > input; the
		// per-face easing lives in stepFace.
		function mainGazePx(st) {
			const av = avatarZone.firstChild;
			const cmp = av && av.querySelector(".cmp");
			if (!cmp || !cmp._face) return null;
			const t = gazeTarget(st, st.expression);
			const ctr = (el2) => {
				const r = el2.getBoundingClientRect();
				return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			};
			if (t.kind === "pill") {
				const p = pillByKey.get(t.key);
				if (p) return ctr(p);
			} else if (t.kind === "sub") {
				const node = subRow.children[t.idx];
				if (node?.firstChild) return ctr(node.firstChild);
			} else if (t.kind === "input") {
				const b = cmp._face.sphere.getBoundingClientRect();
				return { x: b.left + b.width / 2, y: b.top + b.height / 2 + 220 };
			}
			return null;
		}

		// Each little agent gets its own physics: it looks toward the orchestrator
		// (or, while acting, toward the skill pill that tethers to it), wears an
		// expression from its live status (working / success / wince), and blinks.
		function stepSubs(st, now, dt) {
			const nodes = subRow.querySelectorAll("[data-subagent]");
			if (!nodes || !nodes.length) return;
			const mainSphere = avatarZone.firstChild.querySelector("[data-avatar]");
			let mainCtr = null;
			if (mainSphere) {
				const r = mainSphere.getBoundingClientRect();
				mainCtr = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			}
			nodes.forEach((cmp) => {
				if (!cmp._face) return;
				const idx = Number.parseInt(cmp.getAttribute("data-subagent"), 10);
				const a = st.agents && st.agents[idx];
				let expr = "idle";
				let gaze = mainCtr;
				if (a) {
					if (a.status === "done") expr = a.ok === false ? "wince" : "success";
					else if (a.working) {
						expr = "working";
						const pill = home.querySelector(`[data-tether="sub${idx}"]`);
						if (pill) {
							const r = pill.getBoundingClientRect();
							gaze = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
						}
					}
				}
				getAvatar(activeAvatarKey).step(cmp, expr, now, { gaze, popValue: 0, reduced, dt });
			});
		}

		function applyPhysics(st) {
			const now = Date.now();
			const dt = lastTs ? (now - lastTs) / 1000 : 0;
			lastTs = now;
			if (SP) SP.step(pop, 0, dt, { reduced });
			const av = avatarZone.firstChild;
			const mainCmp = av && av.querySelector(".cmp");
			if (mainCmp) {
				getAvatar(activeAvatarKey).step(mainCmp, st.expression || "idle", now, {
					gaze: mainGazePx(st),
					popValue: pop.value,
					reduced,
					dt,
				});
			}
			stepSubs(st, now, dt);
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

			// Each tether carries a STABLE key so paintTethers can reuse the same
			// <path>/particle across frames (no teardown → particles glide on).
			const skills = [];
			home.querySelectorAll("[data-tether]").forEach((node, i) => {
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
				if (d) skills.push({ key: node.getAttribute("data-key") || `i${i}`, d });
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
				if (d) links.push({ key: k, d, working: !!t.working });
			});
			return { skills, links };
		}

		// Reconcile tethers against persistent keyed elements instead of tearing
		// the whole SVG down each paint. Reusing the <path>/particle keeps each
		// <animateMotion> running (no particle restart/flicker) and lets a line
		// track its orb smoothly as it moves — the geometry just updates in place.
		function paintTethers(st) {
			const { skills, links } = computeTethers(st);
			const items = [];
			for (const l of links)
				items.push({
					key: `lk:${l.key}`,
					d: l.d,
					cls: `agent-link${l.working ? " working" : ""}`,
					r: 2.6,
					dur: "1.3s",
					particle: l.working,
				});
			for (const s of skills)
				items.push({ key: `sk:${s.key}`, d: s.d, cls: "tether-line", r: 3, dur: "1.5s", particle: true });

			const seen = new Set();
			for (const it of items) {
				seen.add(it.key);
				let e = tetherEls.get(it.key);
				if (!e) {
					const path = svg("path");
					tetherSvg.appendChild(path);
					e = { path, particle: null, lastD: "", lastCls: "", particleD: "" };
					tetherEls.set(it.key, e);
				}
				if (it.d !== e.lastD) {
					e.path.setAttribute("d", it.d);
					e.lastD = it.d;
				}
				if (it.cls !== e.lastCls) {
					e.path.setAttribute("class", it.cls);
					e.lastCls = it.cls;
				}
				if (it.particle) {
					if (!e.particle) {
						e.particle = particle(it.d, it.r, it.dur);
						tetherSvg.appendChild(e.particle);
						e.particleD = it.d;
					} else if (it.d !== e.particleD && e.particle._motion) {
						// Only re-path when the geometry actually moved (steady state
						// leaves the running particle untouched → no restart).
						e.particle._motion.setAttribute("path", it.d);
						e.particleD = it.d;
					}
				} else if (e.particle) {
					e.particle.remove();
					e.particle = null;
				}
			}
			for (const [key, e] of tetherEls) {
				if (seen.has(key)) continue;
				e.path.remove();
				if (e.particle) e.particle.remove();
				tetherEls.delete(key);
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
			c._motion = m;
			return c;
		}

		function scaleToFit() {
			// Measure at natural size, then ask the pure helper for the fit scale.
			const prev = fit.style.transform;
			fit.style.transform = "scale(1)";
			const s = window.CompanionFit.computeFitScale(
				root.clientWidth,
				root.clientHeight,
				home.offsetWidth,
				home.offsetHeight,
			);
			// Unmeasurable (0 / non-finite dimension — e.g. the tab was display:none
			// so the iframe never laid out). KEEP the last good transform rather than
			// snapping to natural size (scale(1)), which centered+clips the orb's head.
			if (s == null) {
				fit.style.transform = prev;
				return;
			}
			scale = s;
			fit.style.transform = s === 1 ? "" : `scale(${s})`;
			// Reveal once the first real fit lands (see `fitted` / styles.css .fit).
			if (!fitted) {
				fitted = true;
				fit.style.visibility = "visible";
			}
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
			// Repaint tethers when the topology changes (skills/agents in or out)
			// OR every frame while sub-agents are present (they animate, so their
			// lines must track) — keyed reuse makes this cheap and flicker-free.
			const ak = activeKey(st);
			const liveAgents = !!home.querySelector("[data-subagent]");
			if (ak !== lastActiveKey || liveAgents) {
				lastActiveKey = ak;
				paintTethers(st);
			}
			raf = window.requestAnimationFrame(frame);
		}
		frame();
		// Fix B: enable the smooth fit-scale transition AFTER the initial layout,
		// so the companion snaps to size on mount instead of animating a zoom-in.
		// (.fit only — the breathing orb is .cmp-sphere, still driven by the rAF
		// loop and never transitioned.) Double rAF lets the first transform paint.
		// Gated on `fitted` (not a plain double-rAF) so a delayed first layout
		// (e.g. the Home tab mounting while display:none) can never animate the
		// snap scale(1)->s once it becomes visible.
		(function enableFitAnimAfterFirstFit() {
			if (fitted) {
				window.requestAnimationFrame(() => fit.classList.add("fit-anim"));
				return;
			}
			window.requestAnimationFrame(enableFitAnimAfterFirstFit);
		})();
		if (typeof ResizeObserver === "function") {
			new ResizeObserver(scaleToFit).observe(root);
		}

		return {
			stop() {
				engine.stop();
				if (raf) window.cancelAnimationFrame(raf);
				if (captionFadeTimer) clearTimeout(captionFadeTimer);
				if (window.removeEventListener) {
					window.removeEventListener("storage", onAvatarStorage);
				}
				if (inbox) {
					wrapDock.removeEventListener("click", onDockClick);
					root.ownerDocument.removeEventListener("keydown", onDocKeydown);
					root.ownerDocument.removeEventListener("click", onDocClick);
					inbox.destroy();
				}
			},
		};
	}

	window.Companion = {
		mount,
		gazeTarget,
		captionFor,
		visibleAgents,
		// Avatar registry surface (the picker enumerates `avatars`; `getAvatar`
		// resolves a key with default fallback).
		avatars: avatarList,
		getAvatar,
	};
})();
