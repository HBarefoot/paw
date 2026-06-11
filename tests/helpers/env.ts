// Test helper: make tests hermetic against the developer's local environment.
//
// Several modules fall back to `process.env.PAW_*` (the vault master key, the
// config loader's credential cascade, log level, db path, …). A developer with
// a populated local `.env` would otherwise see tests pass/fail depending on
// their machine — and CI would inherit that noise from day one. Scrub all
// `PAW_*` vars for the duration of a test, then restore the exact prior state.

/**
 * Remove every `PAW_*` env var and return a restore function that puts the
 * environment back exactly as it was (deleting any `PAW_*` var a test added,
 * restoring any it cleared/changed). Call the returned fn in afterAll/afterEach.
 */
export function scrubPawEnv(): () => void {
	const snapshot = new Map<string, string>();
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("PAW_")) {
			const v = process.env[key];
			if (v !== undefined) snapshot.set(key, v);
			delete process.env[key];
		}
	}
	return () => {
		// Drop anything PAW_* added during the test, then restore the snapshot.
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("PAW_")) delete process.env[key];
		}
		for (const [key, value] of snapshot) {
			process.env[key] = value;
		}
	};
}
