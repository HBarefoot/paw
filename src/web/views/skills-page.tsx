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
      else pawModal.alert('Error', 'Failed to update skill.');
    }

    async function editDescription(name, current) {
      var input = await pawModal.prompt('Edit Description', 'Description for "' + name + '":', current);
      if (input === null) return;
      var res = await fetch('/api/skills/' + encodeURIComponent(name) + '/description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: input }),
      });
      if (res.ok) window.location.href = '/skills?success=1';
      else pawModal.alert('Error', 'Failed to update description.');
    }

    function toggleTools(name) {
      var el = document.getElementById('tools-' + name);
      if (el) el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
    }

    async function toggleTool(skillName, toolName, currentlyEnabled, checkbox) {
      var nowEnabled = !currentlyEnabled;
      var label = checkbox.closest('label');

      // Optimistically update the UI immediately
      if (label) {
        label.style.opacity = nowEnabled ? '' : '0.5';
        var code = label.querySelector('code');
        if (code) code.style.textDecoration = nowEnabled ? '' : 'line-through';
      }
      checkbox.setAttribute('onchange', "toggleTool('" + skillName + "', '" + toolName + "', " + nowEnabled + ", this)");

      // Update counters right away
      updateToolCounts(skillName);

      var res = await fetch(
        '/api/skills/' + encodeURIComponent(skillName) + '/tools/' + encodeURIComponent(toolName) + '/toggle',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nowEnabled }),
        }
      );
      if (!res.ok) {
        // Revert on failure
        checkbox.checked = currentlyEnabled;
        if (label) {
          label.style.opacity = currentlyEnabled ? '' : '0.5';
          var codeEl = label.querySelector('code');
          if (codeEl) codeEl.style.textDecoration = currentlyEnabled ? '' : 'line-through';
        }
        checkbox.setAttribute('onchange', "toggleTool('" + skillName + "', '" + toolName + "', " + currentlyEnabled + ", this)");
        updateToolCounts(skillName);
        pawModal.alert('Error', 'Failed to toggle tool.');
      }
    }

    function updateToolCounts(skillName) {
      // Update the tool count button for this skill
      var row = document.getElementById('tools-' + skillName);
      if (row) {
        var checkboxes = row.querySelectorAll('input[type="checkbox"]');
        var enabled = 0;
        var total = checkboxes.length;
        checkboxes.forEach(function(cb) { if (cb.checked) enabled++; });
        var skillRow = row.previousElementSibling;
        if (skillRow) {
          var btn = skillRow.querySelector('.btn-ghost.btn-sm');
          if (btn) btn.textContent = enabled < total ? (enabled + '/' + total + ' tools') : (total + ' tools');
        }
      }

      // Update the Total Tools stat card
      var allCheckboxes = document.querySelectorAll('tr[id^="tools-"] input[type="checkbox"]');
      var globalEnabled = 0;
      var globalTotal = allCheckboxes.length;
      allCheckboxes.forEach(function(cb) { if (cb.checked) globalEnabled++; });
      var statCards = document.querySelectorAll('.grid .card');
      var toolsCard = statCards[2];
      if (toolsCard) {
        var numEl = toolsCard.querySelector('div');
        var labelEl = toolsCard.querySelectorAll('div')[1];
        if (numEl && labelEl) {
          var globalDisabled = globalTotal - globalEnabled;
          numEl.textContent = globalDisabled > 0 ? (globalEnabled + '/' + globalTotal) : String(globalTotal);
          labelEl.textContent = globalDisabled > 0 ? 'Enabled / Total Tools' : 'Total Tools';
        }
      }
    }
  `;
}

export const SkillsPage: FC<SkillsPageProps> = ({
	skills,
	totalTools,
	success,
	error,
}) => {
	const alwaysActiveCount = skills.filter((s) => s.alwaysActive).length;
	const totalDisabled = skills.reduce(
		(sum, s) => sum + s.disabledTools.length,
		0,
	);
	const enabledTools = totalTools - totalDisabled;

	return (
		<Layout title="Skills" currentPath="/skills">
			{error && <div class="alert alert-error">{error}</div>}
			{success && <div class="alert alert-success">{success}</div>}

			<div
				class="grid"
				style="grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px"
			>
				<div class="card" style="text-align:center">
					<div style="font-size:28px;font-weight:700;color:var(--text-primary)">
						{skills.length}
					</div>
					<div style="font-size:13px;color:var(--text-muted)">Total Skills</div>
				</div>
				<div class="card" style="text-align:center">
					<div style="font-size:28px;font-weight:700;color:var(--text-primary)">
						{alwaysActiveCount}
					</div>
					<div style="font-size:13px;color:var(--text-muted)">
						Always Active
					</div>
				</div>
				<div class="card" style="text-align:center">
					<div style="font-size:28px;font-weight:700;color:var(--text)">
						{totalDisabled > 0 ? `${enabledTools}/${totalTools}` : totalTools}
					</div>
					<div style="font-size:13px;color:var(--text-muted)">
						{totalDisabled > 0 ? "Enabled / Total Tools" : "Total Tools"}
					</div>
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
									<td style="max-width:300px;font-size:13px">
										{skill.description}
									</td>
									<td>
										<button
											class="btn-ghost btn-sm"
											onclick={`toggleTools('${skill.name}')`}
										>
											{skill.disabledTools.length > 0
												? `${skill.toolNames.length - skill.disabledTools.length}/${skill.toolNames.length} tools`
												: `${skill.toolNames.length} tools`}
										</button>
									</td>
									<td>
										<span
											class={`badge ${skill.alwaysActive ? "success" : "neutral"}`}
										>
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
									<td
										colspan={5}
										style="padding:8px 16px;background:var(--bg-secondary)"
									>
										<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">
											Tools in this skill:
										</div>
										<div style="display:flex;flex-direction:column;gap:4px">
											{skill.toolNames.map((t) => {
												const isDisabled = skill.disabledTools.includes(t);
												const desc = skill.toolDescriptions[t] ?? "";
												const shortDesc =
													desc.length > 80 ? desc.slice(0, 80) + "..." : desc;
												return (
													<label
														style={`display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 8px;border-radius:4px;background:var(--surface);border:1px solid var(--border);cursor:pointer${isDisabled ? ";opacity:0.5" : ""}`}
													>
														<input
															type="checkbox"
															checked={!isDisabled}
															onchange={`toggleTool('${skill.name}', '${t}', ${!isDisabled}, this)`}
															style="margin:0;flex-shrink:0"
														/>
														<code
															style={`font-size:12px;flex-shrink:0${isDisabled ? ";text-decoration:line-through" : ""}`}
														>
															{t}
														</code>
														{shortDesc && (
															<span style="color:var(--text-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
																{shortDesc}
															</span>
														)}
													</label>
												);
											})}
										</div>
									</td>
								</tr>,
							])}
						</tbody>
					</table>
				) : (
					<div class="empty-state">
						<p>
							No skills available. Skills are auto-derived from registered
							plugins and MCP servers.
						</p>
					</div>
				)}
			</div>

			{raw(`<script>${skillsScript()}</script>`)}
		</Layout>
	);
};
