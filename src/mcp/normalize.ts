/**
 * MCP server name normalization + case-variant dedup.
 *
 * Server names are the storage key, the live-connection key, the vault slot
 * (`mcp.<name>.authToken`), AND the tool namespace (`mcp__<name>__<tool>`).
 * Stored verbatim, `HubSpot` / `hubSpot` / `hubspot` became three distinct
 * servers — each had to be removed separately, and the merge-on-save bug then
 * resurrected whichever was removed. Canonical rule: **lowercase the name**.
 * (Lowercasing keeps it valid under the MCP identifier check
 * `^[A-Za-z][A-Za-z0-9_-]*$`.) The UI shows the canonical lowercase name.
 */

export type McpServerMap = Record<string, unknown>;

/** Canonical key for an MCP server name (trimmed + lowercased). */
export function normalizeMcpName(name: string): string {
	return name.trim().toLowerCase();
}

/**
 * Add/update a server under its canonical key. A re-add of a differently-cased
 * name UPDATES the existing entry instead of forking a new one. Returns a new map.
 */
export function upsertMcpServer(
	map: McpServerMap,
	name: string,
	config: unknown,
): McpServerMap {
	const next = dedupeMcpServers(map).servers;
	next[normalizeMcpName(name)] = config;
	return next;
}

/** Remove a server by name (canonical key + any stray case-variants). Returns a new map. */
export function removeMcpServer(map: McpServerMap, name: string): McpServerMap {
	const canonical = normalizeMcpName(name);
	const next: McpServerMap = {};
	for (const [k, v] of Object.entries(map)) {
		if (normalizeMcpName(k) === canonical) continue; // drop all variants
		next[k] = v;
	}
	return dedupeMcpServers(next).servers;
}

/**
 * Collapse case-variant keys to a single canonical (lowercase) key. Later
 * entries win on collision (deterministic by iteration order). `changed` is
 * false when the map is already canonical — so callers can persist only when
 * something actually moved (idempotent, safe when there are no dupes).
 */
export function dedupeMcpServers(map: McpServerMap): {
	servers: McpServerMap;
	changed: boolean;
} {
	const servers: McpServerMap = {};
	let changed = false;
	for (const [k, v] of Object.entries(map)) {
		const canonical = normalizeMcpName(k);
		if (canonical !== k) changed = true; // a key was renamed
		if (canonical in servers) changed = true; // a variant collided
		servers[canonical] = v;
	}
	return { servers, changed };
}
