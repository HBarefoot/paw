/**
 * Child entry for the `execute_code` tool. Runs in an isolated Bun process
 * spawned by src/tools/code-tools.ts with a SCRUBBED env (no PAW_*, no
 * credentials). It exposes a global `paw.call(tool, input)` that bridges to the
 * parent over IPC; the parent dispatches the call through the real tool registry
 * (with sandbox + permission checks) and sends the result back. The model's
 * snippet runs here, never in the kernel process, so it cannot read secrets.
 *
 * Protocol (IPC, structured-clone):
 *   child → parent : { type: "call", id, tool, input }
 *   parent → child : { type: "result", id, result: ToolResult }
 *   child → parent : { type: "done", ok, result?, error? }
 */

interface PendingCall {
	resolve: (value: unknown) => void;
	reject: (err: unknown) => void;
}

const pending = new Map<string, PendingCall>();
let nextId = 0;

const proc = process as unknown as {
	send?: (msg: unknown) => void;
	on: (event: string, cb: (msg: unknown) => void) => void;
	argv: string[];
	exit: (code?: number) => never;
};

function send(msg: unknown): void {
	proc.send?.(msg);
}

proc.on("message", (raw: unknown) => {
	const msg = raw as {
		type?: string;
		id?: string;
		result?: { content?: string; is_error?: boolean };
	};
	if (msg?.type !== "result" || !msg.id) return;
	const p = pending.get(msg.id);
	if (!p) return;
	pending.delete(msg.id);
	const res = msg.result ?? {};
	if (res.is_error) {
		p.reject(new Error(res.content ?? "tool error"));
	} else {
		// Resolve with the tool's text output — the useful value for a script.
		p.resolve(res.content ?? "");
	}
});

const paw = {
	call(tool: string, input: Record<string, unknown> = {}): Promise<unknown> {
		const id = `c${nextId++}`;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			send({ type: "call", id, tool, input });
		});
	},
};
(globalThis as { paw?: unknown }).paw = paw;

/** Best-effort structured-clone-safe conversion for the reported result. */
function serializable(value: unknown): unknown {
	try {
		return JSON.parse(JSON.stringify(value ?? null));
	} catch {
		return String(value);
	}
}

async function main(): Promise<void> {
	const scriptPath = proc.argv[2];
	if (!scriptPath) {
		send({ type: "done", ok: false, error: "no script path provided" });
		proc.exit(1);
	}
	const src = await Bun.file(scriptPath).text();
	try {
		// Wrap the snippet in an async IIFE so it can `await paw.call(...)` and
		// `return` a value. `paw` is also a global, so either style works.
		const fn = new Function("paw", `return (async () => {\n${src}\n})()`) as (
			p: typeof paw,
		) => Promise<unknown>;
		const result = await fn(paw);
		send({ type: "done", ok: true, result: serializable(result) });
		proc.exit(0);
	} catch (err) {
		send({
			type: "done",
			ok: false,
			error: err instanceof Error ? (err.stack ?? err.message) : String(err),
		});
		proc.exit(1);
	}
}

void main();

// Mark this file as a module so its top-level names stay local (it has no
// imports/exports of its own — it's a standalone process entry).
export {};
