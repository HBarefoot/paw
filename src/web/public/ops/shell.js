/* Agent Ops — app shell (vanilla port of the design's app.jsx). Builds the grid
   (top bar / mode rail / stage / scrub / inspector) into a mount node, wires the
   shared interaction contract, runs one frame loop that drives the active lens +
   throttled panels, and owns the scrub/review clock. Lenses are factories on
   window (VizStream now; VizSwarm in PR B); modes whose factory is missing render
   as disabled "soon" rail entries. Exposed as window.OpsShell. */
(function () {
	"use strict";

	var MODES = [
		{ id: "swarm", t: "Swarm", d: "Agent highway network", glyph: "swarm",
			comp: function () { return window.VizSwarm; },
			head: "The orchestrator spawns a swarm of agents — one per mission. Each agent runs traffic-scaled highways to the skills it uses: calls stream outbound, results return in the opposite lane." },
		{ id: "stream", t: "Stream", d: "Swimlane flow", glyph: "stream",
			comp: function () { return window.VizStream; },
			head: "Each operation is a bar on a moving time axis, one lane per tool. Width = real duration. Scrub the timeline to rewind." },
		{ id: "pipeline", t: "Pipeline", d: "Task threads", glyph: "pipeline",
			comp: function () { return window.VizPipeline; },
			head: "Every request becomes a thread advancing from intake to result through its tool chain." },
		{ id: "matrix", t: "Matrix", d: "Density grid", glyph: "matrix",
			comp: function () { return window.VizMatrix; },
			head: "Tool × time heat field — scan bursts, idle gaps and error clusters across all servers at once." },
		{ id: "radar", t: "Radar", d: "Recency sweep", glyph: "radar",
			comp: function () { return window.VizRadar; },
			head: "Sonar of recent activity. Fresh contacts appear at the rim and drift inward as they age." },
		{ id: "pulse", t: "Pulse", d: "Channel mixer", glyph: "pulse",
			comp: function () { return window.VizPulse; },
			head: "A heartbeat per server — mirrored waveform plus a live level meter." },
	];
	var SPEEDS = [0.5, 1, 2, 4];

	function el(id, root) {
		return (root || document).getElementById(id);
	}

	function mount(root, cfg) {
		cfg = cfg || {};
		var engine = window.AgentOps;
		var ui = window.OpsUI;
		var modeById = {};
		MODES.forEach(function (m) {
			modeById[m.id] = m;
		});
		function isEnabled(m) {
			return typeof m.comp() === "function";
		}
		var firstEnabled = MODES.filter(isEnabled)[0];

		var state = {
			modeId: firstEnabled ? firstEnabled.id : "stream",
			enabled: new Set(),
			selected: null,
			viewTime: "live",
			inspector: true,
		};
		var enabledInit = false;
		var lens = null;
		var chipsBuilt = false;
		var lastFeedMax = 0;

		// ---- DOM skeleton -----------------------------------------------------
		root.className = "ops-app";
		root.innerHTML =
			'<div class="topbar">' +
			'<div class="brand"><div class="logo"></div><div class="name" id="ops-brand"></div>' +
			'<span class="live-pill"><span class="dot" id="ops-live-dot"></span><span id="ops-live-txt">LIVE</span></span></div>' +
			'<div class="model-chip"><span class="dot" style="background:#3fe08f"></span><span id="ops-model"></span></div>' +
			'<div class="top-stats">' +
			'<div class="stat"><span class="v tnum" id="ops-tps">0</span><span class="k">ops / sec</span></div>' +
			'<div class="stat"><span class="v tnum" id="ops-active">0</span><span class="k">in flight</span></div>' +
			'<div class="stat"><span class="v tnum" id="ops-err">0%</span><span class="k">error rate</span></div>' +
			'<div class="stat"><span class="v tnum" id="ops-uptime">00:00:00</span><span class="k">uptime</span></div>' +
			'<div class="ctrl"><button class="btn" id="ops-play" title="Play / pause">❚❚</button>' +
			'<div class="seg" id="ops-speed"></div>' +
			'<button class="btn on" id="ops-insp-toggle" title="Toggle inspector">▦</button></div>' +
			"</div></div>" +
			'<div class="rail" id="ops-rail"></div>' +
			'<div class="stage" id="ops-stage"><div class="stage-head"><div class="t" id="ops-stage-t"></div>' +
			'<div class="d" id="ops-stage-d"></div></div><div class="viz-root"><canvas id="ops-canvas"></canvas></div></div>' +
			'<div class="scrub"><span class="lbl">Timeline</span>' +
			'<div class="scrub-track" id="ops-scrub-track"><canvas id="ops-scrub-canvas"></canvas>' +
			'<div class="cursor" id="ops-scrub-cursor"></div></div>' +
			'<span class="now-badge" id="ops-scrub-badge"></span>' +
			'<button class="btn live-btn on" id="ops-live-btn">JUMP TO LIVE</button></div>' +
			'<div class="insp" id="ops-insp">' +
			'<div class="sec"><div class="sec-hd"><span>Filter · tools</span>' +
			'<span id="ops-showall" style="cursor:pointer;color:#3fe08f;display:none">show all</span></div>' +
			'<div class="chips" id="ops-chips"></div></div>' +
			'<div class="sec" id="ops-detail"></div>' +
			'<div class="sec grow"><div class="sec-hd"><span>Live operations</span>' +
			'<span><span class="dot pulse"></span></span></div><div class="feed" id="ops-feed"></div></div>' +
			"</div>";

		el("ops-brand").textContent = cfg.brand ? String(cfg.brand).toUpperCase() : "AGENT OPS";
		el("ops-model").textContent = cfg.model || "—";

		var canvas = el("ops-canvas");
		var stage = el("ops-stage");
		var ctx = {
			canvas: canvas,
			size: { w: 0, h: 0, dpr: Math.min(2, window.devicePixelRatio || 1) },
			engine: engine,
			ui: ui,
			state: state,
			actions: { toggleTool: toggleTool, selectOp: selectOp },
		};

		// ---- rail -------------------------------------------------------------
		(function buildRail() {
			var rail = el("ops-rail");
			var html = '<div class="hd">Visualizations</div>';
			MODES.forEach(function (m) {
				var on = m.id === state.modeId;
				var soon = !isEnabled(m);
				html +=
					'<button class="mode' + (on ? " on" : "") + (soon ? " soon" : "") +
					'" data-mode="' + m.id + '"' + (soon ? " disabled" : "") + ">" +
					'<span class="glyph">' + ui.MODE_GLYPHS[m.glyph] + "</span>" +
					'<span><span class="t">' + m.t + '</span><span class="d">' +
					m.d + (soon ? " · soon" : "") + "</span></span></button>";
			});
			html +=
				'<div class="spacer"></div><div class="note">Same live agent, multiple lenses. ' +
				"Hover any element for detail · click a tool to isolate it · click an operation to inspect.</div>";
			rail.innerHTML = html;
			rail.querySelectorAll(".mode").forEach(function (b) {
				b.addEventListener("click", function () {
					var id = b.getAttribute("data-mode");
					var m = modeById[id];
					if (!m || !isEnabled(m) || id === state.modeId) return;
					setMode(id);
				});
			});
		})();

		// ---- speed seg + controls --------------------------------------------
		(function buildControls() {
			var seg = el("ops-speed");
			SPEEDS.forEach(function (s) {
				var b = document.createElement("button");
				b.className = "btn" + (engine.speed === s ? " on" : "");
				b.textContent = s + "×";
				b.addEventListener("click", function () {
					engine.setSpeed(s);
					seg.querySelectorAll(".btn").forEach(function (x) {
						x.classList.toggle("on", x === b);
					});
				});
				seg.appendChild(b);
			});
			el("ops-play").addEventListener("click", function () {
				var nowRunning = engine.toggleRunning();
				// Pausing while live freezes the view at the current instant.
				if (!nowRunning && state.viewTime === "live") state.viewTime = engine.simNow;
				updateTopbar();
			});
			el("ops-insp-toggle").addEventListener("click", function () {
				state.inspector = !state.inspector;
				root.classList.toggle("no-insp", !state.inspector);
				el("ops-insp-toggle").classList.toggle("on", state.inspector);
				measure();
			});
		})();

		// ---- stage canvas events ---------------------------------------------
		canvas.addEventListener("mousemove", function (e) {
			if (lens && lens.onMove) lens.onMove(e);
		});
		canvas.addEventListener("mouseleave", function (e) {
			if (lens && lens.onLeave) lens.onLeave(e);
		});
		canvas.addEventListener("click", function (e) {
			if (lens && lens.onClick) lens.onClick(e);
		});

		// ---- scrub ------------------------------------------------------------
		var track = el("ops-scrub-track");
		var scrubCanvas = el("ops-scrub-canvas");
		var dragging = false;
		function tFromX(clientX) {
			var r = track.getBoundingClientRect();
			var x = Math.max(0, Math.min(r.width, clientX - r.left));
			return engine.simNow - (1 - x / r.width) * engine.HORIZON_MS;
		}
		track.addEventListener("pointerdown", function (e) {
			dragging = true;
			var t = tFromX(e.clientX);
			if (t > engine.simNow - 900) {
				state.viewTime = "live";
				engine.setRunning(true);
			} else {
				state.viewTime = t;
				engine.setRunning(false);
			}
			window.addEventListener("pointermove", onScrubMove);
			window.addEventListener("pointerup", onScrubUp);
			updateTopbar();
		});
		function onScrubMove(e) {
			if (!dragging) return;
			var t = tFromX(e.clientX);
			state.viewTime = t > engine.simNow - 900 ? "live" : t;
		}
		function onScrubUp() {
			dragging = false;
			window.removeEventListener("pointermove", onScrubMove);
			window.removeEventListener("pointerup", onScrubUp);
		}
		el("ops-live-btn").addEventListener("click", function () {
			state.viewTime = "live";
			engine.setRunning(true);
			updateTopbar();
		});

		// ---- actions ----------------------------------------------------------
		function toggleTool(id) {
			var en = state.enabled;
			var total = engine.TOOLS.length;
			if (en.size === total) {
				en.clear();
				en.add(id);
			} else if (en.has(id)) {
				en.delete(id);
				if (en.size === 0) engine.TOOLS.forEach(function (t) { en.add(t.id); });
			} else {
				en.add(id);
			}
			updateChips();
		}
		function resetTools() {
			state.enabled = new Set(engine.TOOLS.map(function (t) { return t.id; }));
			ctx.state = state;
			updateChips();
		}
		function selectOp(o) {
			state.selected = o;
			updateDetail();
		}

		function setMode(id) {
			state.modeId = id;
			var m = modeById[id];
			el("ops-stage-t").textContent = m.t;
			el("ops-stage-d").textContent = m.head;
			root.querySelectorAll(".mode").forEach(function (b) {
				b.classList.toggle("on", b.getAttribute("data-mode") === id);
			});
			var g = canvas.getContext("2d");
			g.setTransform(1, 0, 0, 1, 0, 0);
			g.clearRect(0, 0, canvas.width, canvas.height);
			var factory = m.comp();
			lens = typeof factory === "function" ? factory(ctx) : null;
		}

		// ---- panels -----------------------------------------------------------
		function buildChips() {
			var wrap = el("ops-chips");
			wrap.innerHTML = "";
			engine.TOOLS.forEach(function (t) {
				var span = document.createElement("span");
				span.className = "chip " + (state.enabled.has(t.id) ? "on" : "off");
				span.setAttribute("data-tool", t.id);
				span.innerHTML = '<span class="sw" style="background:' + t.color + '"></span>' + ui.esc(t.label);
				span.addEventListener("click", function () { toggleTool(t.id); });
				wrap.appendChild(span);
			});
			el("ops-showall").onclick = resetTools;
			chipsBuilt = true;
			updateChips();
		}
		function updateChips() {
			if (!chipsBuilt) return;
			el("ops-chips").querySelectorAll(".chip").forEach(function (span) {
				var on = state.enabled.has(span.getAttribute("data-tool"));
				span.classList.toggle("on", on);
				span.classList.toggle("off", !on);
			});
			el("ops-showall").style.display =
				state.enabled.size === engine.TOOLS.length ? "none" : "inline";
		}

		function kv(k, v, color) {
			return '<div class="kv"><span class="k">' + ui.esc(k) + '</span><span class="v"' +
				(color ? ' style="color:' + color + '"' : "") + ">" + ui.esc(v) + "</span></div>";
		}
		function updateDetail() {
			var box = el("ops-detail");
			var sel = state.selected;
			if (sel) {
				var tool = engine.TOOL_BY_ID[sel.toolId] || { label: sel.toolId, color: "#3fe08f" };
				box.innerHTML =
					'<div class="sec-hd"><span>Operation</span>' +
					'<span style="cursor:pointer;color:#7c887f" id="ops-clear">clear ✕</span></div>' +
					'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
					'<span class="st" style="width:8px;height:8px;border-radius:8px;background:' +
					ui.statusColor(sel.status) + '"></span>' +
					'<span class="bright" style="font-size:14px;font-family:var(--ops-sans)">' + ui.esc(sel.op) + "</span></div>" +
					kv("tool", tool.label, tool.color) +
					kv("status", sel.status, ui.statusColor(sel.status)) +
					kv("duration", ui.fmtMs(sel.duration)) +
					kv("latency", sel.latency == null ? "—" : sel.latency + "ms") +
					kv("tokens in / out", ui.fmtNum(sel.tokIn) + " / " + ui.fmtNum(sel.tokOut)) +
					(sel.args ? kv("argument", sel.args) : "") +
					(sel.taskLabel ? kv("task", sel.taskLabel) : "");
				var clr = el("ops-clear");
				if (clr) clr.addEventListener("click", function () { state.selected = null; updateDetail(); });
			} else {
				var tot = engine.totals();
				var html = '<div class="sec-hd"><span>Busiest now</span><span>' +
					tot.tps.toFixed(1) + "/s total</span></div>";
				tot.byTool.slice(0, 5).forEach(function (s) {
					var pct = Math.min(100, (s.tps / 4) * 100);
					html +=
						'<div style="margin:7px 0"><div style="display:flex;justify-content:space-between;gap:10px;font-size:11.5px;margin-bottom:4px">' +
						'<span style="color:#d6ddd7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0">' +
						'<span style="display:inline-block;width:7px;height:7px;border-radius:7px;background:' +
						s.tool.color + ';margin-right:7px"></span>' + ui.esc(s.tool.label) + "</span>" +
						'<span class="dim tnum" style="white-space:nowrap;flex-shrink:0">' +
						s.tps.toFixed(1) + "/s · " + s.active + "▲</span></div>" +
						'<div style="height:4px;border-radius:4px;background:rgba(120,200,165,0.08)">' +
						'<div style="height:4px;border-radius:4px;width:' + pct + "%;background:" +
						s.tool.color + ';opacity:0.8"></div></div></div>';
				});
				box.innerHTML = html;
			}
		}

		function updateFeed() {
			var feed = el("ops-feed");
			var rows = engine.recent(60).filter(function (o) {
				return state.enabled.has(o.toolId);
			}).slice(0, 26);
			var curMax = lastFeedMax;
			rows.forEach(function (o) { if (o.id > curMax) curMax = o.id; });
			if (!rows.length) {
				feed.innerHTML = '<div class="empty">No operations match the current filter.</div>';
				lastFeedMax = curMax;
				return;
			}
			var html = "";
			rows.forEach(function (o) {
				var sel = state.selected && state.selected.id === o.id;
				var enter = o.id > lastFeedMax;
				html +=
					'<div class="feed-row' + (sel ? " sel" : "") + (enter ? " enter" : "") +
					'" data-op="' + o.id + '">' +
					'<span class="st" style="background:' + ui.statusColor(o.status) +
					(o.status === "running" ? ";box-shadow:0 0 6px #45c8d8" : "") + '"></span>' +
					'<span class="nm">' + ui.esc(o.op) + "</span>" +
					'<span class="ms">' + (o.status === "running" ? "running" : ui.fmtMs(o.duration)) + "</span></div>";
			});
			feed.innerHTML = html;
			lastFeedMax = curMax;
			feed.querySelectorAll(".feed-row").forEach(function (rowEl) {
				rowEl.addEventListener("click", function () {
					var id = Number(rowEl.getAttribute("data-op"));
					var found = engine.ops.filter(function (o) { return o.id === id; })[0];
					if (found) selectOp(found);
				});
			});
		}

		function updateTopbar() {
			var tot = engine.totals();
			el("ops-tps").textContent = tot.tps.toFixed(1);
			el("ops-active").textContent = tot.active;
			var errEl = el("ops-err");
			errEl.textContent = ui.fmtPct(tot.errorRate);
			errEl.classList.toggle("err", tot.errorRate > 0.04);
			el("ops-uptime").textContent = ui.fmtClock(process_uptime());
			if (engine.model) el("ops-model").textContent = engine.model;
			var running = engine.running;
			el("ops-live-txt").textContent = running ? "LIVE" : "PAUSED";
			var dot = el("ops-live-dot");
			dot.style.background = running ? "#3fe08f" : "#e6b248";
			dot.classList.toggle("pulse", running);
			el("ops-play").textContent = running ? "❚❚" : "▶";
		}
		// "uptime" = process uptime sent at mount, advanced by wall clock.
		var uptimeBase = (cfg.uptimeMs || 0);
		var mountedAt = perfNow();
		function process_uptime() {
			return uptimeBase + (perfNow() - mountedAt);
		}

		function updateScrub() {
			var c = scrubCanvas;
			var r = track.getBoundingClientRect();
			var dpr = Math.min(2, window.devicePixelRatio || 1);
			if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
				c.width = Math.round(r.width * dpr);
				c.height = Math.round(r.height * dpr);
			}
			var g = c.getContext("2d");
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			g.clearRect(0, 0, r.width, r.height);
			var H = engine.HORIZON_MS;
			var simNow = engine.simNow;
			var NB = Math.max(40, Math.floor(r.width / 4));
			var bw = r.width / NB;
			var buckets = [];
			for (var b = 0; b < NB; b++) buckets.push({ n: 0, err: 0 });
			var ops = engine.ops;
			for (var i = 0; i < ops.length; i++) {
				var o = ops[i];
				var t = o.status === "running" ? simNow : o.endAt;
				var age = simNow - t;
				if (age < 0 || age > H) continue;
				var idx = NB - 1 - Math.floor(age / (H / NB));
				if (idx < 0 || idx >= NB) continue;
				buckets[idx].n++;
				if (o.status === "error") buckets[idx].err++;
			}
			var mx = 1;
			buckets.forEach(function (bk) { if (bk.n > mx) mx = bk.n; });
			buckets.forEach(function (bk, k) {
				if (!bk.n) return;
				var x = k * bw,
					hgt = 4 + (bk.n / mx) * (r.height - 8);
				g.fillStyle = bk.err ? "rgba(229,96,77,0.7)" : "rgba(63,224,143,0.45)";
				g.fillRect(x, r.height - hgt, Math.max(1, bw - 0.6), hgt);
			});
			// stream view-window hint (last 22s)
			var winFrac = 22000 / H;
			g.fillStyle = "rgba(120,200,165,0.06)";
			g.fillRect(r.width * (1 - winFrac), 0, r.width * winFrac, r.height);

			var live = state.viewTime === "live";
			var cursorX = live ? r.width : r.width * (1 - (simNow - state.viewTime) / H);
			el("ops-scrub-cursor").style.left = Math.max(0, Math.min(r.width, cursorX)) + "px";
			var badge = el("ops-scrub-badge");
			if (live) {
				badge.style.color = "#3fe08f";
				badge.textContent = "● LIVE · " + ui.fmtClock(process_uptime());
			} else {
				badge.style.color = "#e6b248";
				badge.textContent = "◀ REVIEW · -" + ((simNow - state.viewTime) / 1000).toFixed(1) + "s";
			}
			el("ops-live-btn").classList.toggle("on", live);
		}

		// ---- sizing -----------------------------------------------------------
		function measure() {
			var r = stage.getBoundingClientRect();
			var dpr = Math.min(2, window.devicePixelRatio || 1);
			ctx.size.w = r.width;
			ctx.size.h = r.height;
			ctx.size.dpr = dpr;
			if (r.width && r.height) {
				canvas.width = Math.round(r.width * dpr);
				canvas.height = Math.round(r.height * dpr);
				canvas.style.width = r.width + "px";
				canvas.style.height = r.height + "px";
			}
		}

		// ---- frame loop -------------------------------------------------------
		var lastPerf = perfNow();
		var lastUI = 0;
		function advanceView() {
			var p = perfNow();
			var dt = p - lastPerf;
			lastPerf = p;
			if (engine.running && state.viewTime !== "live") {
				state.viewTime += dt * engine.speed;
				if (state.viewTime >= engine.simNow - 200) state.viewTime = "live";
			}
		}
		engine.on("frame", function () {
			if (!enabledInit && engine.TOOLS.length) {
				engine.TOOLS.forEach(function (t) { state.enabled.add(t.id); });
				enabledInit = true;
				buildChips();
				if (!lens) setMode(state.modeId);
			}
			advanceView();
			if (lens) {
				try { lens.frame(); } catch (e) { /* one bad frame must not kill the loop */ }
			}
			var now = perfNow();
			if (now - lastUI > 120) {
				lastUI = now;
				updateTopbar();
				if (state.inspector) {
					updateDetail();
					updateFeed();
				}
				updateScrub();
			}
		});

		function perfNow() {
			return typeof performance !== "undefined" ? performance.now() : Date.now();
		}

		// init
		setMode(state.modeId);
		measure();
		var ro;
		try {
			ro = new ResizeObserver(measure);
			ro.observe(stage);
		} catch (e) { /* RO can be inert; window resize + timeouts below cover it */ }
		window.addEventListener("resize", measure);
		setTimeout(measure, 120);
		setTimeout(measure, 450);
		updateTopbar();
	}

	window.OpsShell = { mount: mount };
})();
