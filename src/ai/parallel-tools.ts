import type { ToolResult, ToolResultImage } from "../types/message.js";
import type { StreamChunk } from "./base-provider.js";
import { summarizeToolInput } from "./tool-summary.js";
import type { ToolRegistry } from "./tools.js";

export interface ToolCallRequest {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolCallResult {
	id: string;
	name: string;
	content: string;
	is_error?: boolean;
	images?: ToolResultImage[];
	durationMs: number;
}

interface Logger {
	info: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Executes multiple tool calls in parallel with per-tool timeout and error isolation.
 * Returns results in the same order as the input calls.
 */
export async function executeToolsParallel(
	calls: ToolCallRequest[],
	toolRegistry: ToolRegistry,
	logger: Logger,
	timeoutMs = 600_000,
): Promise<ToolCallResult[]> {
	const promises = calls.map(async (call): Promise<ToolCallResult> => {
		const startTime = Date.now();
		logger.info("Executing tool", { tool: call.name, id: call.id });
		let result: ToolResult;
		try {
			result = await Promise.race([
				toolRegistry.execute(call.name, call.input),
				new Promise<never>((_, reject) =>
					setTimeout(
						() =>
							reject(
								new Error(
									`Tool "${call.name}" timed out after ${Math.round(timeoutMs / 60_000)} minutes`,
								),
							),
						timeoutMs,
					),
				),
			]);
		} catch (err) {
			result = {
				content: err instanceof Error ? err.message : String(err),
				is_error: true,
			};
		}
		return {
			id: call.id,
			name: call.name,
			content: result.content ?? "",
			is_error: result.is_error,
			images: result.images,
			durationMs: Date.now() - startTime,
		};
	});

	return Promise.all(promises);
}

/**
 * Streaming variant: yields tool_start/tool_end StreamChunks.
 *
 * - Single tool with streamHandler: uses streamHandler for full detail forwarding
 *   (sub-agent intermediate chunks visible in activity feed).
 * - Multiple tools: yields all tool_start events, executes in parallel,
 *   yields tool_end as each completes via race-drain.
 *
 * Returns the ToolCallResult[] as the generator's return value.
 */
export async function* executeToolsParallelStreaming(
	calls: ToolCallRequest[],
	toolRegistry: ToolRegistry,
	logger: Logger,
	roundtrip: number,
	timeoutMs = 600_000,
): AsyncGenerator<StreamChunk, ToolCallResult[]> {
	// Single tool with streamHandler: use it for full sub-agent detail forwarding
	if (calls.length === 1) {
		const call = calls[0];
		const toolDef = toolRegistry.get(call.name);
		const summary = summarizeToolInput(call.name, call.input);

		yield {
			type: "tool_start",
			toolName: call.name,
			toolId: call.id,
			toolInput: call.input,
			toolSummary: summary,
			roundtrip,
		};

		const startTime = Date.now();
		let result: ToolResult;

		if (toolDef?.streamHandler) {
			try {
				const gen = toolDef.streamHandler(call.input);
				let next = await gen.next();
				while (!next.done) {
					yield next.value;
					next = await gen.next();
				}
				result = next.value;
			} catch (err) {
				result = {
					content: err instanceof Error ? err.message : String(err),
					is_error: true,
				};
			}
		} else {
			logger.info("Executing tool", { tool: call.name, id: call.id });
			try {
				result = await Promise.race([
					toolRegistry.execute(call.name, call.input),
					new Promise<never>((_, reject) =>
						setTimeout(
							() =>
								reject(
									new Error(
										`Tool "${call.name}" timed out after ${Math.round(timeoutMs / 60_000)} minutes`,
									),
								),
							timeoutMs,
						),
					),
				]);
			} catch (err) {
				result = {
					content: err instanceof Error ? err.message : String(err),
					is_error: true,
				};
			}
		}

		const durationMs = Date.now() - startTime;
		yield {
			type: "tool_end",
			toolName: call.name,
			toolId: call.id,
			toolResult: (result.content ?? "").slice(0, 500),
			toolIsError: result.is_error,
			durationMs,
		};

		return [
			{
				id: call.id,
				name: call.name,
				content: result.content ?? "",
				is_error: result.is_error,
				images: result.images,
				durationMs,
			},
		];
	}

	// Multiple tools: yield all tool_start events, execute in parallel,
	// yield tool_end as each completes via race-drain
	for (const call of calls) {
		const summary = summarizeToolInput(call.name, call.input);
		yield {
			type: "tool_start",
			toolName: call.name,
			toolId: call.id,
			toolInput: call.input,
			toolSummary: summary,
			roundtrip,
		};
	}

	// Launch all tools in parallel, each wrapped in a tagged promise.
	// Tools with a streamHandler (e.g. spawn_agent) use it so intermediate
	// chunks (sub-agent activity) are forwarded to the activity feed.
	type TaggedResult = { index: number; result: ToolCallResult };

	const chunkQueue: StreamChunk[] = [];
	let chunkResolve: (() => void) | null = null;

	function pushChunk(chunk: StreamChunk) {
		chunkQueue.push(chunk);
		if (chunkResolve) {
			chunkResolve();
			chunkResolve = null;
		}
	}

	let pending: Array<{ index: number; promise: Promise<TaggedResult> }> =
		calls.map((call, index) => ({
			index,
			promise: (async (): Promise<TaggedResult> => {
				const toolDef = toolRegistry.get(call.name);
				const startTime = Date.now();
				logger.info("Executing tool", { tool: call.name, id: call.id });
				let result: ToolResult;
				try {
					if (toolDef?.streamHandler) {
						const gen = toolDef.streamHandler(call.input);
						let next = await gen.next();
						while (!next.done) {
							pushChunk(next.value);
							next = await gen.next();
						}
						result = next.value;
					} else {
						result = await Promise.race([
							toolRegistry.execute(call.name, call.input),
							new Promise<never>((_, reject) =>
								setTimeout(
									() =>
										reject(
											new Error(
												`Tool "${call.name}" timed out after ${Math.round(timeoutMs / 60_000)} minutes`,
											),
										),
									timeoutMs,
								),
							),
						]);
					}
				} catch (err) {
					result = {
						content: err instanceof Error ? err.message : String(err),
						is_error: true,
					};
				}
				return {
					index,
					result: {
						id: call.id,
						name: call.name,
						content: result.content ?? "",
						is_error: result.is_error,
						images: result.images,
						durationMs: Date.now() - startTime,
					},
				};
			})(),
		}));

	// Drain: yield tool_end as each completes, flushing intermediate chunks
	// from streamHandlers between each resolution.
	const allResults: ToolCallResult[] = [];
	while (pending.length > 0) {
		while (chunkQueue.length > 0) {
			yield chunkQueue.shift()!;
		}

		const resolved = await Promise.race([
			...pending.map((p) => p.promise),
			// Also wake up when a streamHandler pushes a chunk, so we can
			// yield it without waiting for a tool to fully complete.
			new Promise<null>((resolve) => {
				chunkResolve = () => resolve(null);
			}),
		]);

		// If we woke up from a chunk push (not a tool completion), loop back
		// to flush the queue and race again.
		if (resolved === null) continue;

		// Flush any chunks pushed right before/during resolution
		while (chunkQueue.length > 0) {
			yield chunkQueue.shift()!;
		}

		const { index, result: callResult } = resolved;

		yield {
			type: "tool_end",
			toolName: callResult.name,
			toolId: callResult.id,
			toolResult: (callResult.content ?? "").slice(0, 500),
			toolIsError: callResult.is_error,
			durationMs: callResult.durationMs,
		};

		allResults.push(callResult);
		pending = pending.filter((p) => p.index !== index);
	}

	// Return in original call order
	allResults.sort((a, b) => {
		const aIdx = calls.findIndex((c) => c.id === a.id);
		const bIdx = calls.findIndex((c) => c.id === b.id);
		return aIdx - bIdx;
	});

	return allResults;
}
