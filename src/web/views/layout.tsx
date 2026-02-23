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
  };
  return icons[name] ?? "";
}

const cssDesignSystem = `
  /* ===== RESET ===== */
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  /* ===== DESIGN TOKENS (Light) ===== */
  :root {
    --bg-primary: #ffffff;
    --bg-secondary: #f8f9fb;
    --bg-tertiary: #f0f2f5;
    --bg-card: #ffffff;
    --bg-input: #ffffff;
    --bg-hover: #f4f6f8;
    --bg-sidebar: #fafbfc;

    --border-primary: #e2e8f0;
    --border-secondary: #eef0f3;
    --border-focus: #2594d0;

    --text-primary: #0f172a;
    --text-secondary: #64748b;
    --text-tertiary: #94a3b8;
    --text-inverse: #ffffff;

    /* Paw brand blue */
    --accent: #2594d0;
    --accent-hover: #1a7ab5;
    --accent-subtle: rgba(37,148,208,0.09);
    --accent-gradient: linear-gradient(135deg, #2594d0, #1a7ab5);

    --success: #22c55e;
    --success-bg: #f0fdf4;
    --error: #ef4444;
    --error-bg: #fef2f2;
    --warning: #f59e0b;
    --warning-bg: #fffbeb;
    --info: #2594d0;
    --info-bg: rgba(37,148,208,0.08);

    --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.04);
    --shadow-lg: 0 12px 24px rgba(0,0,0,0.09), 0 4px 8px rgba(0,0,0,0.04);

    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-full: 9999px;

    --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --font-mono: "JetBrains Mono", "SF Mono", "Fira Code", ui-monospace, monospace;

    --sidebar-width: 240px;
    --sidebar-collapsed: 64px;
    --transition: 150ms ease;
  }

  /* ===== DARK THEME ===== */
  :root.dark {
      --bg-primary: #09090b;
      --bg-secondary: #111113;
      --bg-tertiary: #18181b;
      --bg-card: #131316;
      --bg-input: #18181b;
      --bg-hover: #1e1e22;
      --bg-sidebar: #0c0c0e;

      --border-primary: #27272a;
      --border-secondary: #1e1e22;
      --border-focus: #60b8e8;

      --text-primary: #f4f4f5;
      --text-secondary: #a1a1aa;
      --text-tertiary: #71717a;
      --text-inverse: #09090b;

      --accent: #60b8e8;
      --accent-hover: #3aa3d8;
      --accent-subtle: rgba(96,184,232,0.12);
      --accent-gradient: linear-gradient(135deg, #60b8e8, #3aa3d8);

      --success-bg: rgba(34,197,94,0.1);
      --error-bg: rgba(239,68,68,0.1);
      --warning-bg: rgba(245,158,11,0.1);
      --info-bg: rgba(96,184,232,0.1);

      --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
      --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.4);
      --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.5);
  }

  /* Smooth theme transitions */
  body, .sidebar, .main-area, .topbar, .card, .msg, .chat-container,
  .chat-input, .chat-messages, .nav-item, table, input, textarea, select, button {
    transition: background-color 300ms ease, color 300ms ease, border-color 300ms ease;
  }

  /* Theme toggle */
  .theme-toggle { padding: 0 12px; display: flex; gap: 4px; margin-bottom: 8px; }
  .theme-btn {
    padding: 6px; border-radius: var(--radius-sm); background: transparent;
    color: var(--text-tertiary); border: none; cursor: pointer;
  }
  .theme-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
  .theme-btn.active { background: var(--accent-subtle); color: var(--accent); }

  /* ===== BASE ===== */
  body {
    font-family: var(--font-sans);
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.5;
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
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

  .logo-icon {
    width: 32px;
    height: 32px;
    background: var(--accent-gradient);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
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
    gap: 10px;
    padding: 9px 12px;
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 14px;
    border-radius: var(--radius-sm);
    border-left: 3px solid transparent;
    transition: all var(--transition);
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-left-color: var(--border-primary);
  }

  .nav-item.active {
    background: var(--accent-subtle);
    color: var(--accent);
    font-weight: 500;
    border-left-color: var(--accent);
  }

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
    padding: 20px 32px;
    border-bottom: 1px solid var(--border-secondary);
    background: var(--bg-primary);
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .page-title {
    font-size: 22px;
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
    box-shadow: var(--shadow-sm);
    transition: box-shadow var(--transition), transform var(--transition);
  }

  .card:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .card h3 {
    font-size: 11px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-weight: 600;
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
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
  }

  .stat-label {
    font-size: 13px;
    color: var(--text-tertiary);
    margin-top: 4px;
  }

  /* ===== BADGES ===== */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .badge.success { background: var(--success-bg); color: var(--success); }
  .badge.error { background: var(--error-bg); color: var(--error); }
  .badge.warning { background: var(--warning-bg); color: var(--warning); }
  .badge.info { background: var(--info-bg); color: var(--info); }
  .badge.neutral { background: var(--bg-tertiary); color: var(--text-secondary); }

  /* ===== TABLES ===== */
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th {
    text-align: left;
    padding: 10px 14px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border-primary);
  }
  td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-secondary);
    color: var(--text-secondary);
  }
  tr:hover td { background: var(--bg-hover); }
  tr:last-child td { border-bottom: none; }

  /* ===== FORMS ===== */
  input, textarea, select {
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    color: var(--text-primary);
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-family: var(--font-sans);
    transition: border-color var(--transition), box-shadow var(--transition);
    outline: none;
  }
  input:focus, textarea:focus, select:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px rgba(37,148,208,0.15);
  }
  :root.dark input:focus, :root.dark textarea:focus, :root.dark select:focus {
    box-shadow: 0 0 0 3px rgba(96,184,232,0.18);
  }
  input:disabled, select:disabled { opacity: 0.5; cursor: not-allowed; }
  label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; font-weight: 500; }

  .input-sm { width: 80px; }
  .input-md { width: 150px; }
  .input-lg { width: 300px; }

  /* ===== BUTTONS ===== */
  button, .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all var(--transition);
    font-family: var(--font-sans);
    background: var(--accent-gradient);
    color: #ffffff;
  }
  button:hover, .btn:hover { opacity: 0.92; }
  button:active, .btn:active { transform: scale(0.97); }
  button:disabled, .btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .btn-primary { background: var(--accent-gradient); color: #ffffff; }
  .btn-primary:hover { opacity: 0.9; }

  .btn-danger { background: var(--error-bg); color: var(--error); border: 1px solid transparent; }
  .btn-danger:hover { border-color: var(--error); background: var(--error-bg); opacity: 1; }

  .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--border-primary); }
  .btn-ghost:hover { background: var(--bg-hover); color: var(--text-primary); opacity: 1; }

  .btn-sm { padding: 4px 10px; font-size: 12px; }

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
    color: var(--accent);
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
  .avatar.user-avatar { background: var(--accent); color: var(--text-inverse); }
  .avatar.bot-avatar { background: var(--accent-subtle); color: var(--accent); }

  .msg {
    max-width: 720px;
    padding: 12px 16px;
    border-radius: var(--radius-lg);
    line-height: 1.5;
    font-size: 14px;
  }
  /* Light mode: user bubble = crisp blue gradient; assistant = light gray */
  .msg.user {
    background: var(--accent-gradient);
    color: #ffffff;
    border-bottom-right-radius: var(--radius-sm);
  }
  .msg.user .role { color: rgba(255,255,255,0.9); opacity: 1; }
  .msg.assistant {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-secondary);
    border-bottom-left-radius: var(--radius-sm);
  }
  /* Dark mode: deeper blue gradient for readable contrast */
  :root.dark .msg.user {
    background: linear-gradient(135deg, #1a6fa0, #0f5280);
    color: #ffffff;
  }
  :root.dark .msg.assistant {
    background: var(--bg-tertiary);
    border-color: var(--border-primary);
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
    margin: 10px 0; padding: 12px 14px; border-radius: var(--radius-md);
    background: var(--bg-primary); border: 1px solid var(--border-primary);
    overflow-x: auto;
  }
  .msg.assistant .md-content pre code {
    background: none; padding: 0; font-size: 13px; line-height: 1.5;
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
    gap: 12px;
    text-align: center;
    padding: 60px 20px;
  }
  .chat-welcome .welcome-icon { font-size: 48px; opacity: 0.2; }
  .chat-welcome p { font-size: 15px; }

  .chat-input {
    display: flex;
    gap: 10px;
    padding: 16px 24px;
    border-top: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    align-items: center;
  }
  .chat-input input {
    flex: 1;
    border-radius: 20px;
    padding: 10px 18px;
    background: var(--bg-card);
    border: 1px solid var(--border-primary);
  }
  .chat-input input:focus {
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
    margin-top: 10px;
    padding-left: 16px;
    border-left: 2px solid var(--border-secondary);
    position: relative;
  }

  .activity-step {
    position: relative;
    padding: 4px 0 4px 12px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .activity-step::before {
    content: "";
    position: absolute;
    left: -17px;
    top: 10px;
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

  .activity-thinking {
    position: relative;
    padding: 3px 0 3px 12px;
    font-size: 12px;
    font-style: italic;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .activity-thinking::before {
    content: "";
    position: absolute;
    left: -17px;
    top: 9px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-tertiary);
    animation: thinking-pulse 1.5s ease-in-out infinite;
  }
  @keyframes thinking-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .activity-roundtrip-divider {
    padding: 4px 0 4px 12px;
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
  .paw-modal-actions .btn-confirm { background: var(--accent); color: var(--text-inverse); }
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
    min-width: 380px;
    border-left: none;
    background: var(--bg-card);
  }
  .canvas-panel.open { display: flex; }

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
  :root.dark .canvas-iframe { background: #1a1a2e; }

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
  .chat-toolbar-btn {
    padding: 7px 14px; border-radius: var(--radius-sm); font-size: 13px;
    cursor: pointer; white-space: nowrap; display: inline-flex;
    align-items: center; gap: 6px; border: 1px solid var(--border-primary);
    background: transparent; color: var(--text-secondary);
    transition: all var(--transition);
  }
  .chat-toolbar-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .chat-toolbar-btn.primary {
    background: var(--accent-gradient); color: #ffffff;
    border-color: transparent;
  }
  .chat-toolbar-btn.primary:hover { opacity: 0.9; background: var(--accent-gradient); }
  .chat-toolbar-btn.active { background: var(--accent-subtle); color: var(--accent); border-color: var(--accent); }

  /* ===== RESPONSIVE ===== */
  @media (max-width: 768px) {
    .sidebar { width: var(--sidebar-collapsed); }
    .nav-label, .logo-text { display: none; }
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
  _show: function(title, body, actions) {
    this._close();
    var overlay = document.createElement("div");
    overlay.className = "paw-modal-overlay";
    overlay.onclick = function(e) { if (e.target === overlay) pawModal._close(); };
    var modal = document.createElement("div");
    modal.className = "paw-modal";
    modal.innerHTML = '<div class="paw-modal-title">' + title + '</div>'
      + '<div class="paw-modal-body">' + body + '</div>'
      + '<div class="paw-modal-actions">' + actions + '</div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this._overlay = overlay;
    var firstBtn = modal.querySelector(".btn-confirm");
    if (firstBtn) firstBtn.focus();
    return modal;
  },
  alert: function(title, message) {
    return new Promise(function(resolve) {
      var modal = pawModal._show(title, message,
        '<button class="btn-confirm" onclick="pawModal._close()">OK</button>'
      );
      modal.querySelector(".btn-confirm").onclick = function() { pawModal._close(); resolve(); };
    });
  },
  confirm: function(title, message, opts) {
    opts = opts || {};
    var confirmLabel = opts.confirmLabel || "Confirm";
    var danger = opts.danger ? " danger" : "";
    return new Promise(function(resolve) {
      pawModal._show(title, message,
        '<button class="btn-cancel">Cancel</button><button class="btn-confirm' + danger + '">' + confirmLabel + '</button>'
      );
      pawModal._overlay.querySelector(".btn-cancel").onclick = function() { pawModal._close(); resolve(false); };
      pawModal._overlay.querySelector(".btn-confirm").onclick = function() { pawModal._close(); resolve(true); };
    });
  },
  prompt: function(title, message, defaultVal) {
    return new Promise(function(resolve) {
      var inputId = "paw-modal-input-" + Date.now();
      var body = message + '<input type="text" id="' + inputId + '" value="' + (defaultVal || "").replace(/"/g, "&quot;") + '">';
      pawModal._show(title, body,
        '<button class="btn-cancel">Cancel</button><button class="btn-confirm">Save</button>'
      );
      var input = document.getElementById(inputId);
      input.focus();
      input.select();
      input.onkeydown = function(e) { if (e.key === "Enter") { pawModal._close(); resolve(input.value); } };
      pawModal._overlay.querySelector(".btn-cancel").onclick = function() { pawModal._close(); resolve(null); };
      pawModal._overlay.querySelector(".btn-confirm").onclick = function() { pawModal._close(); resolve(input.value); };
    });
  }
};
`;

