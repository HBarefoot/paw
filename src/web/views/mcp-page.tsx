import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";

interface MCPServerInfo {
  name: string;
  transport: string;
  connected: boolean;
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
  error?: string;
}

interface MCPPageProps {
  servers: MCPServerInfo[];
  error?: string;
  success?: string;
}

function mcpScript(): string {
  return `
    async function removeServer(name) {
      var ok = await pawModal.confirm("Remove Server", 'Remove MCP server "' + name + '"? This will disconnect it and remove it from config.', { confirmLabel: "Remove", danger: true });
      if (!ok) return;
      var res = await fetch('/api/mcp/servers/' + encodeURIComponent(name), { method: 'DELETE' });
      if (res.ok) window.location.reload();
      else pawModal.alert("Error", "Failed to remove server.");
    }

    async function reconnectServer(name) {
      var btn = event.target;
      btn.disabled = true;
      btn.textContent = 'Connecting...';
      var res = await fetch('/api/mcp/servers/' + encodeURIComponent(name) + '/reconnect', { method: 'POST' });
      if (res.ok) window.location.reload();
      else { pawModal.alert("Error", "Failed to reconnect server."); btn.disabled = false; btn.textContent = 'Reconnect'; }
    }

    function toggleAdvanced() {
      var el = document.getElementById('advanced-fields');
      el.style.display = el.style.display === 'none' ? 'flex' : 'none';
    }
  `;
}

export const MCPPage: FC<MCPPageProps> = ({ servers, error, success }) => {
  const totalTools = servers.reduce((sum, s) => sum + s.toolCount, 0);
  const connectedCount = servers.filter((s) => s.connected).length;

  return (
    <Layout title="MCP Servers" currentPath="/mcp">
      {error && <div class="alert alert-error">{error}</div>}
      {success && <div class="alert alert-success">{success}</div>}

      <div class="grid mb-md">
        <div class="card">
          <h3>Connected</h3>
          <div class="stat-value">{connectedCount}/{servers.length}</div>
        </div>
        <div class="card">
          <h3>Total Tools</h3>
          <div class="stat-value">{totalTools}</div>
        </div>
      </div>

      {servers.length > 0 && servers.map((server) => (
        <div class="card mb-md">
          <div class="flex justify-between items-center mb-md">
            <h3 class="card-title">{server.name}</h3>
            <div class="flex gap-sm items-center">
              <span class="badge neutral">{server.transport}</span>
              <span class={`badge ${server.connected ? "success" : "error"}`}>
                {server.connected ? "Connected" : "Disconnected"}
              </span>
              {!server.connected && (
                <button class="btn-ghost btn-sm" onclick={`reconnectServer('${server.name}')`}>
                  Reconnect
                </button>
              )}
              <button class="btn-danger btn-sm" onclick={`removeServer('${server.name}')`}>
                Remove
              </button>
            </div>
          </div>
          {server.error && (
            <p class="text-error mb-md">{server.error}</p>
          )}
          {server.tools.length > 0 ? (
            <table>
              <thead>
                <tr><th>Tool</th><th>Description</th></tr>
              </thead>
              <tbody>
                {server.tools.map((tool) => (
                  <tr>
                    <td><code>{tool.name}</code></td>
                    <td class="text-sm text-muted">{tool.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div class="empty-state">
              <p>{server.connected ? "No tools discovered" : "Connect to discover tools"}</p>
            </div>
          )}
        </div>
      ))}

      {servers.length === 0 && (
        <div class="card mb-md">
          <div class="empty-state">
            <p>No MCP servers configured. Add one below.</p>
          </div>
        </div>
      )}

      <div class="card">
        <h3>Add MCP Server</h3>
        <form method="POST" action="/api/mcp/servers" class="flex-col gap-md max-w-form">
          <div>
            <label>Server Name</label>
            <input type="text" name="name" required placeholder="e.g. filesystem, github, slack" class="w-full" />
          </div>
          <div>
            <label>Transport</label>
            <select name="transport" class="w-full">
              <option value="stdio">stdio (local command)</option>
              <option value="sse">SSE (remote URL)</option>
              <option value="http">HTTP (remote URL)</option>
            </select>
          </div>
          <div>
            <label>Command <span class="text-muted text-xs">(for stdio transport)</span></label>
            <input type="text" name="command" placeholder="e.g. npx, node, python" class="w-full" />
          </div>
          <div>
            <label>Arguments <span class="text-muted text-xs">(space-separated)</span></label>
            <input type="text" name="args" placeholder="e.g. -y @modelcontextprotocol/server-filesystem /home/user" class="w-full" />
          </div>
          <div>
            <label>URL <span class="text-muted text-xs">(for SSE/HTTP transport)</span></label>
            <input type="text" name="url" placeholder="e.g. http://localhost:8080/mcp" class="w-full" />
          </div>
          <div>
            <button type="button" class="btn-ghost btn-sm" onclick="toggleAdvanced()">
              Advanced options
            </button>
            <div id="advanced-fields" class="flex-col gap-md mt-sm" style="display: none">
              <div>
                <label>Environment Variables <span class="text-muted text-xs">(KEY=VALUE, one per line)</span></label>
                <textarea name="env" rows={3} placeholder="GITHUB_TOKEN=ghp_xxx&#10;API_KEY=sk-..." class="w-full" style="resize: vertical" />
              </div>
            </div>
          </div>
          <button type="submit" class="btn-primary self-start">Add Server</button>
        </form>
      </div>

      {raw(`<script>${mcpScript()}</script>`)}
    </Layout>
  );
};
