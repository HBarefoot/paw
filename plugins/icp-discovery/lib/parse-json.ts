/**
 * Strip markdown code fences (```json ... ```) that LLMs often wrap around JSON output.
 * If that doesn't yield valid JSON, extract the first top-level { ... } object from the text.
 */
export function stripCodeFences(text: string): string {
	const trimmed = text.trim();

	// Try markdown code fence extraction first
	const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
	if (fenceMatch) return fenceMatch[1].trim();

	// If the whole string is already JSON-shaped, return as-is
	if (trimmed.startsWith("{")) return trimmed;

	// Extract the first balanced { ... } block from narrative text
	const start = trimmed.indexOf("{");
	if (start === -1) return trimmed;

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
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return trimmed.slice(start, i + 1);
		}
	}

	return trimmed;
}
