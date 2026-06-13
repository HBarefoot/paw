/**
 * CompanionSpring — a tiny under-damped spring for the avatar's micro-physics.
 *
 * Pure numerics (no DOM, no timers) so the squash/stretch is unit-testable:
 * `step(s, target, dt)` integrates one frame toward `target` with anticipation →
 * overshoot → settle. The renderer drives a couple of these (orb pop, posture)
 * and reads the eased `value`. Honours prefers-reduced-motion by snapping
 * instantly (the CSS `@media (prefers-reduced-motion: reduce)` block already
 * kills declarative animation; this is the JS half).
 */
(() => {
	// Gently under-damped (ratio ~0.79) → a soft glide with minimal overshoot.
	// Softer than the original 170/16 (ratio ~0.61): lower stiffness eases the
	// snap, higher damping trims the bounce, so the squash/stretch reads smoother.
	const SPRING = { stiffness: 130, damping: 18 };
	const MAX_DT = 0.064; // clamp long frames so a tab-switch can't explode it

	/** A fresh spring sitting at `value` (velocity 0). */
	function make(value) {
		return { value: value || 0, velocity: 0 };
	}

	/**
	 * Integrate one frame toward `target`. Mutates + returns `s`.
	 * @param {{value:number,velocity:number}} s
	 * @param {number} target
	 * @param {number} dt    seconds since the last step
	 * @param {{stiffness?:number,damping?:number,reduced?:boolean}} [cfg]
	 */
	function step(s, target, dt, cfg) {
		cfg = cfg || {};
		if (cfg.reduced) {
			s.value = target;
			s.velocity = 0;
			return s;
		}
		const k = cfg.stiffness || SPRING.stiffness;
		const c = cfg.damping || SPRING.damping;
		const h = Math.min(MAX_DT, Math.max(0, dt || 0));
		const accel = -k * (s.value - target) - c * s.velocity;
		s.velocity += accel * h;
		s.value += s.velocity * h;
		return s;
	}

	/** Live read of the user's motion preference (false when unavailable). */
	function prefersReducedMotion() {
		try {
			return (
				typeof window.matchMedia === "function" &&
				window.matchMedia("(prefers-reduced-motion: reduce)").matches
			);
		} catch {
			return false;
		}
	}

	window.CompanionSpring = { SPRING, make, step, prefersReducedMotion };
})();
