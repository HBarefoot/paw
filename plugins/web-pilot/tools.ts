import type { Page } from "playwright";
import type { ToolDefinition } from "../../src/types/message.js";

export interface ConsoleEntry {
	level: string;
	text: string;
	ts: number;
}
export interface NetworkEntry {
	url: string;
	method: string;
	/** HTTP status, or 0 for a failed/aborted request. */
	status: number;
	failure?: string;
	ts: number;
}

export interface WebPilotDeps {
	getPage: (sessionId?: string) => Promise<Page>;
	readConsole: (sessionId?: string, level?: string) => ConsoleEntry[];
	readNetwork: (sessionId?: string, onlyFailures?: boolean) => NetworkEntry[];
	startRecording: (
		sessionId: string | undefined,
		url?: string,
	) => Promise<{ dir: string } | { error: string }>;
	stopRecording: (
		sessionId?: string,
	) => Promise<
		| { path: string; bytes: number; durationMs: number; overCap: boolean }
		| { error: string }
	>;
	attachPawSession: (
		sessionId?: string,
	) => Promise<{ host: string } | { error: string }>;
}

const sid = (input: Record<string, unknown>) =>
	input.session_id as string | undefined;

export function createWebPilotTools(deps: WebPilotDeps): ToolDefinition[] {
	const { getPage } = deps;
	return [
		{
			name: "browser_navigate",
			description: "Navigate to a URL in the browser",
			input_schema: {
				type: "object",
				properties: {
					url: { type: "string", description: "The URL to navigate to" },
					session_id: {
						type: "string",
						description: "Session ID for page isolation (optional)",
					},
				},
				required: ["url"],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const page = await getPage(sid(input));
				await page.goto(input.url as string, { waitUntil: "domcontentloaded" });
				const title = await page.title();
				return { content: `Navigated to ${input.url} - Title: "${title}"` };
			},
		},
		{
			name: "browser_get_text",
			description:
				"Get the visible text content of the current page or a specific selector",
			input_schema: {
				type: "object",
				properties: {
					selector: {
						type: "string",
						description: "CSS selector to get text from (defaults to body)",
					},
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: [],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const page = await getPage(sid(input));
				const selector = (input.selector as string) || "body";
				const text = await page.locator(selector).innerText({ timeout: 5000 });
				const trimmed = text.slice(0, 4000);
				return {
					content: trimmed + (text.length > 4000 ? "\n...[truncated]" : ""),
				};
			},
		},
		{
			name: "browser_click",
			description: "Click on an element matching the given CSS selector",
			input_schema: {
				type: "object",
				properties: {
					selector: {
						type: "string",
						description: "CSS selector of the element to click",
					},
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: ["selector"],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const page = await getPage(sid(input));
				await page.click(input.selector as string, { timeout: 5000 });
				return { content: `Clicked: ${input.selector}` };
			},
		},
		{
			name: "browser_fill",
			description: "Fill in a form field with text",
			input_schema: {
				type: "object",
				properties: {
					selector: {
						type: "string",
						description: "CSS selector of the input field",
					},
					value: { type: "string", description: "Text to fill in" },
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: ["selector", "value"],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const page = await getPage(sid(input));
				await page.fill(input.selector as string, input.value as string, {
					timeout: 5000,
				});
				return { content: `Filled "${input.selector}" with "${input.value}"` };
			},
		},
		{
			name: "browser_screenshot",
			description: "Take a screenshot of the current page",
			input_schema: {
				type: "object",
				properties: {
					full_page: {
						type: "boolean",
						description: "Capture the full page (default: false)",
					},
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: [],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const page = await getPage(sid(input));
				const buffer = await page.screenshot({
					fullPage: (input.full_page as boolean) ?? false,
				});
				const base64 = buffer.toString("base64");
				return {
					content: `Screenshot captured (${buffer.byteLength} bytes). Base64: ${base64.slice(0, 200)}...`,
				};
			},
		},
		{
			name: "browser_evaluate",
			description:
				"Execute JavaScript in the browser page context and return the result. Requires allow_javascript: true to be set; without it the call is rejected as a safety measure against arbitrary code execution in a page that may have authenticated state.",
			input_schema: {
				type: "object",
				properties: {
					expression: {
						type: "string",
						description: "JavaScript expression to evaluate",
					},
					allow_javascript: {
						type: "boolean",
						description:
							"Must be set to true to confirm the caller understands the page will run this expression in its full JS context.",
					},
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: ["expression", "allow_javascript"],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				// H-NEW-10: refuse unless the caller explicitly opts in.
				if (input.allow_javascript !== true) {
					return {
						content:
							"browser_evaluate requires allow_javascript: true. " +
							"Refusing to run arbitrary JavaScript in a page that may have authenticated state.",
						is_error: true,
					};
				}
				const expression = String(input.expression ?? "");
				if (expression.length === 0 || expression.length > 10_000) {
					return {
						content: "Expression must be 1..10000 characters",
						is_error: true,
					};
				}
				const page = await getPage(sid(input));
				const result = await page.evaluate(expression);
				return { content: JSON.stringify(result, null, 2) };
			},
		},
		{
			name: "browser_console",
			description:
				"Read recent console messages from the current page (for diagnosing a broken page). Optionally filter by level (e.g. 'error', 'warning').",
			input_schema: {
				type: "object",
				properties: {
					level: {
						type: "string",
						description: "Filter to one console level, e.g. 'error' (optional)",
					},
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: [],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const entries = deps.readConsole(sid(input), input.level as string);
				if (entries.length === 0)
					return { content: "No console messages captured." };
				const lines = entries
					.slice(-50)
					.map((e) => `[${e.level}] ${e.text}`)
					.join("\n");
				return { content: lines };
			},
		},
		{
			name: "browser_network",
			description:
				"Read recent network activity from the current page — failed requests and 4xx/5xx responses by default — to diagnose why a page is broken.",
			input_schema: {
				type: "object",
				properties: {
					only_failures: {
						type: "boolean",
						description:
							"Only failed/aborted requests + 4xx/5xx responses (default: true)",
					},
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: [],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const onlyFailures = (input.only_failures as boolean) ?? true;
				const entries = deps.readNetwork(sid(input), onlyFailures);
				if (entries.length === 0)
					return { content: "No matching network activity captured." };
				const lines = entries
					.slice(-50)
					.map(
						(e) =>
							`${e.status || "ERR"} ${e.method} ${e.url}${e.failure ? ` (${e.failure})` : ""}`,
					)
					.join("\n");
				return { content: lines };
			},
		},
		{
			name: "browser_record_start",
			description:
				"Start recording a video of the browser session. Drive the page with the other browser_* tools, then call browser_record_stop to save the video. Auto-stops at the configured max duration.",
			input_schema: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "Optional URL to open as the recording begins",
					},
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: [],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const res = await deps.startRecording(sid(input), input.url as string);
				if ("error" in res) return { content: res.error, is_error: true };
				return { content: `Recording started → ${res.dir}` };
			},
		},
		{
			name: "browser_record_stop",
			description:
				"Stop the active recording and save the video, returning its artifact path.",
			input_schema: {
				type: "object",
				properties: {
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: [],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const res = await deps.stopRecording(sid(input));
				if ("error" in res) return { content: res.error, is_error: true };
				const cap = res.overCap ? " ⚠️ exceeds size cap" : "";
				return {
					content: `Recording saved: ${res.path} (${res.bytes} bytes, ${res.durationMs}ms)${cap}`,
				};
			},
		},
		{
			name: "browser_attach_session",
			description:
				"Attach the owner's paw session to the headless browser so it can load auth-gated paw pages (e.g. /api/app/<space>). Owner-only: the session token comes from server config, never from this call. Scoped to the configured paw host and the paw_session cookie only.",
			input_schema: {
				type: "object",
				properties: {
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: [],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const res = await deps.attachPawSession(sid(input));
				if ("error" in res) return { content: res.error, is_error: true };
				return {
					content: `Attached owner paw session for ${res.host}. You can now navigate to auth-gated paw pages on that host.`,
				};
			},
		},
	];
}
