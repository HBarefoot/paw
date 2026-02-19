import { isAbsolute, resolve } from "node:path";

// Project root: one level up from src/
export const PROJECT_ROOT = resolve(import.meta.dir, "..");

/**
 * Resolve a path that may be relative. Relative paths are resolved
 * against the project root (where package.json lives), not process.cwd().
 */
export function resolveProjectPath(p: string): string {
	if (isAbsolute(p)) return p;
	return resolve(PROJECT_ROOT, p);
}
