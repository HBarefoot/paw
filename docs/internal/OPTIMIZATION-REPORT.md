# Paw Framework Optimization Report

**Generated:** 2026-02-23  
**Scope:** Full codebase audit for performance, security, reliability, and maintainability  
**Issues Found:** 47 issues categorized by severity

---

## Executive Summary

The Paw codebase demonstrates solid architecture with good separation of concerns, thoughtful security measures (sandbox, permissions), and innovative features (skills system for token reduction). However, it has several critical issues around resource management and moderate gaps in error handling and test coverage that should be addressed.

**Risk Assessment:**
- 🔴 **Critical (5):** Memory leaks, race conditions, missing timeouts
- 🟠 **High (9):** Code duplication, error swallowing, type safety issues
- 🟡 **Medium (15):** N+1 patterns, input validation, cleanup issues
- 🟢 **Low (18):** Test gaps, organization, minor optimizations

---

## Critical Issues (Fix Immediately)

### 1. Memory Leak: Unbounded Session State Growth
**File:** `src/ai/skills.ts:15`  
**Issue:** `activeSkills` Map accumulates entries per session but is never cleaned up

```typescript
private activeSkills = new Map<string, Set<string>>();  // Never cleaned up
```

**Impact:** Unbounded memory growth in long-running processes

**Fix:**
```typescript
// Call clearSession when sessions end
this.skillManager.clearSession(msg.sessionId);
```

---

### 2. Missing Message History Pruning
**File:** `src/kernel/kernel.ts:429-436`  
**Issue:** Messages stored indefinitely but only limited on retrieval

**Impact:** Database grows unbounded; query performance degrades over time

**Fix:**
```typescript
// Add periodic pruning
if (session.messageCount > this.config.store.messageHistoryLimit * 2) {
  pruneOldMessages(this.db, msg.sessionId, this.config.store.messageHistoryLimit);
}
```

---

### 3. Race Condition: Database Singleton
**File:** `src/store/db.ts:26-42`  
**Issue:** Not thread-safe; concurrent calls could create multiple connections

```typescript
let db: Database | null = null;

export function getDb(dbPath: string): Database {
  if (db) return db;  // Race condition here
  db = new Database(dbPath);
  return db;
}
```

**Fix:** Use initialization flag or proper synchronization

---

### 4. Missing Tool Timeout in OpenAI/Gemini
**File:** `src/ai/openai-provider.ts:238-247`, `src/ai/gemini-provider.ts:215-226`  
**Issue:** Tools execute without timeout protection (unlike Claude provider with 5-min timeout)

**Impact:** Hanging operations can block forever

**Fix:** Add `Promise.race` with timeout wrapper

---

### 5. Unbounded Event Handler Accumulation
**File:** `src/kernel/kernel.ts:209`  
**Issue:** If `boot()` called multiple times, event handlers accumulate

**Fix:** Guard with `this.booted` flag

---

## High Priority Issues

### 6. Massive Code Duplication
**File:** `src/kernel/kernel.ts:351-482` vs `594-712`  
**Issue:** `handleInbound` and `prepareChat` share ~80% identical code

**Impact:** Maintenance burden, risk of divergence

**Fix:** Refactor to use `prepareChat` exclusively:
```typescript
private async handleInbound(msg: InboundMessage): Promise<void> {
  const prepared = await this.prepareChat(msg);
  if (!prepared) return;
  // Continue with provider call...
}
```

---

### 7. Error Swallowing: Empty Catch Blocks
**File:** `src/kernel/kernel.ts:284-286`  
**Issue:** Silently ignores file read errors

```typescript
} catch {
  /* no overrides */
}
```

**Fix:** At minimum log errors

---

### 8. Memory Leak: Interval Not Cleared on Error
**File:** `src/kernel/kernel.ts:326-336`  
**Issue:** If web server fails to start, interval still set but not accessible

---

### 9. Unsafe Type Assertions
**File:** `src/kernel/kernel.ts:311-312`  
**Issue:** `any` assertions bypass TypeScript safety

```typescript
this.webAppCleanup = (webApp as any).__cleanup ?? null;
```

---

### 10. Race Condition in Auto-Extract
**File:** `src/kernel/kernel.ts:547-549`  
**Issue:** Fire-and-forget pattern doesn't wait for completion

```typescript
this.autoExtractMemories(msg, replyText).catch((err) => {
  // Unbounded under high load
});
```

---

### 11-15. Additional High Issues
- **Unvalidated Plugin Config Access** (`kernel.ts:805`)
- **Unsafe Dynamic Import Error Handling** (`mcp/client-manager.ts:150`)
- **Potential Regex DoS in Sandbox** (`sandbox.ts:31`)
- **Unvalidated URL Construction** (`mcp/client-manager.ts:127`)
- **Missing Resource Cleanup in Streaming** (`ollama-provider.ts:322`)

