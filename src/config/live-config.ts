import type { PawConfig } from "../types/config.js";
import { applySecurityEnvIds } from "./loader.js";

/**
 * Overlay persisted `config.json` overrides onto the boot config for a live
 * (no-restart) read, WITHOUT dropping sibling keys of nested objects.
 *
 * The prior shallow `{ ...config, ...overrides }` let a PARTIAL `overrides.security`
 * REPLACE the fully-parsed `config.security` wholesale. A Persist/make-owner write
 * persists only the touched key (e.g. `replaceConfigOverride("security.allowedUsers", …)`),
 * so `config.json.security` is often just `{ allowedUsers: [...] }` — and the
 * shallow merge then wiped `ownerUserIds` / `blockedUsers` / `allowUnapprovedExternal`
 * at runtime. That is the `/access` "no Owners section, 0 approved / 0 pending"
 * bug and the intermittent owner-recognition loss.
 *
 * Fix: deep-merge `security` (and `agent`, already special-cased) ONE level so an
 * override only replaces the keys it actually sets. Then UNION the `PAW_SECURITY_*`
 * env ids so an env-declared owner is present even if `config.json` set a
 * different/empty list. All OTHER top-level keys keep the existing shallow-replace
 * semantics (e.g. `replaceConfigOverride("mcpServers", map)` expresses removals by
 * replacing the whole map — deep-merging that would resurrect removed servers).
 */
export function mergeLiveConfig(
	config: PawConfig,
	overrides: Record<string, unknown>,
): PawConfig {
	const oAgent = (overrides.agent as Record<string, unknown>) ?? {};
	const oSecurity = (overrides.security as Record<string, unknown>) ?? {};
	return {
		...config,
		...overrides,
		agent: { ...config.agent, ...oAgent },
		security: applySecurityEnvIds({
			...(config.security as unknown as Record<string, unknown>),
			...oSecurity,
		}) as unknown as PawConfig["security"],
	} as PawConfig;
}
