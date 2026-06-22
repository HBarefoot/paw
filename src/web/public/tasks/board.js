/* ===========================================================================
   board.js — Objective ledger board (read-only, Phase 1).
   Polls GET /api/tasks/feed every ~2.5s (exponential backoff on failure),
   renders the status columns from the REAL agent_work rows. Each card shows
   title, priority, due date (with an `overdue` badge), and — on Done cards —
   the evidence backing the completion. No drag-and-drop this phase (Phase 2).
   Vanilla, no deps; exposes window.TasksBoard. DOM-built (no innerHTML of
   server strings) so titles/evidence can't inject markup.
   =========================================================================== */
(function () {
	var POLL_OK = 2500; // normal cadence
	var POLL_MAX = 30000; // error backoff ceiling

	// Column order + human labels. Mirrors the design doc's kanban lanes.
	var COLUMNS = [
		{ key: "backlog", label: "Backlog" },
		{ key: "queued", label: "Queued" },
		{ key: "working", label: "Working" },
		{ key: "needs_approval", label: "Needs approval" },
		{ key: "blocked", label: "Blocked" },
		{ key: "done", label: "Done" },
		{ key: "failed", label: "Failed" },
	];
	var PRIORITY_BADGE = { high: "error", normal: "neutral", low: "info" };

	var boardEl = null;
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

	function fmtDue(iso) {
		var d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		return d.toLocaleString([], {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	function renderCard(card) {
		var c = el("div", "task-card" + (card.overdue ? " overdue" : ""));

		var head = el("div", "task-card-head");
		head.appendChild(el("span", "task-title", card.title));
		var prio = el(
			"span",
			"badge " + (PRIORITY_BADGE[card.priority] || "neutral"),
			card.priority,
		);
		head.appendChild(prio);
		c.appendChild(head);

		var meta = el("div", "task-meta");
		if (card.due_at) {
			var due = el(
				"span",
				"badge " + (card.overdue ? "warning" : "neutral"),
				(card.overdue ? "Overdue · " : "Due ") + fmtDue(card.due_at),
			);
			meta.appendChild(due);
		}
		if (meta.childNodes.length) c.appendChild(meta);

		// Evidence link/snippet on Done cards — "done" is visibly proof-backed.
		if (card.status === "done" && card.evidence) {
			var ev = el("div", "task-evidence");
			ev.appendChild(el("span", "task-evidence-label", "Evidence"));
			var trimmed = card.evidence.trim();
			if (/^https?:\/\/\S+$/i.test(trimmed)) {
				var a = el("a", "task-evidence-link", trimmed);
				a.href = trimmed;
				a.target = "_blank";
				a.rel = "noopener noreferrer";
				ev.appendChild(a);
			} else {
				ev.appendChild(el("span", "task-evidence-text", trimmed));
			}
			c.appendChild(ev);
		}
		return c;
	}

	function render(feed) {
		var columns = feed.columns || {};
		boardEl.textContent = "";
		var total = 0;
		for (var i = 0; i < COLUMNS.length; i++) {
			var col = COLUMNS[i];
			var cards = columns[col.key] || [];
			total += cards.length;
			var colEl = el("div", "task-col");
			var hd = el("div", "task-col-hd");
			hd.appendChild(el("span", "task-col-label", col.label));
			hd.appendChild(el("span", "task-col-count", cards.length));
			colEl.appendChild(hd);
			var body = el("div", "task-col-body");
			if (!cards.length) {
				body.appendChild(el("div", "task-col-empty", "—"));
			} else {
				for (var j = 0; j < cards.length; j++) {
					body.appendChild(renderCard(cards[j]));
				}
			}
			colEl.appendChild(body);
			boardEl.appendChild(colEl);
		}
		if (statusEl) statusEl.textContent = total + " task" + (total === 1 ? "" : "s");
	}

	function poll() {
		fetch("/api/tasks/feed", { headers: { Accept: "application/json" } })
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

	window.TasksBoard = {
		start: function (board, status) {
			boardEl = board;
			statusEl = status;
			if (!boardEl) return;
			if (timer) clearTimeout(timer);
			poll();
		},
	};
})();
