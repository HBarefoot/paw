/**
 * CompanionRouter — orthogonal, n8n-style connector routing.
 *
 * Pure geometry: straight horizontal/vertical runs, dominant-axis routing, and
 * near-aligned pairs collapse to a single straight line. Rendering adds ~12px
 * rounded elbows via canvas arcTo. Served as a real module (no template-literal
 * cook trap), so plain modern JS is fine.
 */
(() => {
	/**
	 * Route a connector from `a` to `b`. Returns an array of {x,y} waypoints.
	 * - within `alignTol` on an axis → straight 2-point line (collapse).
	 * - else route along the dominant axis first with a single mid bend.
	 */
	function route(a, b, opts) {
		opts = opts || {};
		const align = opts.alignTol == null ? 6 : opts.alignTol;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		if (Math.abs(dy) <= align || Math.abs(dx) <= align) {
			return [
				{ x: a.x, y: a.y },
				{ x: b.x, y: b.y },
			];
		}
		if (Math.abs(dx) >= Math.abs(dy)) {
			// Horizontal dominant: H → V → H through a mid x.
			const mx = a.x + dx / 2;
			return [
				{ x: a.x, y: a.y },
				{ x: mx, y: a.y },
				{ x: mx, y: b.y },
				{ x: b.x, y: b.y },
			];
		}
		// Vertical dominant: V → H → V through a mid y.
		const my = a.y + dy / 2;
		return [
			{ x: a.x, y: a.y },
			{ x: a.x, y: my },
			{ x: b.x, y: my },
			{ x: b.x, y: b.y },
		];
	}

	/** Stroke a waypoint polyline with rounded elbows onto a 2D context. */
	function stroke(ctx, pts, radius) {
		if (!pts || pts.length < 2) return;
		const r = radius == null ? 12 : radius;
		ctx.beginPath();
		ctx.moveTo(pts[0].x, pts[0].y);
		for (let i = 1; i < pts.length - 1; i++) {
			ctx.arcTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, r);
		}
		ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
		ctx.stroke();
	}

	/** Total length of a polyline (for dash/particle animation). */
	function length(pts) {
		let total = 0;
		for (let i = 1; i < pts.length; i++) {
			total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		}
		return total;
	}

	/** Point at distance `d` along the polyline (for flowing particles). */
	function pointAt(pts, d) {
		for (let i = 1; i < pts.length; i++) {
			const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
			if (d <= seg || i === pts.length - 1) {
				const t = seg === 0 ? 0 : d / seg;
				return {
					x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
					y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
				};
			}
			d -= seg;
		}
		return pts[pts.length - 1];
	}

	window.CompanionRouter = { route, stroke, length, pointAt };
})();
