/**
 * Shared inline-SVG icon set for the Barefoot Console pages — ported from the
 * design system (console/shell.jsx `P` map). Returns an SVG string for use via
 * Hono's `raw()` in server-rendered JSX. Stroke-based, inherits `currentColor`.
 *
 * Keep this the single source of page icons so the console stays visually
 * consistent; `layout.tsx` keeps its own nav-icon set for the rail.
 */
const PATHS: Record<string, string> = {
	dashboard:
		'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
	cron: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	heartbeat: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
	prompts:
		'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
	submissions:
		'<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
	bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
	chat: '<path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 9.5 9.5 0 0 1-4-.9L3 21l1.9-4.9A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 21 11.5z"/>',
	settings:
		'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.92.96V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6V4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.91.99l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 11h.6a2 2 0 0 1 0 4z"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	play: '<path d="M6 4l14 8-14 8z"/>',
	pause:
		'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
	trash:
		'<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
	edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
	copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
	refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
	upload:
		'<path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
	download:
		'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
	folder:
		'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	checkCircle:
		'<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
	x: '<path d="M18 6 6 18M6 6l12 12"/>',
	star: '<path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.1 21l1.1-6.5L2.5 9.8l6.5-.9z"/>',
	filter: '<path d="M4 5h16l-6 8v5l-4 2v-7z"/>',
	dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
	alert:
		'<path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
	info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
	zap: '<path d="M13 2 3 14h7l-1 8 10-12h-7z"/>',
	cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
	memory:
		'<path d="M12 3a4 4 0 0 0-4 4 3 3 0 0 0-1 5.8V17a3 3 0 0 0 6 0M12 3a4 4 0 0 1 4 4 3 3 0 0 1 1 5.8V17a3 3 0 0 1-6 0"/>',
	database:
		'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
	server:
		'<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
	globe:
		'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
	github:
		'<path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
	slack:
		'<rect x="9.5" y="2.5" width="5" height="5" rx="2.5"/><rect x="9.5" y="16.5" width="5" height="5" rx="2.5"/><rect x="2.5" y="9.5" width="5" height="5" rx="2.5"/><rect x="16.5" y="9.5" width="5" height="5" rx="2.5"/>',
	send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
	calendar:
		'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
	user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
	lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
	shield: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5z"/>',
	key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.2-8.2M16 6l2 2M19 3l2 2"/>',
	sparkles:
		'<path d="M12 3v6M9 6h6M6 13v4M4 15h4M16 12l1.5 3.5L21 17l-3.5 1.5L16 22l-1.5-3.5L11 17l3.5-1.5z"/>',
	terminal:
		'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
	layout:
		'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
	brand: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
	flow: '<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6h6a4 4 0 0 1 4 4v.5M7 18h6a4 4 0 0 0 4-4v-.5"/>',
	mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
	link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
};

export function icon(name: string, size = 16): string {
	const body = PATHS[name] ?? PATHS.dots;
	return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
