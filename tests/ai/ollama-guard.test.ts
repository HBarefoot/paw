import { describe, expect, test, afterEach } from "bun:test";
import { OllamaProvider } from "../../src/ai/ollama-provider.js";
import { ToolRegistry } from "../../src/ai/tools.js";

const noopLogger = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as unknown as import("../../src/types/plugin.js").Logger;

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function ndjson(obj: unknown): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

describe("OllamaProvider generation caps", () => {
	test("sends options.num_predict and cuts off a runaway/repeating stream", async () => {
		let capturedBody: Record<string, unknown> | null = null;
		// A model stuck repeating the same sentence forever.
		const PHRASE =
			"Let me check the Docker containers that are currently running in your environment.";
		let pulls = 0;

		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			capturedBody = JSON.parse(init.body as string);
			const stream = new ReadableStream<Uint8Array>({
				pull(controller) {
					pulls++;
					// Emit the same content chunk over and over. The provider's
					// runaway guard must break long before this would end.
					controller.enqueue(
						ndjson({
							message: { role: "assistant", content: PHRASE },
							done: false,
						}),
					);
					// Hard stop so a broken guard can't hang the test forever.
					if (pulls > 100_000) controller.close();
				},
			});
			return new Response(stream, { status: 200 });
		}) as unknown as typeof fetch;

		const provider = new OllamaProvider(
			{
				baseUrl: "http://localhost:11434",
				model: "test-model",
				maxToolRoundtrips: 1,
				maxTokens: 4096,
			},
			new ToolRegistry(),
			noopLogger,
		);

		let text = "";
		let cutNoteSeen = false;
		let done = false;
		for await (const chunk of provider.chatStream([
			{ role: "user", content: "hi" },
		])) {
			if (chunk.type === "text_delta") {
				text += chunk.text;
				if (chunk.text.includes("Response stopped")) cutNoteSeen = true;
			}
			if (chunk.type === "done") done = true;
		}

		// num_predict was sent and is generous (canvas-safe floor of 8192).
		const opts = capturedBody?.options as { num_predict?: number } | undefined;
		expect(opts?.num_predict).toBeGreaterThanOrEqual(8192);
		// The guard cut the runaway off and finalized cleanly.
		expect(cutNoteSeen).toBe(true);
		expect(done).toBe(true);
		// It stopped well before consuming a pathological number of chunks.
		expect(pulls).toBeLessThan(100_000);
		// Accumulated text stayed bounded (didn't grow unbounded).
		expect(text.length).toBeLessThan(400_000);
	});
});
