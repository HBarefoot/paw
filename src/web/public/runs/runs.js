/* ===========================================================================
   runs.js — Run verdicts board (read-only, observability Phase 1).
   A dense .tbl table of completed runs with a KPI summary strip and a filter
   toolbar. The time WINDOW is a server query param (?window=24h|7d|all); verdict,
   type, and claim-search filter CLIENT-SIDE over the loaded window (instant, no
   re-fetch). Polls GET /api/runs/feed?window=<sel> every ~2.5s (backoff on fail).
   Vanilla, no deps; exposes window.RunsBoard. DOM-built (no innerHTML of data).
   =========================================================================== */
(function () {
	var POLL_OK = 2500;
	var POLL_MAX = 30000;

	var allRuns = [];
	var filters = { verdict: "all", type: "all", search: "" };
	var windowSel = "7d";
	var delay = POLL_OK;
	var lastVersion = -1;
	var timer = null;

	// DOM handles (resolved in start()).
	var tbodyEl = null;
	var statusEl = null;

	var VERDICT_PILL = { ok: "green", suspect: "amber", error: "red" };
	var VERDICT_LED = { ok: "live", suspect: "warn", error: "err" };

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = String(text);
		return n;
	}

	function fmtRel(iso) {
		var t = Date.parse(iso);
		if (isNaN(t)) return iso || "";
		var s = Math.max(0, (Date.now() - t) / 1000);
		if (s < 60) return "just now";
		if (s < 3600) return Math.floor(s / 60) + "m";
		if (s < 86400) return Math.floor(s / 3600) + "h";
		if (s < 604800) return Math.floor(s / 86400) + "d";
		return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
	}

	/**
	 * Pure: filter runs by verdict / type(channel) / case-insensitive claim search.
	 * 'all' / '' mean no constraint on that axis. Exposed for tests.
	 */
	function applyFilters(runs, f) {
		f = f || {};
		var v = f.verdict || "all";
		var ty = f.type || "all";
		var q = (f.search || "").trim().toLowerCase();
		return (runs || []).filter(function (r) {
			if (v !== "all" && r.verdict !== v) return false;
			if (ty !== "all" && r.channel !== ty) return false;
			if (q && String(r.claim_preview || "").toLowerCase().indexOf(q) === -1)
				return false;
			return true;
		});
	}

	function detailRow(run) {
		var tr = el("tr", "run-detail");
		var td = el("td");
		td.colSpan = 5;
		if (run.claim_preview) td.appendChild(el("div", "run-detail-claim", run.claim_preview));
		if (run.flags && run.flags.length) {
			var flags = el("div", "run-flags");
			for (var i = 0; i < run.flags.length; i++) {
				flags.appendChild(el("span", "run-flag", run.flags[i]));
			}
			td.appendChild(flags);
		}
		var foot = el("div", "run-detail-foot");
		var link = el("a", "run-session-link", "Open session →");
		link.href = "/sessions?id=" + encodeURIComponent(run.session_id || "");
		foot.appendChild(link);
		td.appendChild(foot);
		tr.appendChild(td);
		return tr;
	}

	function renderRow(run) {
		var tr = el("tr", "run-row verdict-" + run.verdict);

		var vTd = el("td");
		var vWrap = el("span", "nm");
		vWrap.appendChild(el("span", "led " + (VERDICT_LED[run.verdict] || "idle")));
		vWrap.appendChild(
			el("span", "pill-badge " + (VERDICT_PILL[run.verdict] || "dim"), run.verdict),
		);
		vTd.appendChild(vWrap);
		tr.appendChild(vTd);

		var tTd = el("td");
		tTd.appendChild(el("span", "pill-badge dim", run.channel || "—"));
		tr.appendChild(tTd);

		tr.appendChild(el("td", "run-claim-cell", run.claim_preview || "—"));

		var toolTd = el("td", "num");
		toolTd.appendChild(el("span", null, String(run.tool_calls)));
		if (run.tool_errors > 0) {
			toolTd.appendChild(el("span", "run-errcount", " · " + run.tool_errors + " err"));
		}
		tr.appendChild(toolTd);

		tr.appendChild(el("td", "num run-when", fmtRel(run.created_at)));

		// Click toggles an inline detail row beneath this one.
		tr.addEventListener("click", function () {
			var next = tr.nextSibling;
			if (next && next.classList && next.classList.contains("run-detail")) {
				next.parentNode.removeChild(next);
				tr.classList.remove("open");
			} else {
				tr.classList.add("open");
				tr.parentNode.insertBefore(detailRow(run), tr.nextSibling);
			}
		});
		return tr;
	}

	function setKpi(id, val) {
		var n = document.getElementById(id);
		if (n) n.textContent = String(val);
	}

	function renderRows() {
		if (!tbodyEl) return;
		var rows = applyFilters(allRuns, filters).sort(function (a, b) {
			return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
		});
		tbodyEl.textContent = "";
		if (!rows.length) {
			var tr = el("tr", "runs-empty-row");
			var td = el("td", "runs-empty", "No runs match these filters.");
			td.colSpan = 5;
			tr.appendChild(td);
			tbodyEl.appendChild(tr);
		} else {
			for (var i = 0; i < rows.length; i++) tbodyEl.appendChild(renderRow(rows[i]));
		}
		if (statusEl) {
			statusEl.textContent = rows.length + " of " + allRuns.length + " runs";
		}
	}

	function render(feed) {
		allRuns = feed.runs || [];
		var counts = feed.counts || { ok: 0, suspect: 0, error: 0 };
		setKpi("kpi-total", allRuns.length);
		setKpi("kpi-error", counts.error);
		setKpi("kpi-suspect", counts.suspect);
		setKpi("kpi-ok", counts.ok);
		renderRows();
	}

	function poll() {
		fetch("/api/runs/feed?window=" + encodeURIComponent(windowSel), {
			headers: { Accept: "application/json" },
		})
			.then(function (r) {
				if (!r.ok) throw new Error("HTTP " + r.status);
				return r.json();
			})
			.then(function (feed) {
				delay = POLL_OK;
				if (feed.version !== lastVersion) {
					lastVersion = feed.version;
					render(feed);
				}
			})
			.catch(function () {
				if (statusEl) statusEl.textContent = "Reconnecting…";
				delay = Math.min(POLL_MAX, delay * 2);
			})
			.then(function () {
				timer = setTimeout(poll, delay);
			});
	}

	// Wire a .seg group: clicking a button sets filters[key] and re-renders. The
	// `window` group re-fetches (it's a server query), the rest filter in place.
	function wireSeg(group) {
		var key = group.getAttribute("data-filter");
		group.addEventListener("click", function (ev) {
			var btn = ev.target.closest ? ev.target.closest("button") : null;
			if (!btn || !group.contains(btn)) return;
			var val = btn.getAttribute("data-val");
			var siblings = group.querySelectorAll("button");
			for (var i = 0; i < siblings.length; i++) siblings[i].classList.remove("on");
			btn.classList.add("on");
			if (key === "window") {
				windowSel = val;
				lastVersion = -1; // force a refresh — version may not change across windows
				if (timer) clearTimeout(timer);
				poll();
			} else {
				filters[key] = val;
				renderRows();
			}
		});
	}

	function wireToolbar() {
		var segs = document.querySelectorAll(".runs-toolbar .seg");
		for (var i = 0; i < segs.length; i++) wireSeg(segs[i]);
		var search = document.getElementById("runs-search");
		if (search) {
			search.addEventListener("input", function () {
				filters.search = search.value;
				renderRows();
			});
		}
	}

	window.RunsBoard = {
		start: function () {
			tbodyEl = document.getElementById("runs-tbody");
			statusEl = document.getElementById("runs-status");
			if (!tbodyEl) return;
			wireToolbar();
			if (timer) clearTimeout(timer);
			poll();
		},
		// Test seam: pure verdict/type/search filtering over a run array.
		applyFilters: applyFilters,
	};
})();
