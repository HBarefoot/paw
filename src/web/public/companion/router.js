/**
 * CompanionRouter — orthogonal, n8n-style connector routing (SVG path strings).
 *
 * Verbatim port of the design prototype's `orthPath`: straight H/V runs with
 * ~12px rounded (quadratic) elbows, dominant-axis routing, and near-aligned
 * pairs collapse to a single straight line. Returns an SVG `d` string so the
 * companion can render real <path> tethers with <animateMotion> particles
 * flowing along the elbows (no canvas approximation).
 */
(() => {
	const ELBOW_R = 12;

	/** Orthogonal path from (sx,sy) to (ex,ey). Returns an SVG `d` string or null. */
	function orthPath(sx, sy, ex, ey) {
		const dx = ex - sx;
		const dy = ey - sy;
		if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
		if (Math.abs(dx) >= Math.abs(dy)) {
			// horizontal → vertical → horizontal
			if (Math.abs(dy) < 8) return `M ${sx} ${sy} L ${ex} ${ey}`;
			const midX = (sx + ex) / 2;
			const dx1 = Math.sign(midX - sx) || 1;
			const dyv = Math.sign(dy) || 1;
			const dx2 = Math.sign(ex - midX) || 1;
			const r = Math.min(
				ELBOW_R,
				Math.abs(midX - sx),
				Math.abs(ex - midX),
				Math.abs(dy) / 2,
			);
			return [
				"M", sx, sy,
				"L", midX - dx1 * r, sy,
				"Q", midX, sy, midX, sy + dyv * r,
				"L", midX, ey - dyv * r,
				"Q", midX, ey, midX + dx2 * r, ey,
				"L", ex, ey,
			].join(" ");
		}
		// vertical → horizontal → vertical
		if (Math.abs(dx) < 8) return `M ${sx} ${sy} L ${ex} ${ey}`;
		const midY = (sy + ey) / 2;
		const dy1 = Math.sign(midY - sy) || 1;
		const dxh = Math.sign(dx) || 1;
		const dy2 = Math.sign(ey - midY) || 1;
		const r = Math.min(
			ELBOW_R,
			Math.abs(midY - sy),
			Math.abs(ey - midY),
			Math.abs(dx) / 2,
		);
		return [
			"M", sx, sy,
			"L", sx, midY - dy1 * r,
			"Q", sx, midY, sx + dxh * r, midY,
			"L", ex - dxh * r, midY,
			"Q", ex, midY, ex, midY + dy2 * r,
			"L", ex, ey,
		].join(" ");
	}

	/**
	 * Anchor a beam from a source rect's edge to a target circle's edge along the
	 * dominant axis (matches the prototype's exit/landing offsets). `src` is
	 * {cx,cy,w,h}; `tgt` is {cx,cy,rad}. `pad`/`tpad` are the edge gaps.
	 */
	function anchor(src, tgt, pad, tpad) {
		pad = pad == null ? 5 : pad;
		tpad = tpad == null ? 10 : tpad;
		const dx0 = tgt.cx - src.cx;
		const dy0 = tgt.cy - src.cy;
		if (Math.abs(dx0) >= Math.abs(dy0)) {
			const dir = Math.sign(dx0) || 1;
			return {
				sx: src.cx + dir * (src.w / 2 + pad),
				sy: src.cy,
				ex: tgt.cx - dir * (tgt.rad + tpad),
				ey: tgt.cy,
			};
		}
		const dir = Math.sign(dy0) || 1;
		return {
			sx: src.cx,
			sy: src.cy + dir * (src.h / 2 + pad),
			ex: tgt.cx,
			ey: tgt.cy - dir * (tgt.rad + tpad),
		};
	}

	window.CompanionRouter = { orthPath, anchor, ELBOW_R };
})();
