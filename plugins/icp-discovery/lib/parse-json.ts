/**
 * Strip markdown code fences (```json ... ```) that LLMs often wrap around JSON output.
 * If that doesn't yield valid JSON, extract the first top-level { ... } or [ ... ] block.
 */
export function stripCodeFences(text: string): string {
	const trimmed = text.trim();

	// Try markdown code fence extraction first
	const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
	if (fenceMatch) return fenceMatch[1].trim();

	// If the whole string is already JSON-shaped, return as-is
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

	// Extract the first balanced { ... } or [ ... ] block from narrative text
	const objStart = trimmed.indexOf("{");
	const arrStart = trimmed.indexOf("[");

	// Pick whichever delimiter appears first (-1 means not found)
	let start: number;
	let open: string;
	let close: string;
	if (objStart === -1 && arrStart === -1) return trimmed;
	if (arrStart === -1 || (objStart !== -1 && objStart < arrStart)) {
		start = objStart;
		open = "{";
		close = "}";
	} else {
		start = arrStart;
		open = "[";
		close = "]";
	}

	let depth = 0;
	let inString = false;
	let escape = false;
	for (let i = start; i < trimmed.length; i++) {
		const ch = trimmed[i];
		if (escape) {
			escape = false;
			continue;
		}
		if (ch === "\\") {
			escape = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (ch === open) depth++;
		else if (ch === close) {
			depth--;
			if (depth === 0) return trimmed.slice(start, i + 1);
		}
	}

	return trimmed;
}
