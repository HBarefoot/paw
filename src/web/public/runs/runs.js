/* ===========================================================================
   runs.js — Run verdicts board (read-only, observability Phase 1).
   Polls GET /api/runs/feed every ~2.5s (exponential backoff on failure) and
   renders one card per completed run, colored by deterministic verdict
   (ok / suspect / error). Shows channel, claim preview, fired flags, and
   tool-call/error counts; a counts header summarizes the window. Suspect &
   error sort to the top server-side. Vanilla, no deps; exposes
   window.RunsBoard. DOM-built (no innerHTML of server strings).
   =========================================================================== */
(function () {
	var POLL_OK = 2500;
	var POLL_MAX = 30000;

	var listEl = null;
	var statusEl = null;
	var delay = POLL_OK;
	var lastVersion = -1;
	var timer = null;

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = String(text);
		return n;
	}

	function fmtTime(iso) {
		var d = new Date(iso);
		if (isNaN(d.getTime())) return iso || "";
		return d.toLocaleString([], {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	function renderCard(run) {
		var c = el("div", "run-card verdict-" + run.verdict);
		c.id = run.id;

		var head = el("div", "run-card-head");
		head.appendChild(el("span", "run-verdict badge", run.verdict));
		if (run.channel) head.appendChild(el("span", "run-channel", run.channel));
		head.appendChild(el("span", "run-time", fmtTime(run.created_at)));
		c.appendChild(head);

		if (run.claim_preview) {
			c.appendChild(el("div", "run-claim", run.claim_preview));
		}

		if (run.flags && run.flags.length) {
			var flags = el("div", "run-flags");
			for (var i = 0; i < run.flags.length; i++) {
				flags.appendChild(el("span", "run-flag", run.flags[i]));
			}
			c.appendChild(flags);
		}

		var meta = el("div", "run-meta");
		meta.appendChild(el("span", null, run.tool_calls + " tool calls"));
		if (run.tool_errors > 0) {
			meta.appendChild(el("span", "run-errcount", run.tool_errors + " errors"));
		}
		c.appendChild(meta);
		return c;
	}

	function render(feed) {
		var runs = feed.runs || [];
		var counts = feed.counts || { ok: 0, suspect: 0, error: 0 };
		listEl.textContent = "";
		if (!runs.length) {
			listEl.appendChild(el("div", "runs-empty", "No runs recorded yet."));
		} else {
			for (var i = 0; i < runs.length; i++) {
				listEl.appendChild(renderCard(runs[i]));
			}
		}
		if (statusEl) {
			statusEl.textContent =
				counts.error + " error · " + counts.suspect + " suspect · " + counts.ok + " ok";
		}
	}

	function poll() {
		fetch("/api/runs/feed", { headers: { Accept: "application/json" } })
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

	window.RunsBoard = {
		start: function (list, status) {
			listEl = list;
			statusEl = status;
			if (!listEl) return;
			if (timer) clearTimeout(timer);
			poll();
		},
	};
})();
