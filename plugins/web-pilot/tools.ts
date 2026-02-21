import type { Browser, Page } from "playwright";
import type { ToolDefinition } from "../../src/types/message.js";

export function createWebPilotTools(
	getPage: (sessionId?: string) => Promise<Page>,
): ToolDefinition[] {
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
				const page = await getPage(input.session_id as string | undefined);
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
				const page = await getPage(input.session_id as string | undefined);
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
				const page = await getPage(input.session_id as string | undefined);
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
				const page = await getPage(input.session_id as string | undefined);
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
				const page = await getPage(input.session_id as string | undefined);
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
				"Execute JavaScript in the browser page context and return the result",
			input_schema: {
				type: "object",
				properties: {
					expression: {
						type: "string",
						description: "JavaScript expression to evaluate",
					},
					session_id: { type: "string", description: "Session ID (optional)" },
				},
				required: ["expression"],
			},
			plugin: "web-pilot",
			handler: async (input) => {
				const page = await getPage(input.session_id as string | undefined);
				const result = await page.evaluate(input.expression as string);
				return { content: JSON.stringify(result, null, 2) };
			},
		},
	];
}
