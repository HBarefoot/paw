/* ===========================================================================
   board.js — Objective ledger board (live, Phase 2a).
   Polls GET /api/tasks/feed every ~2.5s and renders the status columns from the
   REAL agent_work rows. Phase 2a adds: native HTML5 drag-and-drop (backlog⇄queued,
   blocked|failed→queued — dragging into `working` is refused), a Start button on
   queued cards (delegates to an agent), a Retry button on failed cards, a
   feedback→Resume form on blocked cards (the help-leash — Phase 1), and a minimal
   add-card input. After any mutation the board re-polls the feed
   (server is the source of truth — no hand-mutated DOM state). Vanilla, no deps;
   exposes window.TasksBoard. DOM-built (no innerHTML of server strings).
   =========================================================================== */
(function () {
	var POLL_OK = 2500; // normal cadence
	var POLL_MAX = 30000; // error backoff ceiling

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
	var BLOCK_KIND_LABEL = {
		needs_feedback: "Needs feedback",
		needs_access: "Needs access",
		needs_capability: "Needs capability",
	};

	// Where a card may be DRAGGED. `working` is Start-only; done/needs_approval
	// are not user-draggable. Mirrors the server transition guard.
	var DRAG_TARGETS = {
		backlog: ["queued"],
		queued: ["backlog"],
		blocked: ["queued"],
		failed: ["queued"],
	};
	function canDrop(from, to) {
		if (to === "working") return false;
		return (DRAG_TARGETS[from] || []).indexOf(to) !== -1;
	}

	var boardEl = null;
	var statusEl = null;
	var delay = POLL_OK;
	var lastVersion = -1;
	var timer = null;
	var columnCounts = {}; // last-rendered counts, for append positioning

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

	function postJSON(url, body) {
		return fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body || {}),
		}).then(function (r) {
			return r.json().then(function (j) {
				if (!r.ok) throw new Error(j && j.error ? j.error : "HTTP " + r.status);
				return j;
			});
		});
	}

	// Force an immediate refresh from the server after a mutation.
	function refresh() {
		lastVersion = -1;
		if (timer) clearTimeout(timer);
		poll();
	}

	function actionButton(label, cls, onClick) {
		var b = el("button", "task-btn " + cls, label);
		b.type = "button";
		b.addEventListener("click", function (ev) {
			ev.stopPropagation();
			b.disabled = true;
			onClick().catch(function (err) {
				b.disabled = false;
				if (statusEl) statusEl.textContent = String(err.message || err);
			});
		});
		return b;
	}

	function renderCard(card) {
		var c = el("div", "task-card" + (card.overdue ? " overdue" : ""));
		c.setAttribute("data-id", card.id);

		// Draggable only from user-movable columns.
		if (DRAG_TARGETS[card.status]) {
			c.draggable = true;
			c.addEventListener("dragstart", function (ev) {
				ev.dataTransfer.setData("text/plain", card.id);
				ev.dataTransfer.setData("x-from", card.status);
				ev.dataTransfer.effectAllowed = "move";
				c.classList.add("dragging");
			});
			c.addEventListener("dragend", function () {
				c.classList.remove("dragging");
			});
		}

		var head = el("div", "task-card-head");
		head.appendChild(el("span", "task-title", card.title));
		head.appendChild(
			el(
				"span",
				"badge " + (PRIORITY_BADGE[card.priority] || "neutral"),
				card.priority,
			),
		);
		c.appendChild(head);

		var meta = el("div", "task-meta");
		if (card.due_at) {
			meta.appendChild(
				el(
					"span",
					"badge " + (card.overdue ? "warning" : "neutral"),
					(card.overdue ? "Overdue · " : "Due ") + fmtDue(card.due_at),
				),
			);
		}
		if (card.status === "working" && card.agent_name) {
			meta.appendChild(el("span", "badge info", "▶ " + card.agent_name));
		}
		if (meta.childNodes.length) c.appendChild(meta);

		if (card.error && (card.status === "blocked" || card.status === "failed")) {
			c.appendChild(el("div", "task-error", card.error));
		}

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

		// Per-card actions.
		if (card.status === "queued") {
			var actions = el("div", "task-actions");
			actions.appendChild(
				actionButton("Start", "primary", function () {
					return postJSON("/api/tasks/" + card.id + "/start", {}).then(refresh);
				}),
			);
			c.appendChild(actions);
		} else if (card.status === "blocked") {
			// Help-leash: show why it's blocked, then either a feedback→Resume form
			// or a "needs dev work" hint when an operator note can't fix it.
			if (card.block_kind) {
				var kind = el("div", "task-meta");
				kind.appendChild(
					el(
						"span",
						"badge warning task-block-kind",
						BLOCK_KIND_LABEL[card.block_kind] || card.block_kind,
					),
				);
				c.appendChild(kind);
			}
			if (card.block_kind === "needs_capability") {
				c.appendChild(
					el(
						"div",
						"task-hint",
						"Needs dev work — an operator note can't add a missing capability.",
					),
				);
			} else {
				var resume = el("div", "task-resume");
				var noteInput = el("input", "task-resume-input");
				noteInput.type = "text";
				noteInput.placeholder = "Feedback to unblock…";
				if (card.operator_note) noteInput.value = card.operator_note;
				resume.appendChild(noteInput);
				resume.appendChild(
					el(
						"div",
						"task-resume-hint",
						"Don't paste secrets — credentials go in the vault.",
					),
				);
				var ra = el("div", "task-actions");
				ra.appendChild(
					actionButton("Resume", "primary", function () {
						return postJSON("/api/tasks/" + card.id + "/resume", {
							note: noteInput.value.trim(),
						}).then(refresh);
					}),
				);
				resume.appendChild(ra);
				c.appendChild(resume);
			}
		} else if (card.status === "failed") {
			var rf = el("div", "task-actions");
			rf.appendChild(
				actionButton("Retry", "", function () {
					return postJSON("/api/tasks/" + card.id + "/retry", {}).then(refresh);
				}),
			);
			c.appendChild(rf);
		}
		return c;
	}

	function makeColumn(col, cards) {
		var colEl = el("div", "task-col");
		colEl.setAttribute("data-col", col.key);
		var hd = el("div", "task-col-hd");
		hd.appendChild(el("span", "task-col-label", col.label));
		hd.appendChild(el("span", "task-col-count", cards.length));
		colEl.appendChild(hd);

		// Add-card affordance lives in the Backlog header.
		if (col.key === "backlog") {
			var form = el("div", "task-add");
			var input = el("input", "task-add-input");
			input.type = "text";
			input.placeholder = "New task…";
			var submit = function () {
				var title = input.value.trim();
				if (!title) return;
				input.value = "";
				postJSON("/api/tasks", { title: title }).then(refresh).catch(function (err) {
					if (statusEl) statusEl.textContent = String(err.message || err);
				});
			};
			input.addEventListener("keydown", function (ev) {
				if (ev.key === "Enter") submit();
			});
			form.appendChild(input);
			form.appendChild(actionButton("Add", "primary", function () {
				submit();
				return Promise.resolve();
			}));
			colEl.appendChild(form);
		}

		var bodyEl = el("div", "task-col-body");
		// Drop target wiring.
		bodyEl.addEventListener("dragover", function (ev) {
			ev.preventDefault();
			colEl.classList.add("drag-over");
		});
		bodyEl.addEventListener("dragleave", function () {
			colEl.classList.remove("drag-over");
		});
		bodyEl.addEventListener("drop", function (ev) {
			ev.preventDefault();
			colEl.classList.remove("drag-over");
			var id = ev.dataTransfer.getData("text/plain");
			var from = ev.dataTransfer.getData("x-from");
			if (!id || !canDrop(from, col.key)) return; // refused client-side
			var position = columnCounts[col.key] || 0; // append to end
			postJSON("/api/tasks/" + id + "/move", {
				status: col.key,
				position: position,
			})
				.then(refresh)
				.catch(function (err) {
					if (statusEl) statusEl.textContent = String(err.message || err);
				});
		});

		if (!cards.length) {
			bodyEl.appendChild(el("div", "task-col-empty", "—"));
		} else {
			for (var j = 0; j < cards.length; j++) {
				bodyEl.appendChild(renderCard(cards[j]));
			}
		}
		colEl.appendChild(bodyEl);
		return colEl;
	}

	function render(feed) {
		var columns = feed.columns || {};
		boardEl.textContent = "";
		columnCounts = {};
		var total = 0;
		for (var i = 0; i < COLUMNS.length; i++) {
			var col = COLUMNS[i];
			var cards = columns[col.key] || [];
			columnCounts[col.key] = cards.length;
			total += cards.length;
			boardEl.appendChild(makeColumn(col, cards));
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
		// Test seam: expose the pure card renderer so the blocked-card help-leash
		// rules (Resume hidden for needs_capability) can be asserted under a fake
		// DOM without standing up the poll loop. Mirrors window.CompanionInbox.
		renderCard: renderCard,
	};
})();
