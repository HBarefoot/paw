/**
 * Strip markdown code fences (```json ... ```) that LLMs often wrap around JSON output.
 */
export function stripCodeFences(text: string): string {
	const trimmed = text.trim();
	const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
	return match ? match[1].trim() : trimmed;
}
