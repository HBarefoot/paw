/**
 * Converts a tool name + raw input into a human-readable one-liner
 * for display in the activity timeline.
 */
export function summarizeToolInput(
	toolName: string,
	input: Record<string, unknown>,
): string {
	switch (toolName) {
		case "file_read":
			return `Reading ${input.path || "file"}`;
		case "file_write":
			return `Writing ${input.path || "file"}`;
		case "file_list":
			return `Listing ${input.path || "directory"}`;
		case "exec_command":
			return `Running: ${truncate(String(input.command || ""), 80)}`;
		case "canvas_write":
			return `Writing canvas: ${input.path || "file"}`;
		case "canvas_read":
			return `Reading canvas: ${input.path || "file"}`;
		case "canvas_list":
			return "Listing canvas files";
		case "activate_skill":
			return `Activating skill: ${input.skill || "unknown"}`;
		case "memory_store":
			return `Storing memory: ${truncate(String(input.text || ""), 60)}`;
		case "memory_recall":
			return `Recalling: ${truncate(String(input.query || ""), 60)}`;
		case "memory_forget":
			return `Forgetting memory: ${input.id || ""}`;
		default: {
			// Generic fallback: show first string value from input
			const firstVal = Object.values(input).find(
				(v) => typeof v === "string" && v.length > 0,
			);
			if (firstVal) {
				return `${toolName}: ${truncate(String(firstVal), 80)}`;
			}
			return toolName;
		}
	}
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}...` : s;
}
