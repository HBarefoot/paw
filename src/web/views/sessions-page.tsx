import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";

interface SessionSummary {
  id: string;
  channel: string;
  user_id: string;
  title: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface SessionMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface SessionsListProps {
  sessions: SessionSummary[];
}

interface SessionDetailProps {
  session: { id: string; channel: string; user_id: string; created_at: string; updated_at: string };
  messages: SessionMessage[];
}

export const SessionsListPage: FC<SessionsListProps> = ({ sessions }) => {
  return (
    <Layout title="Conversation History" currentPath="/sessions">
      <div class="card">
        <h3>Recent Sessions ({sessions.length})</h3>
        {sessions.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Title</th>
                <th>Channel</th>
                <th>User</th>
                <th>Messages</th>
                <th>Created</th>
                <th>Last Activity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr id={`row-${s.id}`}>
                  <td>
                    <a href={`/sessions/${s.id}`} class="link">
                      {s.id.length > 24 ? `${s.id.slice(0, 24)}...` : s.id}
                    </a>
                  </td>
                  <td>{s.title ?? "\u2014"}</td>
                  <td><span class="badge neutral">{s.channel}</span></td>
                  <td>{s.user_id}</td>
                  <td>{s.message_count}</td>
                  <td>{s.created_at}</td>
                  <td>{s.updated_at}</td>
                  <td>
                    <a href={`/chat?session=${s.id}`} class="link" style="margin-right:8px" title="Resume">Resume</a>
                    {raw(`<button class="btn btn-sm" style="color:var(--danger)" onclick="deleteSession('${s.id}')">Delete</button>`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div class="empty-state"><p>No conversation history yet.</p></div>
        )}
      </div>
      {raw(`<script>
async function deleteSession(id) {
  var ok = await pawModal.confirm("Delete Session", "Delete this session and all its messages?", { confirmLabel: "Delete", danger: true });
  if (!ok) return;
  fetch("/api/sessions/" + id, { method: "DELETE" })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.deleted) {
        var row = document.getElementById("row-" + id);
        if (row) row.remove();
      }
    });
}
</script>`)}
    </Layout>
  );
};

export const SessionDetailPage: FC<SessionDetailProps> = ({ session, messages }) => {
  return (
    <Layout title={`Session ${session.id.slice(0, 12)}...`} currentPath="/sessions">
      <div class="flex items-center gap-md mb-md">
        <a href="/sessions" class="link">&larr; Back</a>
        <h2 class="mb-0" style="font-size: 18px; font-weight: 600">Session Detail</h2>
      </div>

      <div class="grid mb-md">
        <div class="card">
          <h3>Info</h3>
          <table>
            <tbody>
              <tr><td>ID</td><td class="text-sm" style="word-break: break-all">{session.id}</td></tr>
              <tr><td>Channel</td><td><span class="badge neutral">{session.channel}</span></td></tr>
              <tr><td>User</td><td>{session.user_id}</td></tr>
              <tr><td>Created</td><td>{session.created_at}</td></tr>
              <tr><td>Last Activity</td><td>{session.updated_at}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>Messages ({messages.length})</h3>
        <div class="flex-col gap-sm" style="padding: 8px 0">
          {messages.map((msg) => (
            <div class={`msg ${msg.role}`} style="max-width: 90%">
              <div class="role">{msg.role} &middot; {msg.created_at}</div>
              <div style="white-space: pre-wrap; word-break: break-word">{msg.content}</div>
            </div>
          ))}
          {messages.length === 0 && <div class="empty-state"><p>No messages in this session.</p></div>}
        </div>
      </div>
    </Layout>
  );
};
