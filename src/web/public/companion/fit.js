/**
 * CompanionFit — the pure scale-to-fit math for the companion dock.
 *
 * `scaleToFit()` in shell.js measures the iframe (root) and the natural dock
 * (.home), then shrinks the `.fit` wrapper by `transform: scale(s)`. That math
 * is extracted here so it is unit-testable AND so the degenerate-measure case
 * has ONE honest answer: when any dimension is unmeasurable (0 / non-finite —
 * e.g. the Home tab was `display:none` so the iframe never laid out and rAF was
 * suppressed), return `null`. The caller then KEEPS the last good scale instead
 * of snapping to `scale(1)` (natural size), which — centered + clipped — is what
 * decapitated the orb at the top of the Home tab.
 *
 * No DOM, no timers: `computeFitScale(rw, rh, cw, ch)` is a plain function.
 */
(() => {
	/**
	 * @param {number} rw  root (iframe) client width
	 * @param {number} rh  root (iframe) client height
	 * @param {number} cw  content (.home) natural width
	 * @param {number} ch  content (.home) natural height
	 * @returns {number|null} scale in (0, 1], or null when unmeasurable
	 */
	function computeFitScale(rw, rh, cw, ch) {
		// Any non-finite or non-positive dimension means we cannot trust the
		// measurement — signal "unmeasurable" so the caller holds the last scale.
		for (const v of [rw, rh, cw, ch]) {
			if (!Number.isFinite(v) || v <= 0) return null;
		}
		const s = Math.min(1, rw / cw, rh / ch);
		return Number.isFinite(s) && s > 0 ? s : null;
	}

	window.CompanionFit = { computeFitScale };
})();