---

## Medium Priority Issues

### 16. Inefficient FTS Query Building
**File:** `src/memory/store.ts:122-131`  
**Issue:** Multiple regex replacements on every recall

**Fix:** Pre-compile regex patterns

---

### 17-24. Additional Medium Issues
- **Tool Registry Race Condition** (`tools.ts:9`) - Non-atomic registration
- **Unsafe JSON Parsing** (`kernel.ts:809`) - Could throw on bad data
- **Missing Input Validation** (`file-tools.ts:174`) - Invalid regex patterns
- **Path Traversal** (`file-tools.ts:11`) - Symlink attacks
- **Unbounded Recursion** (`file-tools.ts:178`) - Symlink cycles
- **Command Injection Risk** (`exec-tools.ts:12`) - Incomplete blacklist
- **Insecure Temp Files** (`tests/kernel/store.test.ts:11`)
- **Missing MCP Timeouts** (`mcp/client-manager.ts:230`)

---

## Low Priority / Code Quality

### Test Coverage Gaps
The following **critical components have no tests**:
- `src/ai/provider.ts` - Core AI interaction
- `src/ai/ollama-provider.ts` - Streaming logic
- `src/ai/openai-provider.ts` - Tool roundtrip
- `src/ai/gemini-provider.ts` - Function calling
- `src/memory/store.ts` - Vector/FTS search
- `src/kernel/kernel.ts` - Integration/orchestration
- `src/mcp/client-manager.ts` - MCP server management
- `src/tools/exec-tools.ts` - Command execution security
- `src/security/access-control.ts` - Security critical
- `src/cron/scheduler.ts` - Background jobs

### Code Organization
- `src/kernel/kernel.ts`: 949 lines (consider splitting)
- `src/ai/ollama-provider.ts`: 535 lines (extract stream processing)
- `src/mcp/client-manager.ts`: 443 lines (separate concerns)
- Missing JSDoc on public APIs

### Magic Numbers
- `TOOL_TIMEOUT_MS = 300_000` - should be configurable
- `15 * 60 * 1000` - cleanup interval
- `limit: 3` - memory recall

---

## Recommended Action Plan

### Phase 1: Critical (Week 1)
1. ✅ Implement session cleanup in `SkillManager`
2. ✅ Add message pruning strategy  
3. ✅ Fix database singleton race condition
4. ✅ Add tool timeouts to OpenAI/Gemini providers
5. ✅ Guard against multiple event handler registration

### Phase 2: High Priority (Weeks 2-3)
1. Refactor `handleInbound`/`prepareChat` duplication
2. Add error logging to all empty catch blocks
3. Fix type assertions and add proper interfaces
4. Add concurrency limits to auto-extract
5. Fix regex DoS vulnerability in sandbox

### Phase 3: Medium Priority (Weeks 4-5)
1. Add comprehensive input validation with Zod
2. Implement resource cleanup (readers, intervals)
3. Fix race conditions in tool registration
4. Add timeouts to all external calls
5. Fix security issues in file/exec tools

### Phase 4: Quality & Testing (Ongoing)
1. Add tests for all untested critical components
2. Implement migration versioning system
3. Add observability/metrics hooks
4. Extract provider common logic to base class
5. Code organization improvements

---

## Positive Observations

✅ **Architecture:** Kernel-centric design with clear separation of concerns  
✅ **Security:** Sandbox permission system, path traversal protection  
✅ **Performance:** Skills system reduces token usage (~15k → ~1k tokens)  
✅ **Memory:** Hybrid vector + FTS search implementation  
✅ **Reliability:** Retry logic with exponential backoff  
✅ **Database:** WAL mode for SQLite performance  
✅ **Type Safety:** Strong TypeScript usage with strict mode

---

## Appendix: File Line References

| File | Lines | Issues |
|------|-------|--------|
| `src/ai/skills.ts` | 15, 106-110 | Memory leak |
| `src/kernel/kernel.ts` | 209, 284, 311, 326, 429, 547, 805 | Multiple issues |
| `src/store/db.ts` | 26-42 | Race condition |
| `src/ai/openai-provider.ts` | 238-247 | Missing timeout |
| `src/ai/gemini-provider.ts` | 215-226 | Missing timeout |
| `src/memory/store.ts` | 122-131, 141-142 | Inefficient queries |
| `src/tools/file-tools.ts` | 11, 174, 178 | Security issues |
| `src/tools/exec-tools.ts` | 12, 80-90 | Command injection |
| `src/mcp/client-manager.ts` | 127, 150, 230 | Error handling |
| `src/kernel/sandbox.ts` | 31-34 | Regex DoS |

---

*Report generated by automated code analysis*  
*For questions, see the detailed analysis in the task output*
