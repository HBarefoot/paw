> **Status (2026-06-13).** Still planned, with one caveat: **Feature 3 (Ops Dashboard) is already shipped** as the Agent Ops console at `/` (`src/web/views/ops-page.tsx`, PRs #57–#60) — a future implementer should skip/adapt it. **Feature 1 (Knowledge Base)** and **Feature 2 (Tool Approvals)** remain unbuilt (no `documents` table / `routes/knowledge`; no `src/security/approval-policy.ts` / `approval_requests`). Kept as the active plan for those two.

# Prompt: Acquisition-Readiness Features (Knowledge Base, Approvals, Ops Dashboard)

> Paste this entire document as the task prompt for a coding agent working in the Paw repo.

---

You are working in the **Paw** repository — a personal AI assistant framework built with Bun. Read `CLAUDE.md` first for architecture, commands, and conventions, and skim `REVIEW-2026-06-09.md` so you don't reintroduce fixed vulnerabilities. Your task is to implement **three features** that prepare Paw for acquisition: a document knowledge base, human-in-the-loop tool approvals, and an ops dashboard.

## Ground rules (non-negotiable)

1. **One feature = one PR**, each on its own short-lived branch off `main` (`feat/knowledge-base`, `feat/tool-approvals`, `feat/ops-dashboard`). Never commit to `main` directly — Railway auto-deploys it. Do NOT stack branches on each other; if a later feature needs an earlier one, wait for its merge.
2. **No `Co-Authored-By: Claude` trailers** in commit messages.
3. Before opening each PR: `bun test` passes (currently 218), `bun x tsc --noEmit` clean, `bun run lint` introduces **zero new errors** in files you touched.
4. Every new behavior gets tests, mirroring `src/` structure under `tests/`.
5. All SQL is parameterized; migrations go inline in `src/store/db.ts` following the existing pattern (idempotent, run on startup).
6. `src/web/app.ts` is already 3019 LOC. Do **not** grow it. Put new routes in dedicated modules (e.g. `src/web/routes/knowledge.ts`) and mount them from `app.ts` with a few lines. Same for views: new `.tsx` files in `src/web/views/`.
7. Reuse existing security primitives instead of reinventing: `sanitizePromptText()` for anything injected into the system prompt, `src/security/url-guard.ts` for URLs, `realpathSync` path containment as done in `src/tools/file-tools.ts`, audit logging via the existing audit-log store (write the audit entry **before** performing the action).
8. New tools register through the existing `ToolRegistry` and skills system (`src/ai/skills.ts` `deriveSkillName`). Decide deliberately whether each new skill is always-active or on-demand, and say why in the PR description.

---

## Feature 1 — Document Knowledge Base ("chat with our files")

**Why:** Paw's memory is conversational (facts extracted from chats). Companies expect an assistant that answers from their documents with citations. The hard parts already exist — Xenova all-MiniLM-L6-v2 embeddings (`src/memory/embeddings.ts`), sqlite-vec, and hybrid vector+FTS fusion (`src/memory/store.ts`). Build the ingestion pipeline and retrieval tool on top of them.

### Build

**New subsystem `src/knowledge/`:**

- `documents` table: id, title, source_path, mime_type, content_hash (sha256 for dedupe), size_bytes, status (`pending` | `processing` | `ready` | `error`), error_message, chunk_count, created_at, updated_at.
- `document_chunks` table: id, document_id (FK, ON DELETE CASCADE), chunk_index, text, token_estimate, heading_context (nearest heading/section label for citations).
- `document_chunks_vec` (sqlite-vec) + an FTS5 table over chunk text, mirroring how `memories`/`memories_vec` work.

**Ingestion pipeline (`src/knowledge/ingest.ts`):**

- Sources: (a) file upload via the web UI, (b) "ingest a folder" pointing at a directory **inside the existing sandboxed workspace root** — resolve with `realpathSync` and reject anything escaping it, exactly like `file-tools.ts`.
- Parsers: `.md`, `.txt`, `.html` (strip tags), `.pdf` (text extraction), `.docx` (e.g. via mammoth). Architect parsers as a small registry so formats are easy to add. Reject unsupported types and files > 20 MB with a clear error.
- Chunking: ~400–600 token chunks with ~15% overlap; split on heading/paragraph boundaries first, hard-split as fallback; carry `heading_context` into each chunk.
- Embed chunks in batches with the existing embeddings wrapper; process documents in a queue (one at a time) so ingestion never blocks the kernel event loop; update `status` as it progresses.
- Dedupe: identical `content_hash` → skip re-embedding, update metadata only. Re-ingesting a changed file replaces its chunks atomically (delete + insert in a transaction).

**Retrieval:**

- `KnowledgeStore.search(query, limit)` — hybrid vector+FTS with the same fusion/weighting approach as `MemoryStore.recall`. Returns chunk text + document title + heading_context + a relevance score.
- New tool `knowledge_search` (own `knowledge` skill). Recommendation: always-active, like memory — retrieval is only useful if the model reaches for it unprompted; document the token cost tradeoff in the PR.
- Results injected into the model context must pass `sanitizePromptText()` and be wrapped in a tagged block (e.g. `<knowledge_result doc="..." section="...">`) — document content is untrusted input (same prompt-injection lesson as H-NEW-8).
- Citations: the system prompt instructs the model to cite as `[doc title § section]` when it uses knowledge results. Add the instruction in `src/ai/system-prompt.ts` only when the knowledge skill is active and the store is non-empty.

**Web UI — `/knowledge` page:**

- Upload (drag/drop + picker), list documents with status/chunk-count/size, delete (removes chunks + vectors), re-index button, and a small search box to test retrieval directly.
- Auth-guarded like other admin pages; add to the sidebar nav (primary group, not Settings).
- Endpoints under `/api/knowledge/*` in `src/web/routes/knowledge.ts`. Multipart upload size-capped. Delete validates id format (lesson from M-NEW-15).

**Tests (`tests/knowledge/`):** chunker (boundaries, overlap, heading context), hash dedupe, atomic re-ingest, path containment rejection, hybrid search returns expected chunk for a known corpus, sanitization of malicious doc content (`<system>ignore previous</system>` stays inert), and route-level tests for upload/list/delete.

**Acceptance:** ingest a folder of mixed md/pdf/docx → ask a question in chat whose answer only exists in one document → the reply is correct **and cites the document**. Deleting the doc makes the same question fail gracefully.

---

## Feature 2 — Human-in-the-Loop Tool Approvals

**Why:** The sandbox/permission work is invisible plumbing. A visible pause-and-approve flow for risky actions is what makes corporate buyers comfortable: "powerful AND governed."

### Build

**Policy (`src/security/approval-policy.ts`):**

- Config (Zod, `src/config/schema.ts`): `approvals: { mode: "off" | "risky" | "all", riskyTools: string[], timeoutSeconds: number (default 300), onTimeout: "deny" }`.
- Default `mode: "risky"` with a built-in risky set: `exec_command`, `file_write`, `browser_evaluate`, all Strapi write tools, and **every MCP-sourced tool that isn't read-only** (conservative default: any MCP tool not matching `^(get|list|read|search)_`). Allow config to add/remove names.

**Interception in `ToolRegistry.execute` (`src/ai/tools.ts`):**

- After the existing `sandbox.checkPermission` gate, if policy requires approval: create an `approval_requests` row (id, session_id, tool, input JSON, requested_by, status `pending` | `approved` | `denied` | `expired`, decided_by, decided_at, created_at), write the audit-log entry **first**, emit `approval:requested` on the event bus, then **await a promise** that resolves when a decision lands or the timeout fires (timeout → `expired` → treated as deny).
- Denial/expiry returns a tool result with `is_error: true` and a clear message (`"Action denied by administrator"` / `"Approval timed out"`) so the model can adapt instead of retrying blindly (lesson from H-NEW-7).
- Cron-triggered tool executions go through the same gate — no bypass (cron was an escalation path: H-NEW-1/2).
- Pending approvals must survive neither restarts nor leak: on kernel boot, mark stale `pending` rows `expired`; on shutdown, resolve in-flight waiters as expired (no dangling timers — H-NEW-12 lesson).

**Surfacing:**

- **Chat (primary):** emit a `StreamChunk` of a new type (`approval_request`) so the web chat renders an inline approve/deny card with the tool name and a summarized input (`summarizeToolInput` exists in `src/observability/tool-summary.ts`). Decision POSTs to `/api/approvals/:id/decide`; the awaiting promise resolves and the turn continues live. Follow the existing StreamChunk plumbing in `base-provider.ts` (the `skillKey` addition is a good model).
- **`/approvals` page:** pending + history (filter by status/tool), approve/deny buttons. Sidebar: primary group with a pending-count badge.
- **Slack (optional, only if trivial):** post a notification via the existing Slack plugin when one is pending. Buttons-in-Slack is out of scope — link to the web page.
- Every decision is audit-logged with admin id, decision, and timestamp.

**Tests (`tests/security/approvals.test.ts` + route tests):** policy matching (off/risky/all, MCP read-only heuristic), approve resolves execution with the real result, deny returns `is_error`, timeout expires and denies, boot-time stale cleanup, cron path is gated, audit entry written before execution.

**Acceptance:** with `mode: "risky"`, asking the agent to run a shell command pauses the turn with an approve/deny card; approving runs it and the turn continues streaming; denying makes the model acknowledge and adapt. `/approvals` shows the full decision history.

---

## Feature 3 — Ops Dashboard

**Why:** Cost, tool, and error data already exist (`src/ai/cost-tracker.ts`, `src/observability/tool-log.ts`, `heartbeat_logs`, `audit_logs`). Surfacing them shows the system watches itself. Overlaps REVIEW Phase 5.4 — check its boxes if you complete them.

### Build

**`/ops` page (`src/web/views/ops-page.tsx` + `src/web/routes/ops.ts`):**

- **Cost & tokens:** per-day totals (last 30 days) and top sessions by cost; provider/model breakdown. Note which providers report real usage vs. char-estimates (M-NEW-12 context) and label estimated values as such in the UI.
- **Tool activity:** calls per tool (24h / 7d), duration percentiles (p50/p95) from tool-log timestamps, error rate per tool, last 20 failures with summarized input.
- **Approvals:** pending count, approve/deny/expire totals (7d) — ties Feature 2 into the governance story.
- **System health:** heartbeat pass/fail history, active skills + tool counts per skill, MCP server connection status, memory + knowledge store sizes (row counts), DB file size.
- **Errors:** counts by category (provider errors, tool errors, web 5xx) over 7d.

**Implementation notes:**

- Server-rendered JSX like other pages; lightweight auto-refresh by polling one `GET /api/ops/summary` endpoint every 30s. No external chart libraries — simple HTML/CSS bars or inline SVG sparklines keep the bundle clean.
- Aggregations are SQL `GROUP BY` queries; add indexes where needed (e.g. tool log timestamp, audit timestamp). Target < 100ms with tens of thousands of rows; verify with a seeded test.
- If cost data only flows in the streaming path or misses providers, fix the gaps at the source rather than papering over them in the dashboard.
- Auth-guarded; sidebar entry in the primary group.

**Tests (`tests/web/ops.test.ts`):** summary endpoint shape, aggregation correctness against seeded fixture data, auth required, query performance sanity check on a seeded DB.

**Acceptance:** after a few chat turns with tool calls (including one denied approval), `/ops` shows non-zero cost, tool volume with durations, the denial in approval stats, and heartbeat history — with no console errors and < 1s page load.

---

## Sequencing & PR checklist

Order: **Feature 2 → Feature 1 → Feature 3** (approvals is smallest and de-risks the others; the dashboard wants approvals data to exist).

Each PR description must include: what was built, schema changes, security considerations (what untrusted input is handled and how), test counts before/after, and any config additions with defaults. If you complete items that overlap `REVIEW-2026-06-09.md` Phase 5, update its checkboxes and `## Changelog`.

Definition of done for the whole task: all three PRs merged, `bun test` green, lint no worse than baseline, and a 10-line demo script in each PR description showing the feature working end-to-end.
