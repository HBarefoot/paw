/**
 * CompanionDock — the capped left skill column + smart overflow chip.
 *
 * The current companion made scalable: show at most `max` skill pills; the rest
 * collapse into one overflow chip ("+84 · webhooks"). When a hidden skill fires,
 * the chip lights up and surfaces that skill's label so you can see what's
 * active even though its pill isn't on screen. Pills are decorative/status —
 * not interactive.
 */
(() => {
	function containsKey(arr, key) {
		for (let i = 0; i < arr.length; i++) {
			if (arr[i].key === key) return true;
		}
		return false;
	}

	/**
	 * @param {Array<{key,label}>} skills  full ordered skill list
	 * @param {{max?:number, activeHiddenKey?:string|null}} opts
	 *   activeHiddenKey: a currently-active skill key (to surface in the chip if
	 *   it's hidden).
	 * @returns {{visible:Array, overflow:null|{count,label,hot}}}
	 */
	function computeColumn(skills, opts) {
		opts = opts || {};
		const max = opts.max == null ? 16 : opts.max;
		const activeKey = opts.activeHiddenKey || null;
		if (skills.length <= max) {
			return { visible: skills.slice(), overflow: null };
		}
		const visible = skills.slice(0, max);
		const hidden = skills.slice(max);
		const hot = !!(activeKey && containsKey(hidden, activeKey));
		let label = `+${hidden.length}`;
		if (hot) {
			let hit = null;
			for (let i = 0; i < hidden.length; i++) {
				if (hidden[i].key === activeKey) {
					hit = hidden[i];
					break;
				}
			}
			if (hit) label = `+${hidden.length} · ${hit.label}`;
		}
		return { visible, overflow: { count: hidden.length, label, hot } };
	}

	window.CompanionDock = { computeColumn };
})();
