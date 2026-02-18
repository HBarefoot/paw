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
    skills: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    chat: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
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
    --bg-hover: #f4f5f7;
    --bg-sidebar: #fafbfc;

    --border-primary: #e2e4e9;
    --border-secondary: #eff0f3;
    --border-focus: #6366f1;

    --text-primary: #111827;
    --text-secondary: #6b7280;
    --text-tertiary: #9ca3af;
    --text-inverse: #ffffff;

    --accent: #6366f1;
    --accent-hover: #4f46e5;
    --accent-subtle: #eef2ff;
    --accent-gradient: linear-gradient(135deg, #6366f1, #8b5cf6);

    --success: #10b981;
    --success-bg: #ecfdf5;
    --error: #ef4444;
    --error-bg: #fef2f2;
    --warning: #f59e0b;
    --warning-bg: #fffbeb;
    --info: #3b82f6;
    --info-bg: #eff6ff;

    --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
    --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);
    --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.04);

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
  @media (prefers-color-scheme: dark) {
    :root {
      --bg-primary: #09090b;
      --bg-secondary: #111113;
      --bg-tertiary: #18181b;
      --bg-card: #131316;
      --bg-input: #18181b;
      --bg-hover: #1e1e22;
      --bg-sidebar: #0c0c0e;

      --border-primary: #27272a;
      --border-secondary: #1e1e22;
      --border-focus: #818cf8;

      --text-primary: #f4f4f5;
      --text-secondary: #a1a1aa;
      --text-tertiary: #71717a;
      --text-inverse: #09090b;

      --accent: #818cf8;
      --accent-hover: #6366f1;
      --accent-subtle: rgba(99,102,241,0.12);

      --success-bg: rgba(16,185,129,0.1);
      --error-bg: rgba(239,68,68,0.1);
      --warning-bg: rgba(245,158,11,0.1);
      --info-bg: rgba(59,130,246,0.1);

      --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
      --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.4);
      --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.5);
    }
  }

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
    background: var(--accent-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
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
    transition: all var(--transition);
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: var(--accent-subtle);
    color: var(--accent);
    font-weight: 500;
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

  /* ===== CARDS ===== */
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    padding: 20px;
    margin-bottom: 16px;
    box-shadow: var(--shadow-sm);
    transition: box-shadow var(--transition);
  }

  .card:hover {
    box-shadow: var(--shadow-md);
  }

  .card h3 {
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
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
    font-weight: 700;
    background: var(--accent-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
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
    box-shadow: 0 0 0 3px var(--accent-subtle);
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
    background: var(--accent);
    color: var(--text-inverse);
  }
  button:hover, .btn:hover { background: var(--accent-hover); }
  button:disabled, .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-primary { background: var(--accent); color: var(--text-inverse); }
  .btn-primary:hover { background: var(--accent-hover); }

  .btn-danger { background: var(--error-bg); color: var(--error); border: 1px solid transparent; }
  .btn-danger:hover { border-color: var(--error); background: var(--error-bg); }

  .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--border-primary); }
  .btn-ghost:hover { background: var(--bg-hover); color: var(--text-primary); }

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
  .msg.user {
    background: var(--accent);
    color: var(--text-inverse);
    border-bottom-right-radius: var(--radius-sm);
  }
  .msg.assistant {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-bottom-left-radius: var(--radius-sm);
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
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
    opacity: 0.6;
  }
  .msg.user .role { color: rgba(255,255,255,0.7); }

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
  }
`;

const navItems = [
  { path: "/", label: "Dashboard", icon: "dashboard" },
  { path: "/config", label: "Config", icon: "config" },
  { path: "/cron", label: "Cron", icon: "cron" },
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
      {raw(`<style>${cssDesignSystem}</style>`)}
    </head>
    <body>
      <div class="app-layout">
        <aside class="sidebar">
          <div class="sidebar-header">
            <div class="logo-icon">C</div>
            <span class="logo-text">Paw</span>
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
            <span>Paw v0.1.0</span>
          </div>
        </aside>
        <div class="main-area">
          <header class="topbar">
            <h1 class="page-title">{title}</h1>
          </header>
          <main class="content">{children}</main>
        </div>
      </div>
    </body>
  </html>
);
