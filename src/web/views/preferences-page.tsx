import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout.js";

// The selectable companion avatars. KEYS MUST MATCH the registry in
// src/web/public/companion/shell.js (AVATARS); a test guards the sync.
export const AVATAR_OPTIONS: Array<{
	key: string;
	label: string;
	desc: string;
}> = [
	{ key: "gel", label: "Gel Sphere", desc: "The original glossy living orb." },
	{
		key: "robot-halo",
		label: "Robot · Halo",
		desc: "Antenna, block eyes, a friendly mouth.",
	},
	{
		key: "robot-visor",
		label: "Robot · Visor",
		desc: "Sleek single visor band.",
	},
	{
		key: "robot-cylon",
		label: "Robot · Cylon",
		desc: "A sweeping scanner slit.",
	},
	{ key: "robot-lcd", label: "Robot · LCD", desc: "Retro dot-screen face." },
];

export interface PreferencesPageProps {
	/** Brand/config default avatar key (per-user localStorage overrides it). */
	defaultAvatar?: string;
	currentPath?: string;
}

function preferencesScript(defaultAvatar: string): string {
	return `
    function pawSetAvatar(key) {
      try { localStorage.setItem("paw-avatar", key); } catch (e) {}
      document.querySelectorAll(".avatar-pick").forEach(function (b) {
        b.classList.toggle("active", b.dataset.avatar === key);
      });
    }
    (function () {
      var cur = null;
      try { cur = localStorage.getItem("paw-avatar"); } catch (e) {}
      cur = cur || ${JSON.stringify(defaultAvatar)};
      document.querySelectorAll(".avatar-pick").forEach(function (b) {
        b.classList.toggle("active", b.dataset.avatar === cur);
      });
    })();
  `;
}

/** Exposed for tests (cooked client script). */
export function getPreferencesScript(): string {
	return preferencesScript("gel");
}

export const PreferencesPage: FC<PreferencesPageProps> = ({
	defaultAvatar,
	currentPath,
}) => {
	return (
		<Layout title="AI Preferences" currentPath={currentPath ?? "/preferences"}>
			<div class="card mb-md">
				<h3>Companion avatar</h3>
				<p class="text-sm text-muted mb-md">
					Pick the face your companion wears. Your choice is saved on this
					device and applies live — an open companion swaps without a reload.
				</p>
				<div class="avatar-pick-grid">
					{AVATAR_OPTIONS.map((a) => (
						<button
							type="button"
							key={a.key}
							class="avatar-pick"
							data-avatar={a.key}
							onclick={`pawSetAvatar('${a.key}')`}
						>
							<strong>{a.label}</strong>
							<span class="text-xs text-muted">{a.desc}</span>
						</button>
					))}
				</div>
			</div>
			{raw(`<script>${preferencesScript(defaultAvatar ?? "gel")}</script>`)}
		</Layout>
	);
};
