/**
 * Check if a brand name matches any entry in the exclude list.
 * Uses substring matching (both directions) so:
 *   - "Jersey Mike's" matches "Jersey Mike's Subs"
 *   - "Wingstop Restaurants" matches "Wingstop"
 */
export function isExcluded(brandName: string, excludeList: string[]): boolean {
	if (!excludeList.length) return false;
	const name = brandName.toLowerCase().trim();
	for (const excluded of excludeList) {
		const ex = excluded.toLowerCase().trim();
		if (!ex) continue;
		if (name === ex) return true;
		if (name.includes(ex) || ex.includes(name)) return true;
	}
	return false;
}