const navItems = [
  { path: "/", label: "Dashboard", icon: "dashboard" },
  { path: "/config", label: "Config", icon: "config" },
  { path: "/cron", label: "Cron", icon: "cron" },
  { path: "/heartbeat", label: "Heartbeat", icon: "heartbeat" },
  { path: "/memory", label: "Memory", icon: "memory" },
  { path: "/sessions", label: "Sessions", icon: "sessions" },
  { path: "/mcp", label: "MCP", icon: "mcp" },
  { path: "/skills", label: "Skills", icon: "skills" },
  { path: "/chat", label: "Chat", icon: "chat" },
];

export const Layout: FC<LayoutProps> = ({ title, currentPath, children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      {raw(`<link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`)}
      <title>{title} - Paw</title>
      {raw(
        `<script>(function(){var t=localStorage.getItem("paw-theme")||"system";var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark");window.__pawSetTheme=function(t){localStorage.setItem("paw-theme",t);var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);document.querySelectorAll(".theme-btn").forEach(function(b){b.classList.toggle("active",b.dataset.theme===t);});};window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(){var t=localStorage.getItem("paw-theme")||"system";if(t==="system")__pawSetTheme("system");});})()</script>`,
      )}
      {raw(`<style>${cssDesignSystem}</style>`)}
      {raw(`<script>${modalScript}</script>`)}
    </head>
    <body>
      <div class="app-layout">
        <aside class="sidebar">
          <div class="sidebar-header">
            {raw(
              `<img src="/paw-logo.jpg" width="32" height="32" alt="Paw" style="border-radius:8px;flex-shrink:0" />`,
            )}
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
          </nav>
          <div class="sidebar-footer">
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
            <span>Paw v0.1.0</span>
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
    </body>
  </html>
);
