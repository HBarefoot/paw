import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export interface StoredMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_use_id: string | null;
  created_at: string;
}

export function appendMessage(
  db: Database,
  sessionId: string,
  role: "user" | "assistant" | "tool",
  content: string,
  toolUseId?: string,
): StoredMessage {
  const id = randomUUID();
  db.run(
    "INSERT INTO messages (id, session_id, role, content, tool_use_id) VALUES (?, ?, ?, ?, ?)",
    [id, sessionId, role, content, toolUseId ?? null],
  );
  return db.query<StoredMessage, [string]>("SELECT * FROM messages WHERE id = ?").get(id)!;
}

export function getSessionMessages(db: Database, sessionId: string, limit = 50): StoredMessage[] {
  return db.query<StoredMessage, [string, number]>(
    "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?",
  ).all(sessionId, limit);
}

export function pruneOldMessages(db: Database, sessionId: string, keepLast: number): void {
  db.run(
    `DELETE FROM messages WHERE session_id = ? AND id NOT IN (
      SELECT id FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
    )`,
    [sessionId, sessionId, keepLast],
  );
}
