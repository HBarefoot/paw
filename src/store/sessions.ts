import type { Database } from "bun:sqlite";

export interface Session {
  id: string;
  channel: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export function getOrCreateSession(db: Database, id: string, channel: string, userId: string): Session {
  const existing = db.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?").get(id);
  if (existing) {
    db.run("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?", [id]);
    return { ...existing, updated_at: new Date().toISOString() };
  }

  db.run("INSERT INTO sessions (id, channel, user_id) VALUES (?, ?, ?)", [id, channel, userId]);
  return db.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?").get(id)!;
}

export function getSession(db: Database, id: string): Session | null {
  return db.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?").get(id);
}

export interface SessionSummary {
  id: string;
  channel: string;
  user_id: string;
  title: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export function listRecentSessions(db: Database, limit = 50): SessionSummary[] {
  return db.query<SessionSummary, [number]>(
    `SELECT s.id, s.channel, s.user_id, s.title, s.created_at, s.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count
     FROM sessions s
     ORDER BY s.updated_at DESC
     LIMIT ?`,
  ).all(limit);
}

export interface SessionWithMessages {
  session: Session;
  messages: Array<{ id: string; role: string; content: string; created_at: string }>;
}

export function getSessionWithMessages(db: Database, sessionId: string): SessionWithMessages | null {
  const session = db.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?").get(sessionId);
  if (!session) return null;

  const messages = db.query<
    { id: string; role: string; content: string; created_at: string },
    [string]
  >("SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId);

  return { session, messages };
}

export function deleteSession(db: Database, id: string): boolean {
  db.run("DELETE FROM messages WHERE session_id = ?", [id]);
  const result = db.run("DELETE FROM sessions WHERE id = ?", [id]);
  return result.changes > 0;
}

export function updateSessionTitle(db: Database, id: string, title: string): boolean {
  const result = db.run(
    "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?",
    [title, id],
  );
  return result.changes > 0;
}
