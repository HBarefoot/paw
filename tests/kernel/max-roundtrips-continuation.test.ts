import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AIProvider,
	ChatResponse,
	StreamChunk,
} from "../../src/ai/base-provider.js";
import type { ToolRegistry } from "../../src/ai/tools.js";
import { defaults } from "../../src/config/defaults.js";
import { Kernel } from "../../src/kernel/kernel.js";
import type { PawConfig } from "../../src/types/config.js";
import type { InboundMessage } from "../../src/types/message.js";
import { scrubPawEnv } from "../helpers/env.js";

// When a provider streams a `max_roundtrips` checkpoint mid-task, the kernel
// must run ONE automatic continuation leg (from the compacted checkpoint) before
// finishing — surfacing a "▸ Checkpoint …" progress line and NEVER forwarding
// the internal checkpoint chunk to the UI. This FAILS on pre-fix code, which had
// no continuation: the provider was called once and the run dead-ended.

/** A fake provider: leg 1 hits the cap (checkpoint chunk), leg 2 finishes. */
class FakeProvider implements AIProvider {
	readonly name = "fake";
	readonly toolRegistry: ToolRegistry;
	calls = 0;
	constructor(reg: ToolRegistry) {
		this.toolRegistry = reg;
	}
	async chat(): Promise<ChatResponse> {
		throw new Error("chat() should not be used on the streaming path");
	}
	async *chatStream(): AsyncGenerator<StreamChunk> {
		this.calls++;
		if (this.calls === 1) {
			yield { type: "text_delta", text: "partial work" };
			yield {
				type: "checkpoint",
				stopReason: "max_roundtrips",
				roundtripsUsed: 3,
				checkpoint: "DONE: step A\nLEFT: step B\nKEY ARTIFACTS/IDS: file.ts",
			};
		} else {
			yield { type: "text_delta", text: "finished" };
			yield { type: "done" };
		}
	}
}

function inbound(): InboundMessage {
	return {
		id: "m1",
		sessionId: "s-continuation",
		channel: "web",
		content: "do the long task",
		user: { id: "web-1", name: "Admin" },
		authenticated: true, // gate-exempt web admin
		timestamp: "2026-07-02T00:00:00.000Z",
	};
}

describe("kernel — automatic checkpointed continuation (stream)", () => {
	let restoreEnv: () => void;
	let tmp: string;
	let kernel: Kernel;
	let fake: FakeProvider;

	beforeEach(() => {
		restoreEnv = scrubPawEnv();
		tmp = mkdtempSync(join(tmpdir(), "paw-cont-"));
		const config: PawConfig = {
			...defaults,
			store: { ...defaults.store, dbPath: join(tmp, "paw.db") },
			// Keep construction light + hermetic: no embedding model load.
			memory: { ...defaults.memory, enabled: false, autoExtract: false },
		};
		kernel = new Kernel(config);
		fake = new FakeProvider(
			(kernel as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
		);
		// Route text turns through the fake; no fallback chain.
		(kernel as unknown as { provider: AIProvider }).provider = fake;
		(kernel as unknown as { fallbackChain: unknown[] }).fallbackChain = [];
	});

	afterEach(async () => {
		await kernel.shutdown();
		rmSync(tmp, { recursive: true, force: true });
		restoreEnv();
	});

	test("continues once from the checkpoint and never leaks the checkpoint chunk", async () => {
		const chunks: StreamChunk[] = [];
		for await (const c of kernel.handleInboundStream(inbound())) {
			chunks.push(c);
		}

		// Exactly two legs: leg 1 capped, leg 2 finished.
		expect(fake.calls).toBe(2);

		const streamed = chunks
			.filter((c) => c.type === "text_delta")
			.map((c) => c.text ?? "")
			.join("");
		expect(streamed).toContain("partial work"); // leg-1 output preserved
		expect(streamed).toContain("▸ Checkpoint"); // progress line surfaced
		expect(streamed).toContain("finished"); // continuation ran
		expect(streamed).not.toContain("maximum number of tool-use steps");

		// The internal checkpoint chunk is consumed by the kernel, never forwarded.
		expect(chunks.some((c) => c.type === "checkpoint")).toBe(false);
		// Turn still terminates with a messageId for the UI.
		expect(chunks.at(-1)?.type).toBe("done");
		expect(chunks.at(-1)?.messageId).toBeTruthy();
	});

	test("non-stream path also continues once (chat() called twice)", async () => {
		// A provider with only chat() (no chatStream) exercises handleInbound.
		const nsFake = {
			name: "fake-ns",
			toolRegistry: (kernel as unknown as { toolRegistry: ToolRegistry })
				.toolRegistry,
			calls: 0,
			async chat(): Promise<ChatResponse> {
				this.calls++;
				return this.calls === 1
					? {
							text: "partial",
							stopReason: "max_roundtrips",
							roundtripsUsed: 3,
							checkpoint: "DONE: step A\nLEFT: step B",
						}
					: { text: "finished", stopReason: "end_turn" };
			},
		} as unknown as AIProvider & { calls: number };
		(kernel as unknown as { provider: AIProvider }).provider = nsFake;

		const bus = (
			kernel as unknown as {
				bus: {
					on: (e: string, cb: (p: { content: string }) => void) => void;
					emit: (e: string, p: InboundMessage) => Promise<void>;
				};
			}
		).bus;
		const outbound = new Promise<{ content: string }>((resolve) => {
			bus.on("message:outbound", resolve);
		});
		await bus.emit("message:inbound", inbound());
		const { content } = await outbound;

		expect(nsFake.calls).toBe(2);
		expect(content).toContain("▸ Checkpoint");
		expect(content).toContain("finished");
		expect(content).not.toContain("maximum number of tool-use steps");
	});
});
