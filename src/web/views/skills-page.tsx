import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";
import type { SkillEntry } from "../../ai/skills.js";

interface SkillsPageProps {
  skills: SkillEntry[];
  totalTools: number;
  success?: string;
  error?: string;
}

function skillsScript(): string {
  return `
    async function toggleSkill(name, alwaysActive) {
      var res = await fetch('/api/skills/' + encodeURIComponent(name) + '/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alwaysActive: alwaysActive }),
      });
      if (res.ok) window.location.href = '/skills?success=1';
      else alert('Failed to update skill');
    }

    function editDescription(name, current) {
      var input = prompt('Edit description for "' + name + '":', current);
      if (input === null) return;
      fetch('/api/skills/' + encodeURIComponent(name) + '/description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: input }),
      }).then(function(res) {
        if (res.ok) window.location.href = '/skills?success=1';
        else alert('Failed to update description');
      });
    }

    function toggleTools(name) {
      var el = document.getElementById('tools-' + name);
      if (el) el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
    }
  `;
}

export const SkillsPage: FC<SkillsPageProps> = ({ skills, totalTools, success, error }) => {
  const alwaysActiveCount = skills.filter((s) => s.alwaysActive).length;

  return (
    <Layout title="Skills" currentPath="/skills">
      {error && <div class="alert alert-error">{error}</div>}
      {success && <div class="alert alert-success">{success}</div>}

      <div class="grid" style="grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px">
        <div class="card" style="text-align:center">
          <div style="font-size:28px;font-weight:700;color:var(--accent)">{skills.length}</div>
          <div style="font-size:13px;color:var(--text-muted)">Total Skills</div>
        </div>
        <div class="card" style="text-align:center">
          <div style="font-size:28px;font-weight:700;color:var(--success)">{alwaysActiveCount}</div>
          <div style="font-size:13px;color:var(--text-muted)">Always Active</div>
        </div>
        <div class="card" style="text-align:center">
          <div style="font-size:28px;font-weight:700;color:var(--text)">{totalTools}</div>
          <div style="font-size:13px;color:var(--text-muted)">Total Tools</div>
        </div>
      </div>

      <div class="card">
        <h3>Skills ({skills.length})</h3>
        {skills.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Tools</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => [
                <tr>
                  <td>
                    <strong>{skill.name}</strong>
                  </td>
                  <td style="max-width:300px;font-size:13px">{skill.description}</td>
                  <td>
                    <button class="btn-ghost btn-sm" onclick={`toggleTools('${skill.name}')`}>
                      {skill.toolNames.length} tools
                    </button>
                  </td>
                  <td>
                    <span class={`badge ${skill.alwaysActive ? "success" : "neutral"}`}>
                      {skill.alwaysActive ? "always on" : "on demand"}
                    </span>
                  </td>
                  <td>
                    <div class="flex gap-xs">
                      <button
                        class="btn-ghost btn-sm"
                        onclick={`toggleSkill('${skill.name}', ${!skill.alwaysActive})`}
                      >
                        {skill.alwaysActive ? "Set On-Demand" : "Set Always On"}
                      </button>
                      <button
                        class="btn-ghost btn-sm"
                        onclick={`editDescription('${skill.name}', ${JSON.stringify(skill.description)})`}
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>,
                <tr id={`tools-${skill.name}`} style="display:none">
                  <td colspan={5} style="padding:8px 16px;background:var(--bg-secondary)">
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Tools in this skill:</div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px">
                      {skill.toolNames.map((t) => (
                        <code style="font-size:12px;padding:2px 6px;border-radius:4px;background:var(--surface);border:1px solid var(--border)">{t}</code>
                      ))}
                    </div>
                  </td>
                </tr>,
              ])}
            </tbody>
          </table>
        ) : (
          <div class="empty-state"><p>No skills available. Skills are auto-derived from registered plugins and MCP servers.</p></div>
        )}
      </div>

      {raw(`<script>${skillsScript()}</script>`)}
    </Layout>
  );
};
