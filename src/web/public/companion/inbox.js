/**
 * CompanionInbox — the per-skill notification inbox + approve/decline surface.
 *
 * Clicking a skill pill opens this panel (slide-in beside the dock; bottom-sheet
 * on narrow widths). It shows that skill's notifications (mark read per-item and
 * all) plus any pending approvals routed to that skill, each with Approve /
 * Decline. The companion is served same-origin at /companion, so this talks to
 * /api/* directly:
 *   GET  /api/notifications            → { notifications, unread, unreadByKind }
 *   POST /api/notifications/read {id}  → mark one read
 *   GET  /api/approvals/pending        → { pending: [...] }
 *   POST /api/approvals/:id/approve    → resolve
 *   POST /api/approvals/:id/deny       → resolve
 *
 * Badges stay the engine's job: every mutation pushes the new unreadByKind /
 * pending count back through the engine (the single source renderBadges reads),
 * so a live paw:ambient tick reconciles by REPLACE — never a clobber or a
 * double-count. All decision logic is in pure, unit-tested helpers; the DOM
 * controller is a thin shell over them.
 *
 * This is a real .js file (not a template literal) — regex/backslashes are safe.
 */
(() => {
	// GitHub gated actions (src/integrations/github/approvals.ts). The approval
	// queue is GitHub-backed today, so a pending row routes to the "github" skill.
	const GITHUB_ACTIONS = new Set([
		"merge_pr",
		"delete_branch",
		"close_issue",
		"dispatch_workflow",
	]);
	// The synthetic inbox key for approvals with no resolvable skill pill — they
	// surface under a dedicated "Approvals" affordance instead of being dropped.
	const FALLBACK_KEY = "__approvals__";

	// ── pure helpers (unit-tested directly) ──────────────────────────────────

	/** Notifications for one skill (kind === pill data-key), newest first. */
	function filterNotifications(items, kind) {
		return (Array.isArray(items) ? items : [])
			.filter((n) => n && n.kind === kind)
			.slice()
			.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
	}

	/** Resolve a pending approval row to a skill key present in `skillKeys`
	 *  (a Set), else null. Explicit hint (future non-GitHub sources) wins; then a
	 *  GitHub gated action → "github"; then any row → "github" if that skill
	 *  exists (the queue is GitHub-backed). */
	function approvalSkillKey(row, skillKeys) {
		if (!row) return null;
		const set = skillKeys instanceof Set ? skillKeys : new Set(skillKeys || []);
		const hint = row.skillKey || row.kind;
		if (hint && set.has(hint)) return hint;
		if (GITHUB_ACTIONS.has(row.action) && set.has("github")) return "github";
		if (set.has("github")) return "github";
		return null;
	}

	/** The inbox bucket a row belongs in: its skill key, or the fallback. */
	function approvalBucket(row, skillKeys) {
		return approvalSkillKey(row, skillKeys) || FALLBACK_KEY;
	}

	/** Pending approvals routed to one inbox key. */
	function approvalsFor(rows, key, skillKeys) {
		return (Array.isArray(rows) ? rows : []).filter(
			(r) => approvalBucket(r, skillKeys) === key,
		);
	}

	/** Replace-semantics count edits (no deltas survive a frame → no drift). */
	function decrementKind(map, kind, n) {
		const out = Object.assign({}, map);
		out[kind] = Math.max(0, (out[kind] || 0) - (n == null ? 1 : n));
		return out;
	}
	function clearKind(map, kind) {
		const out = Object.assign({}, map);
		out[kind] = 0;
		return out;
	}

	/** A 404/409 from approve/deny means the row was resolved elsewhere
	 *  (Slack/web modal) between fetch and click — reconcile silently. */
	function isResolvedStatus(status) {
		return status === 404 || status === 409 || status === 410;
	}

	/** Compact relative time, e.g. "just now", "2m", "3h", "5d". */
	function relTime(iso, now) {
		const t = Date.parse(iso);
		if (!Number.isFinite(t)) return "";
		const s = Math.max(0, Math.floor(((now || Date.now()) - t) / 1000));
		if (s < 45) return "just now";
		if (s < 3600) return `${Math.round(s / 60)}m`;
		if (s < 86400) return `${Math.round(s / 3600)}h`;
		return `${Math.round(s / 86400)}d`;
	}

	function el(doc, tag, cls, text) {
		const e = doc.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}

	// ── controller ───────────────────────────────────────────────────────────
	/**
	 * create(deps) → the inbox controller.
	 *   deps.doc              document
	 *   deps.host             element to append the panel + fallback chip into
	 *   deps.fetch            fetch(url, opts) → Promise<Response-ish>
	 *   deps.getSkills        () => [{ key, label }]
	 *   deps.getUnreadByKind  () => { key: count }   (engine's live map)
	 *   deps.setUnreadByKind  (map) => void          (engine.setNotifications)
	 *   deps.setPending       (n, label) => void     (engine.setWaiting)
	 *   deps.now              () => ms (test seam; defaults to Date.now)
	 */
	function create(deps) {
		const doc = deps.doc;
		const host = deps.host;
		const doFetch = deps.fetch;
		const getSkills = deps.getSkills || (() => []);
		const getUnread = deps.getUnreadByKind || (() => ({}));
		const setUnread = deps.setUnreadByKind || (() => {});
		const setPending = deps.setPending || (() => {});
		const now = deps.now || (() => Date.now());

		let notifications = [];
		let approvals = [];
		let openKey = null;
		let loading = false;
		const busy = new Set(); // ids with an in-flight approve/decline

		const panel = el(doc, "div", "inbox-panel");
		panel.setAttribute("hidden", "");
		// Delegated click: every actionable carries data-inbox-action (+ data-id).
		panel.addEventListener("click", (ev) => {
			const t = ev.target;
			const node =
				t && t.closest ? t.closest("[data-inbox-action]") : null;
			if (!node) return;
			ev.preventDefault();
			const action = node.getAttribute("data-inbox-action");
			const id = node.getAttribute("data-id");
			if (action === "close") close();
			else if (action === "read") markRead(id);
			else if (action === "read-all") markAllRead(openKey);
			else if (action === "approve") approve(id);
			else if (action === "decline") decline(id);
		});
		host.appendChild(panel);

		// "Approvals" fallback chip — only shown when unmapped approvals exist.
		const fallbackChip = el(doc, "button", "inbox-fallback-chip");
		fallbackChip.setAttribute("type", "button");
		fallbackChip.setAttribute("data-key", FALLBACK_KEY);
		fallbackChip.setAttribute("hidden", "");
		fallbackChip.addEventListener("click", () => open(FALLBACK_KEY));
		host.appendChild(fallbackChip);

		function skillKeySet() {
			return new Set(getSkills().map((s) => s.key));
		}
		function labelFor(key) {
			if (key === FALLBACK_KEY) return "Approvals";
			const s = getSkills().find((x) => x.key === key);
			return s ? s.label : key;
		}

		/** The model for the currently-open inbox (pure projection of state). */
		function model() {
			if (!openKey) return null;
			const set = skillKeySet();
			return {
				key: openKey,
				label: labelFor(openKey),
				loading,
				notifications: filterNotifications(notifications, openKey),
				approvals: approvalsFor(approvals, openKey, set),
			};
		}

		async function fetchJson(url, opts) {
			const res = await doFetch(url, opts);
			const status = res && typeof res.status === "number" ? res.status : 0;
			let body = null;
			try {
				body = res && res.json ? await res.json() : null;
			} catch (_e) {
				body = null;
			}
			return { ok: res ? res.ok !== false : false, status, body };
		}

		async function refresh() {
			loading = true;
			render();
			const [nRes, aRes] = await Promise.all([
				fetchJson("/api/notifications").catch(() => ({ body: null })),
				fetchJson("/api/approvals/pending").catch(() => ({ body: null })),
			]);
			if (nRes.body && Array.isArray(nRes.body.notifications)) {
				notifications = nRes.body.notifications;
				// Authoritative server map → reconcile badges by REPLACE.
				if (nRes.body.unreadByKind && typeof nRes.body.unreadByKind === "object")
					setUnread(nRes.body.unreadByKind);
			}
			if (aRes.body && Array.isArray(aRes.body.pending)) {
				approvals = aRes.body.pending;
				syncPending();
			}
			loading = false;
			renderFallback();
			render();
		}

		function open(key) {
			// Toggle off if the same pill is clicked while open.
			if (openKey === key && !panel.hasAttribute("hidden")) {
				close();
				return;
			}
			openKey = key;
			panel.removeAttribute("hidden");
			render();
			refresh();
		}
		function close() {
			openKey = null;
			panel.setAttribute("hidden", "");
		}
		function isOpen() {
			return !panel.hasAttribute("hidden");
		}

		async function markRead(id) {
			const n = notifications.find((x) => x.id === id);
			if (!n || n.read) return;
			n.read = 1; // optimistic
			setUnread(decrementKind(getUnread(), n.kind, 1));
			render();
			const r = await fetchJson("/api/notifications/read", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id }),
			}).catch(() => ({ ok: false }));
			if (!r.ok) {
				// revert the optimistic read; the next refresh/ambient reconciles.
				n.read = 0;
				render();
			}
		}

		async function markAllRead(key) {
			if (!key) return;
			const unread = notifications.filter((x) => x.kind === key && !x.read);
			if (!unread.length) return;
			for (const x of unread) x.read = 1; // optimistic
			setUnread(clearKind(getUnread(), key));
			render();
			await Promise.all(
				unread.map((x) =>
					fetchJson("/api/notifications/read", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ id: x.id }),
					}).catch(() => ({ ok: false })),
				),
			);
		}

		function removeApproval(id) {
			approvals = approvals.filter((r) => r.id !== id);
		}
		function syncPending() {
			setPending(
				approvals.length,
				approvals.length ? `${approvals.length} pending` : "",
			);
		}

		async function resolveApproval(id, verb) {
			if (busy.has(id)) return;
			busy.add(id);
			render();
			const r = await fetchJson(`/api/approvals/${encodeURIComponent(id)}/${verb}`, {
				method: "POST",
			}).catch(() => ({ ok: false, status: 0 }));
			busy.delete(id);
			// Success OR already-resolved-elsewhere → drop the row either way.
			if (r.ok || isResolvedStatus(r.status)) {
				removeApproval(id);
				syncPending();
				renderFallback();
			}
			render();
		}
		function approve(id) {
			return resolveApproval(id, "approve");
		}
		function decline(id) {
			return resolveApproval(id, "deny");
		}

		// ── rendering (thin; the model above is the source of truth) ──
		function renderFallback() {
			const set = skillKeySet();
			const unmapped = approvals.filter(
				(r) => approvalBucket(r, set) === FALLBACK_KEY,
			).length;
			if (unmapped > 0) {
				fallbackChip.textContent = `Approvals · ${unmapped}`;
				fallbackChip.removeAttribute("hidden");
			} else {
				fallbackChip.setAttribute("hidden", "");
				if (openKey === FALLBACK_KEY && !unmapped) close();
			}
		}

		function render() {
			const m = model();
			panel.textContent = "";
			if (!m) return;

			const header = el(doc, "div", "inbox-header");
			header.appendChild(el(doc, "span", "inbox-title", m.label));
			const actions = el(doc, "div", "inbox-header-actions");
			const hasUnread = m.notifications.some((n) => !n.read);
			if (hasUnread) {
				const all = el(doc, "button", "inbox-mark-all", "Mark all read");
				all.setAttribute("type", "button");
				all.setAttribute("data-inbox-action", "read-all");
				actions.appendChild(all);
			}
			const x = el(doc, "button", "inbox-close", "×");
			x.setAttribute("type", "button");
			x.setAttribute("aria-label", "Close");
			x.setAttribute("data-inbox-action", "close");
			actions.appendChild(x);
			header.appendChild(actions);
			panel.appendChild(header);

			const list = el(doc, "div", "inbox-list");
			panel.appendChild(list);

			// Approvals first — they need a decision, not just a read.
			for (const a of m.approvals) {
				list.appendChild(approvalRow(a));
			}
			for (const n of m.notifications) {
				list.appendChild(notifRow(n));
			}

			if (!m.approvals.length && !m.notifications.length) {
				list.appendChild(
					el(
						doc,
						"div",
						"inbox-empty",
						m.loading ? "Loading…" : "Nothing here yet.",
					),
				);
			}
		}

		function approvalRow(a) {
			const row = el(doc, "div", "inbox-item inbox-approval");
			row.setAttribute("data-id", a.id);
			const body = el(doc, "div", "inbox-item-body");
			body.appendChild(
				el(doc, "div", "inbox-item-title", a.summary || a.action || "Approval"),
			);
			const meta = [a.action, a.repo].filter(Boolean).join(" · ");
			if (meta) body.appendChild(el(doc, "div", "inbox-item-detail", meta));
			row.appendChild(body);
			const ctrls = el(doc, "div", "inbox-approval-actions");
			const inFlight = busy.has(a.id);
			const ok = el(doc, "button", "inbox-btn inbox-approve", "Approve");
			ok.setAttribute("type", "button");
			ok.setAttribute("data-inbox-action", "approve");
			ok.setAttribute("data-id", a.id);
			const no = el(doc, "button", "inbox-btn inbox-decline", "Decline");
			no.setAttribute("type", "button");
			no.setAttribute("data-inbox-action", "decline");
			no.setAttribute("data-id", a.id);
			if (inFlight) {
				ok.setAttribute("disabled", "");
				no.setAttribute("disabled", "");
				row.classList.add("in-flight");
			}
			ctrls.appendChild(ok);
			ctrls.appendChild(no);
			row.appendChild(ctrls);
			return row;
		}

		function notifRow(n) {
			const cls = `inbox-item inbox-notif level-${n.level || "info"}${n.read ? "" : " unread"}`;
			const row = el(doc, "div", cls);
			row.setAttribute("data-id", n.id);
			if (!n.read) row.setAttribute("data-inbox-action", "read");
			const glyph =
				n.level === "error" || n.level === "warning" ? "needs" : "done";
			row.appendChild(el(doc, "span", `inbox-glyph glyph-${glyph}`));
			const bodyEl = el(doc, "div", "inbox-item-body");
			bodyEl.appendChild(el(doc, "div", "inbox-item-title", n.title || ""));
			if (n.body)
				bodyEl.appendChild(el(doc, "div", "inbox-item-detail", n.body));
			row.appendChild(bodyEl);
			const ts = relTime(n.created_at, now());
			if (ts) row.appendChild(el(doc, "span", "inbox-item-ts", ts));
			if (!n.read) row.appendChild(el(doc, "span", "inbox-unread-dot"));
			return row;
		}

		function destroy() {
			if (panel.parentNode) panel.parentNode.removeChild(panel);
			if (fallbackChip.parentNode)
				fallbackChip.parentNode.removeChild(fallbackChip);
		}

		return {
			el: panel,
			open,
			close,
			isOpen,
			openKey: () => openKey,
			refresh,
			markRead,
			markAllRead,
			approve,
			decline,
			model,
			// onAmbient is intentionally a no-op for panel content: badges reconcile
			// through the engine (setUnread/setPending), so a live tick can't clobber
			// the open panel or double-count. Reserved for future live-append.
			onAmbient: () => {},
			destroy,
			FALLBACK_KEY,
		};
	}

	window.CompanionInbox = {
		create,
		filterNotifications,
		approvalSkillKey,
		approvalBucket,
		approvalsFor,
		decrementKind,
		clearKind,
		isResolvedStatus,
		relTime,
		FALLBACK_KEY,
	};
})();
