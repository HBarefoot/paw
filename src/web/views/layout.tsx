import type { FC } from "hono/jsx";
import { raw } from "hono/html";

interface LayoutProps {
	title: string;
	currentPath?: string;
	children: any;
}

function navIcon(name: string): string {
	const icons: Record<string, string> = {
		dashboard: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
		config: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
		cron: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
		memory: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
		sessions: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
		mcp: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66l4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66l4.24-4.24"/></svg>`,
		heartbeat: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
		skills: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
		chat: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
		canvas: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
		webhooks: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8H12"/></svg>`,
		search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
		audit: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
		tools: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
		prompts: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`,
		submissions: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
		brand: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
	};
	return icons[name] ?? "";
}

// Geometric paw mark — pure ellipses (toe beans) over a single pad.
// Inherits color via currentColor (see `.paw` in the design system).
export function pawMark(size = 17): string {
	return `<svg class="paw" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="6.4" cy="9.2" rx="2.05" ry="2.6"/><ellipse cx="10.2" cy="6.1" rx="2.15" ry="2.85"/><ellipse cx="13.9" cy="6.1" rx="2.15" ry="2.85"/><ellipse cx="17.7" cy="9.2" rx="2.05" ry="2.6"/><path d="M12 11.4c-3 0-5.6 2.2-5.6 4.9 0 2.1 1.8 3 3.4 3 1 0 1.5-.4 2.2-.4s1.2.4 2.2.4c1.6 0 3.4-.9 3.4-3 0-2.7-2.6-4.9-5.6-4.9Z"/></svg>`;
}

const cssDesignSystem = `
  /* ===== RESET ===== */
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  /* ===== DESIGN TOKENS — LIGHT (default) =====
     Paw "control-room" design system. Violet accent, Geist type.
     Token NAMES are preserved app-wide; only values change. */
  :root {
    --bg-primary: #ffffff;      /* bg-1 panel */
    --bg-secondary: #f7f7f9;    /* bg-0 canvas */
    --bg-tertiary: #f1f1f4;     /* bg-3 input/hover */
    --bg-card: #ffffff;         /* bg-2 card/raised */
    --bg-input: #ffffff;
    --bg-hover: #f1f1f4;
    --bg-active: #e8e8ec;       /* bg-4 pressed */
    --bg-sidebar: #f7f7f9;

    --border-primary: #e7e7ec;
    --border-secondary: #f0f0f3;
    --border-strong: #d4d4dc;
    --border-focus: rgba(106,75,240,0.28);
    /* alias: some pages reference --border directly */
    --border: var(--border-primary);

    --text-primary: #14151a;
    --text-secondary: #54565f;
    --text-tertiary: #82858e;
    --text-disabled: #b0b2ba;
    --text-inverse: #ffffff;
    /* alias: some pages reference --text-muted directly */
    --text-muted: var(--text-tertiary);

    /* Accent — violet */
    --accent: #6a4bf0;
    --accent-hover: #5b3bea;
    --accent-press: #4f2fdf;
    --accent-bright: #7c5cff;   /* links / code / data / focus */
    --accent-subtle: rgba(106,75,240,0.10);
    --accent-line: rgba(106,75,240,0.28);
    --accent-gradient: linear-gradient(150deg, #7c5cff, #6a4bf0 55%, #4f2fdf);
    /* foreground for text/icons sitting ON an accent fill — brand theme
       overrides this to dark on light accents (see renderBrandAppThemeCss) */
    --accent-fg: #ffffff;

    --success: #16a36a;
    --success-bg: rgba(22,163,106,0.12);
    --error: #e5484d;
    --error-bg: rgba(229,72,77,0.12);
    /* alias for ds "danger" semantic */
    --danger: var(--error);
    --danger-bg: var(--error-bg);
    --warning: #c98a06;
    --warning-bg: rgba(201,138,6,0.12);
    --info: #2f7ce0;
    --info-bg: rgba(47,124,224,0.12);

    --shadow-sm: 0 1px 2px rgba(20,21,26,.06);
    --shadow-md: 0 8px 24px -8px rgba(20,21,26,.12);
    --shadow-lg: 0 24px 60px -14px rgba(20,21,26,.18);
    --glow: 0 0 0 1px var(--accent-line), 0 12px 40px -10px rgba(106,75,240,.30);

    --radius-sm: 6px;
    --radius-md: 9px;
    --radius-lg: 13px;
    --radius-full: 9999px;

    --font-sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --font-mono: "Geist Mono", "SF Mono", "Fira Code", ui-monospace, monospace;

    --sidebar-width: 240px;
    --sidebar-collapsed: 64px;
    --transition: 150ms ease;
  }

  /* ===== DARK THEME — the control-room hero ===== */
  :root.dark {
      --bg-primary: #08090b;    /* bg-0 canvas */
      --bg-secondary: #0e0f13;  /* bg-1 panel */
      --bg-tertiary: #1c1e24;   /* bg-3 input/hover */
      --bg-card: #15161b;       /* bg-2 card/raised */
      --bg-input: #0e0f13;
      --bg-hover: #1c1e24;
      --bg-active: #25272e;     /* bg-4 pressed */
      --bg-sidebar: #08090b;

      --border-primary: #23252c;
      --border-secondary: #1a1c22;
      --border-strong: #313440;
      --border-focus: rgba(116,88,245,0.35);

      --text-primary: #f4f5f7;
      --text-secondary: #a6abb5;
      --text-tertiary: #6b7079;
      --text-disabled: #474b53;
      --text-inverse: #ffffff;

      --accent: #7458f5;
      --accent-hover: #876ef8;
      --accent-press: #6446e8;
      --accent-bright: #a78bfa;
      --accent-subtle: rgba(116,88,245,0.15);
      --accent-line: rgba(116,88,245,0.35);
      --accent-gradient: linear-gradient(150deg, #a78bfa, #7458f5 55%, #6446e8);
      --accent-fg: #ffffff;

      --success: #34d399;
      --success-bg: rgba(52,211,153,0.14);
      --error: #f87171;
      --error-bg: rgba(248,113,113,0.14);
      --warning: #fbbf24;
      --warning-bg: rgba(251,191,36,0.14);
      --info: #60a5fa;
      --info-bg: rgba(96,165,250,0.14);

      --shadow-sm: 0 1px 2px rgba(0,0,0,.45);
      --shadow-md: 0 8px 24px -6px rgba(0,0,0,.6);
      --shadow-lg: 0 24px 60px -12px rgba(0,0,0,.7);
      --glow: 0 0 0 1px var(--accent-line), 0 10px 40px -8px rgba(116,88,245,.45);
  }

  /* Smooth theme transitions */
  body, .sidebar, .main-area, .topbar, .card, .msg, .chat-container,
  .chat-input, .chat-messages, .nav-item, table, input, textarea, select, button {
    transition: background-color 300ms ease, color 300ms ease, border-color 300ms ease;
  }

  /* Theme toggle */
  .theme-toggle { padding: 0 12px; display: flex; gap: 4px; margin-bottom: 8px; }
  .theme-btn {
    height: auto; padding: 6px; border-radius: var(--radius-sm); background: transparent;
    color: var(--text-tertiary); border: none; cursor: pointer; box-shadow: none;
  }
  .theme-btn:hover { color: var(--text-primary); background: var(--bg-hover); transform: none; box-shadow: none; }
  .theme-btn.active { background: var(--accent-subtle); color: var(--accent-bright); }

  /* ===== BASE ===== */
  body {
    font-family: var(--font-sans);
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.5;
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    font-feature-settings: "cv01","cv03","ss01";
  }
  ::selection { background: var(--accent-subtle); color: var(--text-primary); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 99px; border: 2px solid var(--bg-primary); }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-disabled); }

  /* Mono helper + uppercase data labels (ds.css typography) */
  .mono { font-family: var(--font-mono); }
  .eyebrow, .label-xs {
    font-family: var(--font-mono); font-size: 11px; font-weight: 500;
    letter-spacing: .14em; text-transform: uppercase; color: var(--text-tertiary);
  }

  /* ===== PAW MARK + WORDMARK (ds.css §5) ===== */
  .paw { display: block; }
  .paw path, .paw ellipse { fill: currentColor; }
  .app-icon {
    display: grid; place-items: center; border-radius: 28%;
    background: linear-gradient(150deg, var(--accent-bright), var(--accent) 55%, var(--accent-press));
    color: var(--accent-fg); box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255,255,255,.25);
    position: relative; overflow: hidden; flex-shrink: 0;
  }
  .app-icon::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(120% 80% at 30% 10%, rgba(255,255,255,.35), transparent 50%);
  }
  .wordmark { display: inline-flex; align-items: center; gap: 10px; }
  .wordmark .name { font-weight: 600; font-size: 17px; letter-spacing: -.02em; color: var(--text-primary); }
  .wordmark .ver {
    font-family: var(--font-mono); font-size: 10px; font-weight: 500;
    padding: 2px 6px; border-radius: var(--radius-full);
    color: var(--accent-bright); background: var(--accent-subtle);
    border: 1px solid var(--accent-line); letter-spacing: .04em;
  }

  /* ===== APP LAYOUT ===== */
  .app-layout {
    display: flex;
    min-height: 100vh;
  }

  /* ===== SIDEBAR ===== */
  .sidebar {
    width: var(--sidebar-width);
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border-primary);
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 100;
    transition: width var(--transition);
  }

  .sidebar-header {
    padding: 20px 20px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  /* Header shows the logo only — no name/version text next to it. */
  .sidebar-header .wordmark .name,
  .sidebar-header .wordmark .ver { display: none; }

  /* ===== Manual sidebar collapse (icon-only rail) =====
     Mirrors the <768px responsive rules, keyed on an <html> class toggled
     by __pawToggleSidebar (pre-applied before paint to avoid a flash). */
  html.sidebar-collapsed .sidebar { width: var(--sidebar-collapsed); }
  html.sidebar-collapsed .main-area { margin-left: var(--sidebar-collapsed); }
  html.sidebar-collapsed .nav-label,
  html.sidebar-collapsed .nav-group-chevron,
  html.sidebar-collapsed .sidebar-footer span { display: none; }
  html.sidebar-collapsed .nav-item { justify-content: center; padding: 12px; }
  html.sidebar-collapsed .nav-item.nav-sub { padding-left: 12px; justify-content: center; }
  html.sidebar-collapsed .nav-group-header { justify-content: center; }
  html.sidebar-collapsed .sidebar-header { justify-content: center; padding: 16px 8px; }
  html.sidebar-collapsed .sidebar-footer { text-align: center; padding: 12px 8px; }
  html.sidebar-collapsed .theme-toggle { flex-direction: column; }

  /* Collapse toggle button (sidebar footer) */
  .sidebar-collapse-btn {
    width: 100%; background: transparent; border: 1px solid var(--border-primary);
    color: var(--text-secondary); justify-content: flex-start; gap: 10px;
    padding: 8px 12px; margin-bottom: 8px; font-size: 12px; border-radius: var(--radius-md);
  }
  .sidebar-collapse-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .sidebar-collapse-btn .nav-icon { display: inline-flex; transition: transform var(--transition); }
  html.sidebar-collapsed .sidebar-collapse-btn { justify-content: center; }
  html.sidebar-collapsed .sidebar-collapse-btn .nav-icon { transform: rotate(180deg); }

  .logo-icon {
    width: 32px;
    height: 32px;
    background: var(--accent-gradient);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-fg);
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;
  }

  .logo-text {
    font-weight: 700;
    font-size: 17px;
    color: var(--text-primary);
  }

  .sidebar-nav {
    flex: 1;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 12px;
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 13.5px;
    border-radius: var(--radius-md);
    position: relative;
    transition: all var(--transition);
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: var(--accent-subtle);
    color: var(--text-primary);
    font-weight: 500;
  }
  .nav-item.active .nav-icon { color: var(--accent-bright); }
  .nav-item.active::before {
    content: "";
    position: absolute; left: -1px; top: 50%; transform: translateY(-50%);
    width: 3px; height: 16px; border-radius: 99px; background: var(--accent-bright);
  }

  /* ===== COLLAPSIBLE NAV GROUP (Settings) ===== */
  .nav-group { display: flex; flex-direction: column; }
  .nav-group-header {
    display: flex; align-items: center; gap: 11px;
    padding: 9px 12px; width: 100%;
    background: transparent; border: none; box-shadow: none;
    color: var(--text-secondary); font-size: 13.5px; font-weight: 450;
    border-radius: var(--radius-md); cursor: pointer; position: relative;
    transition: all var(--transition); font-family: var(--font-sans);
    text-align: left;
  }
  .nav-group-header:hover { background: var(--bg-hover); color: var(--text-primary); transform: none; }
  .nav-group.child-active > .nav-group-header { color: var(--text-primary); }
  .nav-group.child-active > .nav-group-header .nav-icon { color: var(--accent-bright); }
  .nav-group-chevron {
    margin-left: auto; display: inline-flex; color: var(--text-tertiary);
    transition: transform .15s var(--ease);
  }
  .nav-group.open > .nav-group-header .nav-group-chevron { transform: rotate(90deg); }
  .nav-group-body { display: none; flex-direction: column; gap: 2px; margin: 2px 0 2px 0; }
  .nav-group.open > .nav-group-body { display: flex; }
  .nav-item.nav-sub { padding-left: 24px; font-size: 13px; }
  .nav-item.nav-sub .nav-icon { width: 17px; height: 17px; }

  .nav-icon {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .nav-label {
    white-space: nowrap;
    overflow: hidden;
  }

  .sidebar-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--border-secondary);
    font-size: 12px;
    color: var(--text-tertiary);
  }

  /* ===== MAIN AREA ===== */
  .main-area {
    margin-left: var(--sidebar-width);
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .topbar {
    padding: 16px 32px;
    border-bottom: 1px solid var(--border-primary);
    background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .page-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }

  .content {
    padding: 28px 32px;
    max-width: 1200px;
    flex: 1;
  }
  /* Chat page needs full width for canvas split */
  .content.content-full { max-width: none; }

  /* ===== CARDS ===== */
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    padding: 20px;
    margin-bottom: 16px;
    transition: border-color var(--transition), box-shadow var(--transition);
  }

  .card:hover {
    border-color: var(--border-strong);
  }

  .card h3 {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 500;
    margin-bottom: 12px;
  }

  .card-title {
    text-transform: none !important;
    font-size: 16px !important;
    font-weight: 600 !important;
    color: var(--text-primary) !important;
    letter-spacing: 0 !important;
  }

  /* ===== STAT CARDS ===== */
  .stat-value {
    font-size: 30px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.1;
    letter-spacing: -0.03em;
    font-feature-settings: "tnum";
  }

  .stat-label {
    font-size: 13px;
    color: var(--text-tertiary);
    margin-top: 4px;
  }

  /* ===== METRIC TILE + SPARKLINE (ds.css §9, §13) ===== */
  .metric { display: flex; flex-direction: column; gap: 10px; }
  .metric .m-label {
    font-family: var(--font-mono); font-size: 11px; letter-spacing: .1em;
    text-transform: uppercase; color: var(--text-tertiary);
  }
  .metric .m-value {
    font-size: 34px; font-weight: 600; letter-spacing: -.03em; line-height: 1;
    color: var(--text-primary); font-feature-settings: "tnum";
  }
  .metric .m-sub {
    font-size: 12px; color: var(--text-tertiary); display: flex;
    align-items: center; gap: 6px; flex-wrap: wrap;
  }
  .metric .m-sub > span { white-space: nowrap; }
  .m-delta-up { color: var(--success); }
  .m-delta-down { color: var(--danger); }

  .spark { display: flex; align-items: flex-end; gap: 3px; height: 40px; }
  .spark span { flex: 1; background: var(--accent-line); border-radius: 2px 2px 0 0; transition: background .2s; }
  .spark span.hi { background: var(--accent-bright); }

  /* ===== LIVE DOT (ds.css §8) ===== */
  .live-dot { position: relative; width: 7px; height: 7px; border-radius: 50%; background: var(--success); flex: none; }
  .live-dot::after {
    content: ""; position: absolute; inset: -3px; border-radius: 50%;
    border: 1px solid var(--success); animation: ping 1.8s cubic-bezier(.16,1,.3,1) infinite;
  }
  @keyframes ping { 0% { transform: scale(.6); opacity: 1; } 100% { transform: scale(1.8); opacity: 0; } }

  /* ===== BADGES (ds.css §8) ===== */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border-radius: var(--radius-full);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    line-height: 1;
    white-space: nowrap;
  }
  .badge .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

  /* Both .badge.success and .badge-success spellings supported */
  .badge.success, .badge-success { background: var(--success-bg); color: var(--success); }
  .badge.error, .badge-error, .badge.danger, .badge-danger { background: var(--error-bg); color: var(--error); }
  .badge.warning, .badge-warning { background: var(--warning-bg); color: var(--warning); }
  .badge.info, .badge-info { background: var(--info-bg); color: var(--info); }
  .badge.accent, .badge-accent { background: var(--accent-subtle); color: var(--accent-bright); }
  .badge.neutral, .badge-neutral { background: var(--bg-tertiary); color: var(--text-secondary); }

  /* ===== TABLES ===== */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    text-align: left;
    padding: 10px 14px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-bottom: 1px solid var(--border-primary);
  }
  td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-secondary);
    color: var(--text-secondary);
  }
  td .mono, td.mono { font-family: var(--font-mono); font-size: 12px; color: var(--accent-bright); }
  tr:hover td { background: var(--bg-hover); }
  tr:last-child td { border-bottom: none; }

  /* ===== FORMS ===== */
  input, textarea, select {
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    color: var(--text-primary);
    padding: 9px 13px;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-family: var(--font-sans);
    transition: border-color var(--transition), box-shadow var(--transition), background var(--transition);
    outline: none;
  }
  input::placeholder, textarea::placeholder { color: var(--text-disabled); }
  input:focus, textarea:focus, select:focus {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-subtle);
    background: var(--bg-card);
  }
  input:disabled, select:disabled { opacity: 0.5; cursor: not-allowed; }
  /* Tint native control chrome (select popup highlight, checkboxes) violet */
  input, textarea, select { accent-color: var(--accent); }
  option { background: var(--bg-card); color: var(--text-primary); }
  option:checked { background: var(--accent-subtle); color: var(--text-primary); }
  label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; font-weight: 500; }

  .input-sm { width: 80px; }
  .input-md { width: 150px; }
  .input-lg { width: 300px; }

  /* ===== BUTTONS (ds.css §6) ===== */
  button, .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 500;
    letter-spacing: -0.01em;
    white-space: nowrap;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all .16s var(--transition);
    font-family: var(--font-sans);
    background: var(--accent);
    color: var(--accent-fg);
  }
  button:hover, .btn:hover { background: var(--accent-hover); }
  button:active, .btn:active { background: var(--accent-press); }
  button:disabled, .btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; }

  /* The prominent primary CTA gets the control-room lift + violet glow */
  .btn-primary { background: var(--accent); color: var(--accent-fg); box-shadow: 0 1px 0 rgba(255,255,255,.12) inset, var(--shadow-sm); }
  .btn-primary:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: var(--glow); }
  .btn-primary:active { background: var(--accent-press); transform: translateY(0); }

  .btn-secondary { background: var(--bg-tertiary); color: var(--text-primary); border-color: var(--border-primary); box-shadow: none; }
  .btn-secondary:hover { background: var(--bg-active); border-color: var(--border-strong); box-shadow: none; }

  .btn-danger { background: var(--error-bg); color: var(--error); border-color: transparent; box-shadow: none; }
  .btn-danger:hover { border-color: var(--error); background: var(--error-bg); transform: translateY(-1px); box-shadow: none; }

  .btn-ghost { background: transparent; color: var(--text-secondary); border-color: transparent; box-shadow: none; }
  .btn-ghost:hover { background: var(--bg-tertiary); color: var(--text-primary); box-shadow: none; transform: none; }

  .btn-sm { padding: 5px 10px; font-size: 12px; border-radius: var(--radius-sm); }
  .btn-icon { width: 34px; height: 34px; padding: 0; }
  .btn-icon.btn-sm { width: 28px; height: 28px; }

  /* ===== ALERTS ===== */
  .alert {
    padding: 14px 18px;
    border-radius: var(--radius-md);
    font-size: 14px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid;
  }
  .alert-success { background: var(--success-bg); border-color: var(--success); color: var(--success); }
  .alert-error { background: var(--error-bg); border-color: var(--error); color: var(--error); }

  /* ===== EMPTY STATES ===== */
  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-tertiary);
  }
  .empty-state .empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.3; }
  .empty-state p { font-size: 14px; max-width: 400px; margin: 0 auto; line-height: 1.5; }

  /* ===== CODE ===== */
  code {
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-family: var(--font-mono);
    color: var(--accent-bright);
  }

  /* ===== CHAT ===== */
  .chat-container {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 140px);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--bg-card);
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    scroll-behavior: smooth;
  }

  .msg-wrapper {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .msg-wrapper.user-msg { flex-direction: row-reverse; }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .avatar.user-avatar { background: var(--accent); color: var(--accent-fg); }
  .avatar.bot-avatar { background: var(--accent-subtle); overflow: hidden; }
  .avatar.bot-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .msg {
    max-width: 720px;
    min-width: 0;
    overflow-wrap: break-word;
    padding: 12px 16px;
    border-radius: var(--radius-lg);
    line-height: 1.5;
    font-size: 14px;
  }
  /* User bubble = solid violet accent; assistant = raised card */
  .msg.user {
    background: var(--accent);
    color: var(--accent-fg);
    border-bottom-right-radius: var(--radius-sm);
  }
  .msg.user .role { color: color-mix(in srgb, var(--accent-fg) 85%, transparent); opacity: 1; }
  .msg.assistant {
    background: var(--bg-card);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-bottom-left-radius: var(--radius-sm);
    overflow: hidden;
  }
  .msg.tool {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    font-family: var(--font-mono);
    font-size: 13px;
    border-bottom-left-radius: var(--radius-sm);
  }
  .msg .role {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 4px;
    opacity: 0.75;
  }

  /* Markdown rendering inside assistant messages */
  .msg.assistant .md-content h1,
  .msg.assistant .md-content h2,
  .msg.assistant .md-content h3 {
    margin-top: 16px; margin-bottom: 8px; font-weight: 600; line-height: 1.3;
  }
  .msg.assistant .md-content h1 { font-size: 1.25em; }
  .msg.assistant .md-content h2 { font-size: 1.15em; }
  .msg.assistant .md-content h3 { font-size: 1.05em; }
  .msg.assistant .md-content h1:first-child,
  .msg.assistant .md-content h2:first-child,
  .msg.assistant .md-content h3:first-child { margin-top: 0; }
  .msg.assistant .md-content p { margin: 8px 0; }
  .msg.assistant .md-content p:first-child { margin-top: 0; }
  .msg.assistant .md-content p:last-child { margin-bottom: 0; }
  .msg.assistant .md-content ul, .msg.assistant .md-content ol {
    margin: 8px 0; padding-left: 24px;
  }
  .msg.assistant .md-content li { margin: 4px 0; }
  .msg.assistant .md-content li > ul, .msg.assistant .md-content li > ol { margin: 2px 0; }
  .msg.assistant .md-content code {
    font-family: var(--font-mono); font-size: 0.9em;
    background: var(--bg-secondary); padding: 2px 6px; border-radius: 4px;
  }
  .msg.assistant .md-content pre {
    margin: 0; padding: 12px 14px;
    background: var(--bg-primary);
    overflow-x: auto;
  }
  .msg.assistant .md-content pre code {
    background: none; padding: 0; font-size: 13px; line-height: 1.5;
  }
  .msg.assistant .md-content .code-block {
    margin: 10px 0; border-radius: var(--radius-md);
    border: 1px solid var(--border-primary); overflow: hidden;
    background: var(--bg-primary);
  }
  .msg.assistant .md-content .code-block pre {
    border: none; border-radius: 0;
  }
  /* Collapse large code blocks: cap height + fade the cut-off bottom. */
  .msg.assistant .md-content .code-block.collapsed pre {
    max-height: 240px; overflow: hidden;
    -webkit-mask-image: linear-gradient(to bottom, #000 80%, transparent);
    mask-image: linear-gradient(to bottom, #000 80%, transparent);
  }
  .msg.assistant .md-content .code-expand {
    background: transparent; border: none; cursor: pointer;
    color: var(--accent-bright); font-size: 11px; padding: 2px 6px;
    margin-left: 8px; border-radius: 4px;
    font-family: var(--font-mono); transition: background 0.15s;
  }
  .msg.assistant .md-content .code-expand:hover { background: var(--accent-subtle); }
  .msg.assistant .md-content .code-streaming {
    margin-left: 8px; font-family: var(--font-mono); font-size: 11px;
    color: var(--accent-bright); opacity: .85;
  }
  /* In-progress code while streaming is capped shorter so it never dominates. */
  .msg.assistant .md-content .code-block.streaming pre { max-height: 200px; }
  .msg.assistant .md-content .code-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 10px; font-size: 11px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    color: var(--text-tertiary);
  }
  .msg.assistant .md-content .code-lang {
    font-family: var(--font-mono); text-transform: lowercase;
    letter-spacing: 0.02em;
  }
  .msg.assistant .md-content .code-copy {
    background: transparent; border: 1px solid transparent;
    color: var(--text-tertiary); cursor: pointer;
    font-size: 11px; padding: 2px 8px; border-radius: 4px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .msg.assistant .md-content .code-copy:hover {
    background: var(--bg-tertiary, var(--bg-primary));
    color: var(--text-primary);
    border-color: var(--border-primary);
  }
  .msg.assistant .md-content blockquote {
    margin: 8px 0; padding: 4px 12px;
    border-left: 3px solid var(--accent); color: var(--text-secondary);
  }
  .msg.assistant .md-content hr {
    margin: 12px 0; border: none; border-top: 1px solid var(--border-primary);
  }
  .msg.assistant .md-content table {
    margin: 8px 0; border-collapse: collapse; width: 100%;
  }
  .msg.assistant .md-content th, .msg.assistant .md-content td {
    padding: 6px 10px; border: 1px solid var(--border-primary); text-align: left; font-size: 13px;
  }
  .msg.assistant .md-content th { background: var(--bg-secondary); font-weight: 600; }
  .msg.assistant .md-content strong { font-weight: 600; }
  .msg.assistant .md-content a { color: var(--accent); text-decoration: underline; }

  .chat-welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-tertiary);
    gap: 10px;
    text-align: center;
    padding: 60px 20px;
    background: radial-gradient(70% 55% at 50% 35%, var(--accent-subtle), transparent 70%);
  }
  .chat-welcome .welcome-icon { margin-bottom: 6px; }
  .chat-welcome .welcome-title {
    font-size: 24px; font-weight: 600; letter-spacing: -.03em; color: var(--text-primary);
  }
  .chat-welcome p { font-size: 13px; max-width: 280px; }

  .chat-input {
    display: flex;
    gap: 10px;
    padding: 16px 24px;
    border-top: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    align-items: flex-end;
  }
  .chat-input textarea {
    flex: 1;
    border-radius: 20px;
    padding: 10px 18px;
    background: var(--bg-card);
    border: 1px solid var(--border-primary);
    resize: none;
    overflow-y: hidden;
    min-height: 38px;
    max-height: 200px;
    line-height: 1.5;
    font-family: var(--font-sans);
    font-size: 14px;
  }
  .chat-input textarea:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px var(--accent-subtle);
  }
  .chat-input .send-btn {
    border-radius: 50%;
    width: 38px;
    height: 38px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .chat-attachments {
    display: flex;
    gap: 8px;
    padding: 8px 24px 0;
    flex-wrap: wrap;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-secondary);
  }

  .attachment-thumb {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: 1px solid var(--border-primary);
  }
  .attachment-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .attachment-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(0,0,0,0.6);
    color: #fff;
    font-size: 14px;
    line-height: 1;
    padding: 0;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .attachment-remove:hover { background: rgba(0,0,0,0.8); }

  .attach-btn {
    border-radius: 50%;
    width: 38px;
    height: 38px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }
  .attach-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

  .typing-indicator {
    display: flex;
    gap: 4px;
    padding: 12px 16px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-lg);
    border-bottom-left-radius: var(--radius-sm);
    width: fit-content;
  }
  .typing-indicator span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-tertiary);
    animation: typing 1.4s infinite;
  }
  .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
  .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes typing {
    0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
    30% { opacity: 1; transform: scale(1); }
  }

  /* ===== ACTIVITY TIMELINE ===== */
  .activity-timeline {
    margin-top: 8px;
    padding-left: 20px;
    border-left: 2px solid var(--border-secondary);
    position: relative;
  }

  /* Shared left gutter: status dots sit centered on the rail (left edge);
     every text element (step labels, "STEP N" dividers) starts at the
     timeline content edge so they all align in one column. */
  .activity-step {
    position: relative;
    padding: 4px 0;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .activity-step::before {
    content: "";
    position: absolute;
    left: -23px;
    top: 9px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border-primary);
  }

  .activity-step.running::before {
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
  }
  .activity-step.running .activity-label { color: var(--accent); }

  .activity-step.done::before {
    background: var(--success, #16a34a);
  }

  .activity-step.error::before {
    background: var(--error);
  }

  .activity-step-header {
    display: flex;
    align-items: center;
    gap: 6px;
    line-height: 1.4;
  }

  .activity-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  .activity-label {
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .activity-duration {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    margin-left: auto;
  }

  .activity-details {
    margin-top: 2px;
  }
  .activity-details summary {
    font-size: 11px;
    color: var(--text-tertiary);
    cursor: pointer;
    user-select: none;
  }
  .activity-details summary:hover { color: var(--text-secondary); }

  .activity-result-preview {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.4;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    margin-top: 4px;
    max-height: 120px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-secondary);
  }

  /* Prompt library + picker */
  .prompt-pick-list { max-height: 50vh; overflow-y: auto; }
  .prompt-pick {
    padding: 10px 12px; border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm); margin: 6px 0;
    cursor: pointer; background: var(--bg-card);
    transition: border-color 0.15s, background 0.15s;
  }
  .prompt-pick:hover {
    border-color: var(--accent); background: var(--bg-hover);
  }
  details.prompt-row {
    padding: 10px 12px; border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm); background: var(--bg-card);
  }
  details.prompt-row + details.prompt-row { margin-top: 6px; }
  details.prompt-row > summary { cursor: pointer; list-style: none; }
  details.prompt-row > summary::-webkit-details-marker { display: none; }

  /* Memory citation footnote badges */
  .mem-cite {
    display: inline-block; vertical-align: baseline;
    font-size: 10px; line-height: 1;
    padding: 2px 5px; margin: 0 2px;
    border-radius: 3px;
    background: var(--accent-subtle);
    color: var(--accent);
    cursor: pointer; font-family: var(--font-mono);
    text-decoration: none;
    transition: background 0.15s, color 0.15s;
  }
  .mem-cite:hover, .mem-cite:focus {
    background: var(--accent); color: var(--accent-fg); outline: none;
  }

  /* Drag-and-drop overlay on the chat container */
  .chat-container { position: relative; }
  .chat-container.drag-active::after {
    content: "Drop files to attach";
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; font-weight: 500; color: var(--accent);
    background: var(--accent-subtle);
    border: 2px dashed var(--accent);
    border-radius: var(--radius-md);
    pointer-events: none; z-index: 10;
  }

  /* Audit log table */
  .audit-table-wrap { overflow-x: auto; }
  .audit-table {
    width: 100%; border-collapse: collapse; font-size: 13px;
  }
  .audit-table th, .audit-table td {
    padding: 8px 10px; text-align: left;
    border-bottom: 1px solid var(--border-secondary);
    vertical-align: top;
  }
  .audit-table th {
    background: var(--bg-secondary); color: var(--text-secondary);
    font-weight: 600; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .audit-details {
    font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);
    max-width: 540px; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Conversation search results */
  .search-hit {
    display: block; padding: 12px 14px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-primary);
    text-decoration: none;
    transition: border-color 0.15s, background 0.15s;
  }
  .search-hit + .search-hit { margin-top: 8px; }
  .search-hit:hover {
    border-color: var(--accent); background: var(--bg-hover);
  }
  .search-snippet {
    font-size: 13px; color: var(--text-secondary);
    line-height: 1.5; white-space: pre-wrap;
  }
  .search-snippet mark {
    background: var(--accent-subtle); color: var(--accent);
    padding: 0 2px; border-radius: 3px;
  }

  /* Feedback buttons */
  .feedback-bar {
    display: flex;
    gap: 4px;
    margin-top: 8px;
    opacity: 0;
    transition: opacity 0.2s;
  }
  .msg-wrapper:hover .feedback-bar,
  .feedback-bar:focus-within {
    opacity: 1;
  }
  .feedback-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    cursor: pointer;
    padding: 2px 8px;
    font-size: 14px;
    line-height: 1;
    transition: background 0.15s, border-color 0.15s;
  }
  .feedback-btn.action-btn {
    font-size: 11px;
    padding: 2px 8px;
    color: var(--text-tertiary);
  }
  .feedback-btn.action-btn:hover {
    color: var(--text-primary);
  }
  .feedback-btn:hover {
    background: var(--bg-secondary);
    border-color: var(--text-tertiary);
  }
  .feedback-thanks {
    font-size: 12px;
    color: var(--text-tertiary);
    padding: 2px 0;
  }

  /* Thinking text panel */
  .thinking-details {
    margin: 0;
    padding: 0;
  }
  .thinking-summary {
    cursor: pointer;
    font-size: 12px;
    font-style: italic;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    user-select: none;
  }
  .thinking-summary::-webkit-details-marker {
    display: none;
  }
  .thinking-text-content {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
    padding: 4px 10px 8px;
    white-space: pre-wrap;
    max-height: 200px;
    overflow-y: auto;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm, 6px);
    margin: 0 8px 8px;
    opacity: 0.85;
  }

  /* Stop button */
  .stop-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 10px;
    margin-left: 8px;
    transition: background 0.15s, color 0.15s;
  }
  .stop-btn:hover {
    background: var(--danger, #dc2626);
    color: white;
    border-color: var(--danger, #dc2626);
  }
  .stop-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Usage badge */
  .usage-badge {
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 4px 0 0;
    opacity: 0;
    transition: opacity 0.2s;
  }
  .msg-wrapper:hover .usage-badge {
    opacity: 1;
  }

  .activity-thinking {
    padding: 6px 10px;
    font-size: 12px;
    font-style: italic;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  @keyframes thinking-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .activity-roundtrip-divider {
    padding: 6px 0 4px 0;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
    border-top: 1px dashed var(--border-secondary);
    margin-top: 4px;
  }

  .activity-error-card {
    position: relative;
    padding: 8px 12px;
    margin: 4px 0;
    border-radius: var(--radius-sm);
    background: var(--error-bg);
    border: 1px solid var(--error);
    color: var(--error);
    font-size: 12px;
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .activity-error-card::before {
    content: "";
    position: absolute;
    left: -17px;
    top: 14px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--error);
  }

  .activity-spinner {
    display: inline-block; width: 12px; height: 12px;
    border: 2px solid var(--border-primary); border-top-color: var(--accent);
    border-radius: 50%; animation: activity-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes activity-spin { to { transform: rotate(360deg); } }

  /* ===== COLLAPSIBLE ACTIVITY TIMELINE ===== */
  .activity-timeline-header {
    display: none;
    align-items: center;
    gap: 0;
    padding: 6px 10px 6px 0;
    margin-top: 8px;
    margin-bottom: 2px;
    cursor: pointer;
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--text-secondary);
    user-select: none;
    transition: background var(--transition);
  }
  .activity-timeline-header:hover { background: var(--bg-hover); }
  .activity-timeline-header.visible { display: flex; }

  /* 22px gutter matches the timeline content edge so the summary counts line
     up with the step labels + "STEP N" dividers below; the chevron sits in
     the gutter column. */
  .activity-toggle-icon {
    width: 22px;
    display: inline-flex;
    justify-content: center;
    transition: transform 150ms ease;
    flex-shrink: 0;
  }
  .activity-toggle-icon.expanded { transform: rotate(90deg); }

  .activity-summary-counts {
    display: flex;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .activity-summary-done { color: var(--success); }
  .activity-summary-running { color: var(--accent); }
  .activity-summary-error { color: var(--error); }

  .activity-timeline.collapsed .activity-step.done,
  .activity-timeline.collapsed .activity-step.error,
  .activity-timeline.collapsed .activity-roundtrip-divider { display: none; }
  .activity-timeline.collapsed .activity-step.running { display: block; }

  /* ===== MEMORY CARDS ===== */
  .memory-card {
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    transition: border-color var(--transition);
  }
  .memory-card:hover { border-color: var(--border-focus); }

  /* ===== GRID & UTILITIES ===== */
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .dash-split { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; margin-top: 16px; }
  @media (max-width: 860px) { .dash-split { grid-template-columns: 1fr; } }
  .flex { display: flex; }
  .flex-col { display: flex; flex-direction: column; }
  .flex-wrap { flex-wrap: wrap; }
  .gap-xs { gap: 4px; }
  .gap-sm { gap: 8px; }
  .gap-md { gap: 16px; }
  .gap-lg { gap: 24px; }
  .items-center { align-items: center; }
  .items-end { align-items: flex-end; }
  .justify-between { justify-content: space-between; }
  .mt-sm { margin-top: 8px; }
  .mt-md { margin-top: 16px; }
  .mb-md { margin-bottom: 16px; }
  .mb-0 { margin-bottom: 0; }
  .text-muted { color: var(--text-tertiary); }
  .text-secondary { color: var(--text-secondary); }
  .text-sm { font-size: 13px; }
  .text-xs { font-size: 11px; }
  .text-error { color: var(--error); font-size: 13px; }
  .w-full { width: 100%; }
  .link { color: var(--accent); text-decoration: none; }
  .link:hover { text-decoration: underline; }
  .font-medium { font-weight: 500; }
  .font-bold { font-weight: 700; }
  .flex-1 { flex: 1; min-width: 0; }
  .self-start { align-self: flex-start; }
  .max-w-form { max-width: 500px; }

  /* ===== MODAL ===== */
  .paw-modal-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    animation: pawModalFadeIn 150ms ease;
  }
  @keyframes pawModalFadeIn { from { opacity: 0; } to { opacity: 1; } }
  .paw-modal {
    background: var(--bg-card); border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg); padding: 24px; min-width: 340px; max-width: 480px;
    box-shadow: var(--shadow-lg); animation: pawModalSlideIn 150ms ease;
  }
  @keyframes pawModalSlideIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
  .paw-modal-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); }
  .paw-modal-body { font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 20px; }
  .paw-modal-body input, .paw-modal-body textarea {
    width: 100%; margin-top: 8px;
  }
  .paw-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .paw-modal-actions .btn-cancel {
    background: transparent; color: var(--text-secondary); border: 1px solid var(--border-primary);
  }
  .paw-modal-actions .btn-cancel:hover { background: var(--bg-hover); color: var(--text-primary); }
  .paw-modal-actions .btn-confirm { background: var(--accent); color: var(--accent-fg); }
  .paw-modal-actions .btn-confirm:hover { background: var(--accent-hover); }
  .paw-modal-actions .btn-confirm.danger { background: var(--error); }
  .paw-modal-actions .btn-confirm.danger:hover { background: #dc2626; }

  /* ===== CHAT + CANVAS UNIFIED LAYOUT ===== */

  /* Outer wrapper — single card for both chat and canvas */
  .chat-with-canvas {
    display: flex;
    height: calc(100vh - 185px);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--bg-card);
    box-shadow: var(--shadow-sm);
  }
  /* When inside the unified wrapper, chat-container loses its own card styles */
  .chat-with-canvas .chat-container {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    border-radius: 0;
    box-shadow: none;
    margin-bottom: 0;
    padding: 0;
  }

  /* ===== CANVAS DIVIDER ===== */
  .canvas-divider {
    width: 4px; cursor: col-resize; background: var(--border-primary);
    flex-shrink: 0; transition: background 150ms;
  }
  .canvas-divider:hover, .canvas-divider.dragging { background: var(--accent); }

  /* ===== CANVAS PANEL ===== */
  .canvas-panel {
    display: none;
    flex-direction: column;
    width: var(--canvas-width, 50%);
    /* Keep in sync with MIN_CANVAS_PX in chat.tsx's divider drag handler. */
    min-width: 320px;
    border-left: none;
    background: var(--bg-card);
  }
  .canvas-panel.open { display: flex; }

  /* ===== CANVAS BODY (explorer | main) ===== */
  .canvas-body { flex: 1; display: flex; min-height: 0; }
  .canvas-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

  /* ===== WORKSPACE EXPLORER ===== */
  .canvas-explorer {
    width: 210px; flex: none; display: flex; flex-direction: column;
    border-right: 1px solid var(--border-primary); background: var(--bg-secondary);
    min-height: 0;
  }
  .canvas-explorer.collapsed { display: none; }
  .explorer-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 8px 8px 12px; border-bottom: 1px solid var(--border-secondary);
  }
  .explorer-title {
    font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--text-tertiary);
  }
  .explorer-actions { display: flex; gap: 2px; }
  .explorer-actions button {
    width: 24px; height: 24px; padding: 0; background: transparent; color: var(--text-tertiary);
    border: none; border-radius: var(--radius-sm); box-shadow: none;
  }
  .explorer-actions button:hover { background: var(--bg-hover); color: var(--text-primary); transform: none; }
  .explorer-search { padding: 8px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border-secondary); }
  .explorer-search input[type="search"], .explorer-search > input {
    width: 100%; height: 28px; padding: 0 9px; font-size: 12px; border-radius: var(--radius-sm);
  }
  .explorer-search-toggle {
    display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-tertiary);
    margin: 0; font-weight: 400; cursor: pointer;
  }
  .explorer-search-toggle input { width: auto; height: auto; margin: 0; }
  .explorer-tree { flex: 1; overflow-y: auto; padding: 4px 0 12px; min-height: 0; }
  .tree-row {
    display: flex; align-items: center; gap: 5px; padding: 3px 8px; cursor: pointer;
    font-size: 12.5px; color: var(--text-secondary); white-space: nowrap; user-select: none;
    border: 1px solid transparent;
  }
  .tree-row:hover { background: var(--bg-hover); color: var(--text-primary); }
  .tree-row.active { background: var(--accent-subtle); color: var(--text-primary); }
  .tree-row.drop-target { border-color: var(--accent-line); background: var(--accent-subtle); }
  .tree-twisty { width: 12px; display: inline-flex; justify-content: center; color: var(--text-tertiary); transition: transform .12s; flex: none; }
  .tree-twisty.open { transform: rotate(90deg); }
  .tree-twisty.leaf { visibility: hidden; }
  .tree-icon { width: 14px; height: 14px; flex: none; color: var(--text-tertiary); display: inline-flex; }
  .tree-row.tree-folder > .tree-icon { color: var(--accent-bright); }
  .tree-name { overflow: hidden; text-overflow: ellipsis; }
  .tree-empty { padding: 14px 12px; font-size: 12px; color: var(--text-tertiary); }
  .tree-search-hit .tree-snippet { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-tertiary); margin-left: 6px; }

  /* Explorer context menu */
  .ctx-menu {
    position: fixed; z-index: 9500; min-width: 160px; padding: 4px 0;
    background: var(--bg-card); border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm); box-shadow: var(--shadow-lg);
  }
  .ctx-menu-item {
    padding: 7px 14px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer;
    display: flex; align-items: center; gap: 8px;
  }
  .ctx-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .ctx-menu-item.danger:hover { color: var(--danger); }
  .ctx-menu-sep { height: 1px; background: var(--border-secondary); margin: 4px 0; }

  /* ===== CANVAS TABS ===== */
  .canvas-tabs {
    display: flex; gap: 0; overflow-x: auto; border-bottom: 1px solid var(--border-secondary);
    background: var(--bg-secondary); flex-shrink: 0;
  }
  .canvas-tab {
    padding: 6px 12px; font-size: 12px; font-family: var(--font-mono);
    border-right: 1px solid var(--border-secondary); cursor: pointer;
    white-space: nowrap; display: flex; align-items: center; gap: 6px;
    color: var(--text-secondary); background: transparent;
  }
  .canvas-tab:hover { background: var(--bg-hover); }
  .canvas-tab.active { background: var(--bg-card); color: var(--text-primary); font-weight: 500; }
  .canvas-tab .tab-close { opacity: 0.5; cursor: pointer; font-size: 14px; line-height: 1; }
  .canvas-tab .tab-close:hover { opacity: 1; color: var(--error); }
  .canvas-tab .tab-history { opacity: 0.4; cursor: pointer; display: inline-flex; align-items: center; margin-left: 2px; }
  .canvas-tab .tab-history:hover { opacity: 1; color: var(--accent); }
  .canvas-tab .save-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; flex-shrink: 0; }
  .canvas-tab .save-dot-green { background: #16a34a; animation: save-flash 0.5s ease-in-out; }
  .canvas-tab .save-dot-orange { background: #f59e0b; animation: save-flash 0.5s ease-in-out; }
  @keyframes save-flash { 0% { transform: scale(1.8); opacity: 0.5; } 100% { transform: scale(1); opacity: 1; } }
  .canvas-tab-add { color: var(--text-tertiary); font-size: 16px; font-weight: 500; padding: 4px 10px; font-family: var(--font-sans); }
  .canvas-tab-add:hover { color: var(--accent); background: var(--bg-hover); }
  .canvas-tab-content { flex: 1; position: relative; }
  .canvas-tab-content iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; }
  .canvas-tab-content iframe.hidden { display: none; }

  .canvas-file-item {
    display: inline-block; padding: 1px 6px; font-size: 11px; font-family: var(--font-mono);
    color: var(--text-tertiary); text-decoration: none; border-radius: 3px;
    cursor: pointer;
  }
  .canvas-file-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .canvas-file-item.active { background: var(--accent-subtle); color: var(--accent); }

  .canvas-toolbar {
    display: flex; align-items: center; gap: 8px; padding: 8px 16px;
    border-bottom: 1px solid var(--border-secondary); background: var(--bg-secondary); font-size: 13px;
  }
  .canvas-toolbar .current-file {
    flex: 1; font-family: var(--font-mono); color: var(--text-secondary); font-size: 12px;
  }
  .canvas-toolbar button {
    background: transparent; color: var(--text-tertiary); border: 1px solid var(--border-secondary);
    padding: 4px 8px; border-radius: var(--radius-sm); font-size: 12px;
  }
  .canvas-toolbar button:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--border-primary); }

  .canvas-iframe { flex: 1; border: none; background: #fff; }
  :root.dark .canvas-iframe { background: var(--bg-primary); }

  .canvas-status {
    display: flex; align-items: center; gap: 6px; font-size: 11px;
    color: var(--text-tertiary); padding: 6px 12px;
    border-top: 1px solid var(--border-secondary); background: var(--bg-secondary);
    overflow-x: auto; white-space: nowrap;
  }
  .canvas-status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
  .canvas-status .dot.connected { background: var(--success); }
  .canvas-status .dot.working { background: var(--warning); animation: pulse-dot 1s ease-in-out infinite; }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.4); }
  }

  .canvas-thinking {
    display: flex; align-items: center; gap: 8px; padding: 10px 14px;
    border-radius: var(--radius-md); background: var(--bg-tertiary);
    color: var(--text-secondary); font-size: 13px;
  }
  .canvas-thinking .spinner {
    width: 16px; height: 16px; border: 2px solid var(--border-primary);
    border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* File badge for attached spreadsheets */
  .file-badge {
    display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px;
    border-radius: var(--radius-sm); font-size: 12px; margin-top: 6px;
    background: var(--bg-secondary); border: 1px solid var(--border-primary);
    color: var(--text-secondary);
  }
  .msg.user .file-badge { background: var(--bg-secondary); border-color: var(--border-primary); color: var(--text-secondary); }

  /* Chat toolbar row */
  .chat-toolbar {
    display: flex; align-items: center; gap: 8px; margin-bottom: 0;
    padding: 0 0 12px;
  }
  .chat-toolbar select {
    flex: 1; min-width: 0; padding: 7px 12px; border-radius: var(--radius-sm);
    font-size: 13px; border: 1px solid var(--border-primary);
    background: var(--bg-input); color: var(--text-primary);
  }
  .chat-toolbar .session-search {
    width: 180px; padding: 7px 10px; border-radius: var(--radius-sm);
    font-size: 13px; border: 1px solid var(--border-primary);
    background: var(--bg-input); color: var(--text-primary);
  }
  .chat-toolbar .session-search::placeholder { color: var(--text-tertiary); }
  @media (max-width: 640px) {
    .chat-toolbar .session-search { width: 100%; }
  }
  .chat-toolbar-btn {
    padding: 7px 14px; border-radius: var(--radius-sm); font-size: 13px;
    cursor: pointer; white-space: nowrap; display: inline-flex;
    align-items: center; gap: 6px; border: 1px solid var(--border-primary);
    background: transparent; color: var(--text-secondary);
    transition: all var(--transition);
  }
  .chat-toolbar-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .chat-toolbar-btn.primary {
    background: var(--accent-gradient); color: var(--accent-fg);
    border-color: transparent;
  }
  .chat-toolbar-btn.primary:hover { opacity: 0.9; background: var(--accent-gradient); }
  .chat-toolbar-btn.active { background: var(--accent-subtle); color: var(--accent); border-color: var(--accent); }

  /* ===== RESPONSIVE ===== */
  @media (max-width: 768px) {
    .sidebar { width: var(--sidebar-collapsed); }
    .nav-label, .logo-text, .wordmark .name, .wordmark .ver, .nav-group-chevron { display: none; }
    .nav-item.nav-sub { padding-left: 12px; justify-content: center; }
    .nav-group-header { justify-content: center; }
    .nav-item { justify-content: center; padding: 12px; }
    .sidebar-header { justify-content: center; padding: 16px 8px; }
    .sidebar-footer { text-align: center; padding: 12px 8px; }
    .sidebar-footer span { display: none; }
    .main-area { margin-left: var(--sidebar-collapsed); }
    .content { padding: 20px 16px; }
    .topbar { padding: 16px; }
    .canvas-panel { min-width: 280px; width: 45%; }
    .chat-toolbar { flex-wrap: wrap; }
  }
`;

const modalScript = `
window.pawModal = {
  _overlay: null,
  _close: function() {
    if (this._overlay) { this._overlay.remove(); this._overlay = null; }
  },
  // HTML-escape a string so it can be safely embedded into an attribute
  // or used as text content. C-NEW-2: callers pass model-derived text
  // (memory text, webhook names, error JSON) and a prior version used
  // innerHTML concatenation, which is a stored-XSS primitive.
  _escape: function(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },
  _show: function(title, body, actions) {
    this._close();
    var overlay = document.createElement("div");
    overlay.className = "paw-modal-overlay";
    overlay.onclick = function(e) { if (e.target === overlay) pawModal._close(); };
    var modal = document.createElement("div");
    modal.className = "paw-modal";
    var titleEl = document.createElement("div");
    titleEl.className = "paw-modal-title";
    titleEl.textContent = title == null ? "" : String(title);
    modal.appendChild(titleEl);
    var bodyEl = document.createElement("div");
    bodyEl.className = "paw-modal-body";
    if (body instanceof Node) {
      bodyEl.appendChild(body);
    } else {
      bodyEl.textContent = body == null ? "" : String(body);
    }
    modal.appendChild(bodyEl);
    var actionsEl = document.createElement("div");
    actionsEl.className = "paw-modal-actions";
    if (Array.isArray(actions)) {
      for (var i = 0; i < actions.length; i++) {
        var a = actions[i];
        var btn = document.createElement("button");
        btn.className = a.cls || "btn-confirm";
        if (a.danger) btn.className += " danger";
        btn.textContent = a.label;
        if (typeof a.onclick === "function") {
          btn.onclick = a.onclick;
        }
        actionsEl.appendChild(btn);
      }
    } else if (actions instanceof Node) {
      actionsEl.appendChild(actions);
    } else {
      // Backwards-compat: callers may still pass an HTML string for
      // static, server-rendered actions. The modal code that ships
      // server-side uses DOM construction; the string path is only
      // hit by hand-rolled client code and is rendered into a
      // dedicated <div> with no interpolation of user data.
      actionsEl.innerHTML = actions == null ? "" : String(actions);
    }
    modal.appendChild(actionsEl);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this._overlay = overlay;
    var firstBtn = modal.querySelector(".btn-confirm");
    if (firstBtn) firstBtn.focus();
    return modal;
  },
  alert: function(title, message) {
    return new Promise(function(resolve) {
      var modal = pawModal._show(title, message, [
        { label: "OK", cls: "btn-confirm", onclick: function() { pawModal._close(); resolve(); } }
      ]);
    });
  },
  confirm: function(title, message, opts) {
    opts = opts || {};
    var confirmLabel = opts.confirmLabel || "Confirm";
    return new Promise(function(resolve) {
      pawModal._show(title, message, [
        { label: "Cancel", cls: "btn-cancel", onclick: function() { pawModal._close(); resolve(false); } },
        { label: confirmLabel, cls: "btn-confirm", danger: !!opts.danger, onclick: function() { pawModal._close(); resolve(true); } }
      ]);
    });
  },
  prompt: function(title, message, defaultVal) {
    return new Promise(function(resolve) {
      var input = document.createElement("input");
      input.type = "text";
      input.className = "paw-modal-input";
      input.value = defaultVal == null ? "" : String(defaultVal);
      var wrapper = document.createElement("div");
      var msgEl = document.createElement("div");
      msgEl.textContent = message == null ? "" : String(message);
      wrapper.appendChild(msgEl);
      wrapper.appendChild(input);
      pawModal._show(title, wrapper, [
        { label: "Cancel", cls: "btn-cancel", onclick: function() { pawModal._close(); resolve(null); } },
        { label: "Save", cls: "btn-confirm", onclick: function() { pawModal._close(); resolve(input.value); } }
      ]);
      input.focus();
      input.select();
      input.onkeydown = function(e) { if (e.key === "Enter") { pawModal._close(); resolve(input.value); } };
    });
  }
};

// Global keyboard shortcuts — Escape closes any open modal and triggers
// in-flight chat cancellation if a Stop button is visible.
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    if (window.pawModal && window.pawModal._overlay) {
      window.pawModal._close();
      e.preventDefault();
      return;
    }
    var stopBtn = document.querySelector(".stop-btn");
    if (stopBtn && !stopBtn.disabled) {
      stopBtn.click();
      e.preventDefault();
    }
  }
});
`;

// Primary, always-visible operational pages.
const navItems = [
	{ path: "/", label: "Dashboard", icon: "dashboard" },
	{ path: "/cron", label: "Cron", icon: "cron" },
	{ path: "/heartbeat", label: "Heartbeat", icon: "heartbeat" },
	{ path: "/search", label: "Search", icon: "search" },
	{ path: "/prompts", label: "Prompts", icon: "prompts" },
	{ path: "/submissions", label: "Submissions", icon: "submissions" },
	{ path: "/chat", label: "Chat", icon: "chat" },
];

// Secondary pages tucked under a collapsible "Settings" group.
const settingsItems = [
	{ path: "/config", label: "Config", icon: "config" },
	{ path: "/brand", label: "Brand", icon: "brand" },
	{ path: "/memory", label: "Memory", icon: "memory" },
	{ path: "/sessions", label: "Sessions", icon: "sessions" },
	{ path: "/audit", label: "Audit", icon: "audit" },
	{ path: "/tools", label: "Tools", icon: "tools" },
	{ path: "/mcp", label: "MCP", icon: "mcp" },
	{ path: "/skills", label: "Skills", icon: "skills" },
	{ path: "/webhooks", label: "Webhooks", icon: "webhooks" },
];

const settingsIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const chevronIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;

/**
 * Inline head script that white-labels the UI identity from the active brand
 * (name, logo, favicon, page title). Mirrors the theme switcher: applies a
 * localStorage-cached identity synchronously for the head-level bits (title +
 * favicon — no flash), wires the body bits on DOMContentLoaded, then refreshes
 * from the public `/api/brand/ui` endpoint and persists. Sets only
 * textContent/href (no innerHTML) so a brand name can't inject markup. Shared
 * by Layout + the standalone login/TOTP pages. Returns the script body (caller
 * wraps in <script>). No backticks — embedded inside a template literal.
 */
export function brandIdentityScript(): string {
	return [
		"(function(){",
		'var KEY="paw-brand";',
		'function read(){try{return JSON.parse(localStorage.getItem(KEY)||"null");}catch(e){return null;}}',
		'function setTitle(name){if(window.__brandTitleBase===undefined){window.__brandTitleBase=document.title.replace(/ - Paw$/,"");}document.title=window.__brandTitleBase+" - "+(name||"Paw");}',
		'function setFavicon(href){var l=document.getElementById("favicon");if(l)l.setAttribute("href",href||"/favicon.png");}',
		"function applyHead(b){setTitle(b&&b.name);setFavicon(b&&b.favicon);}",
		"function applyBody(b){",
		'var name=(b&&b.name)||"Paw";',
		"window.__brandLogo=(b&&b.logo)||null;",
		"window.__brandName=name;",
		'document.querySelectorAll("[data-brand-name]").forEach(function(el){el.textContent=name;});',
		'document.querySelectorAll("[data-brand-logo]").forEach(function(img){var mark=img.parentElement?img.parentElement.querySelector(".app-icon"):null;if(b&&b.logo){img.setAttribute("src",b.logo);img.style.display="";if(mark)mark.style.display="none";}else{img.style.display="none";if(mark)mark.style.display="";}});',
		'document.querySelectorAll("[data-brand-avatar]").forEach(function(img){img.setAttribute("src",(b&&b.logo)||"/paw-logo.jpg");});',
		"}",
		"function apply(b){applyHead(b);if(document.body)applyBody(b);}",
		"var cached=read();",
		"applyHead(cached);",
		'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",function(){applyBody(cached);});}else{applyBody(cached);}',
		'fetch("/api/brand/ui").then(function(r){return r.json();}).then(function(d){var b=(d&&d.name)?d:null;try{localStorage.setItem(KEY,JSON.stringify(b));}catch(e){}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",function(){apply(b);});}else{apply(b);}}).catch(function(){});',
		"})()",
	].join("");
}

export const Layout: FC<LayoutProps> = ({ title, currentPath, children }) => (
	<html lang="en">
		<head>
			<meta charset="UTF-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			{raw(
				`<link rel="icon" id="favicon" type="image/png" href="/favicon.png" />`,
			)}
			{raw(`<link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">`)}
			<title>{title} - Paw</title>
			{raw(
				`<script>(function(){var t=localStorage.getItem("paw-theme")||"system";var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark");if(localStorage.getItem("paw-sidebar-collapsed")==="1")document.documentElement.classList.add("sidebar-collapsed");window.__pawToggleSidebar=function(){var c=document.documentElement.classList.toggle("sidebar-collapsed");try{localStorage.setItem("paw-sidebar-collapsed",c?"1":"0");}catch(e){}};window.__pawSetTheme=function(t){localStorage.setItem("paw-theme",t);var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);document.querySelectorAll(".theme-btn").forEach(function(b){b.classList.toggle("active",b.dataset.theme===t);});};window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(){var t=localStorage.getItem("paw-theme")||"system";if(t==="system")__pawSetTheme("system");});})()</script>`,
			)}
			{raw(`<style>${cssDesignSystem}</style>`)}
			{/* Brand theme override — maps the active brand onto the design tokens.
			    Render-blocking + empty when no brand, so no flash and a true no-op. */}
			{raw(`<link rel="stylesheet" href="/api/brand/theme.css">`)}
			{raw(`<script>${brandIdentityScript()}</script>`)}
			{raw(`<script>${modalScript}</script>`)}
		</head>
		<body>
			<div class="app-layout">
				<aside class="sidebar">
					<div class="sidebar-header">
						<div class="wordmark">
							{raw(
								`<div class="app-icon" style="width:30px;height:30px;">${pawMark(17)}</div>`,
							)}
							{raw(
								`<img class="wordmark-logo" data-brand-logo alt="" style="display:none;height:26px;max-width:130px;object-fit:contain;border-radius:6px;">`,
							)}
							<span class="name" data-brand-name="">
								Paw
							</span>
							<span class="ver">v0.1.0</span>
						</div>
					</div>
					<nav class="sidebar-nav">
						{navItems.map((item) => (
							<a
								href={item.path}
								class={`nav-item${currentPath === item.path ? " active" : ""}`}
							>
								{raw(`<span class="nav-icon">${navIcon(item.icon)}</span>`)}
								<span class="nav-label">{item.label}</span>
							</a>
						))}
						{(() => {
							const settingsActive = settingsItems.some(
								(s) => s.path === currentPath,
							);
							return (
								<div
									class={`nav-group${settingsActive ? " open child-active" : ""}`}
									id="settings-group"
								>
									<button
										type="button"
										class="nav-group-header"
										onclick="__pawToggleSettings(this)"
										aria-expanded={settingsActive ? "true" : "false"}
									>
										{raw(`<span class="nav-icon">${settingsIcon}</span>`)}
										<span class="nav-label">Settings</span>
										{raw(
											`<span class="nav-group-chevron">${chevronIcon}</span>`,
										)}
									</button>
									<div class="nav-group-body">
										{settingsItems.map((item) => (
											<a
												href={item.path}
												class={`nav-item nav-sub${currentPath === item.path ? " active" : ""}`}
											>
												{raw(
													`<span class="nav-icon">${navIcon(item.icon)}</span>`,
												)}
												<span class="nav-label">{item.label}</span>
											</a>
										))}
									</div>
								</div>
							);
						})()}
					</nav>
					<div class="sidebar-footer">
						{raw(
							`<button type="button" class="sidebar-collapse-btn" onclick="__pawToggleSidebar()" title="Collapse sidebar"><span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></span><span class="nav-label">Collapse</span></button>`,
						)}
						{raw(`<div class="theme-toggle">
              <button class="theme-btn" data-theme="light" onclick="__pawSetTheme('light')" title="Light">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              </button>
              <button class="theme-btn" data-theme="system" onclick="__pawSetTheme('system')" title="System">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              </button>
              <button class="theme-btn" data-theme="dark" onclick="__pawSetTheme('dark')" title="Dark">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              </button>
            </div>`)}
						<span>
							<span data-brand-name="">Paw</span> v0.1.0
						</span>
						<a
							href="/logout"
							class="nav-item"
							style="margin-top: 8px; font-size: 12px; padding: 6px 12px;"
						>
							{raw(
								`<span class="nav-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>`,
							)}
							<span class="nav-label">Logout</span>
						</a>
					</div>
				</aside>
				<div class="main-area">
					<header class="topbar">
						<h1 class="page-title">{title}</h1>
					</header>
					<main class="content">{children}</main>
				</div>
			</div>
			{raw(
				`<script>(function(){var t=localStorage.getItem("paw-theme")||"system";document.querySelectorAll(".theme-btn").forEach(function(b){b.classList.toggle("active",b.dataset.theme===t);});})()</script>`,
			)}
			{raw(`<script>(function(){
				var g=document.getElementById("settings-group");
				if(!g)return;
				// Auto-open when a Settings page is active; otherwise restore saved state.
				if(!g.classList.contains("child-active")){
					try{ if(localStorage.getItem("paw-settings-open")==="1") g.classList.add("open"); }catch(e){}
				}
				window.__pawToggleSettings=function(btn){
					var open=g.classList.toggle("open");
					btn.setAttribute("aria-expanded",open?"true":"false");
					try{ localStorage.setItem("paw-settings-open",open?"1":"0"); }catch(e){}
				};
			})()</script>`)}
		</body>
	</html>
);
