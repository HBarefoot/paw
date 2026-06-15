import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { ASSET_VERSION } from "../asset-version.js";

interface LayoutProps {
	title: string;
	currentPath?: string;
	// Suppress the page-title topbar (e.g. on /chat, where the page's own toolbar
	// is the header and the title bar just wastes ~52px). Adds a `no-topbar`
	// marker class so the content can reclaim the height.
	hideTopbar?: boolean;
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
		vault: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
		github: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>`,
		vercel: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 22 20 2 20Z"/></svg>`,
		bell: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`,
		preferences: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
	};
	return icons[name] ?? "";
}

// Geometric paw mark — pure ellipses (toe beans) over a single pad.
// Inherits color via currentColor (see `.paw` in the design system).
export function pawMark(size = 17): string {
	return `<svg class="paw" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="6.4" cy="9.2" rx="2.05" ry="2.6"/><ellipse cx="10.2" cy="6.1" rx="2.15" ry="2.85"/><ellipse cx="13.9" cy="6.1" rx="2.15" ry="2.85"/><ellipse cx="17.7" cy="9.2" rx="2.05" ry="2.6"/><path d="M12 11.4c-3 0-5.6 2.2-5.6 4.9 0 2.1 1.8 3 3.4 3 1 0 1.5-.4 2.2-.4s1.2.4 2.2.4c1.6 0 3.4-.9 3.4-3 0-2.7-2.6-4.9-5.6-4.9Z"/></svg>`;
}

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
      var bodyStr = body == null ? "" : String(body);
      // Dev guard: a string body is escaped to text. If it carries a closing
      // tag it's almost certainly HTML the caller expected to render — warn so
      // the "raw markup in a modal" trap can't recur silently. Pass a DOM Node.
      if (bodyStr.indexOf("</") !== -1 && typeof console !== "undefined" && console.warn) {
        console.warn("pawModal: string body looks like HTML; markup is escaped to text. Pass a DOM Node to render it. Body starts: " + bodyStr.slice(0, 48));
      }
      bodyEl.textContent = bodyStr;
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

// Lightweight global toast. Plain DOM; the icon SVGs come from a trusted
// internal map (never user data), so innerHTML on the icon span is safe. No
// backslash escapes — this whole string is injected via a template literal
// (the inline-script-template-trap). Any page can call window.pawToast(msg, icon).
const toastScript = `
window.pawToast = function(msg, icon) {
  var wrap = document.getElementById("toast-wrap");
  if (!wrap) return;
  var ICONS = {
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none"><path d="M6 4l14 8-14 8z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 9.5 9.5 0 0 1-4-.9L3 21l1.9-4.9A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 21 11.5z"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };
  var t = document.createElement("div");
  t.className = "toast";
  var ic = document.createElement("span");
  ic.style.display = "inline-flex";
  ic.innerHTML = ICONS[icon] || ICONS.check;
  var txt = document.createElement("span");
  txt.textContent = msg == null ? "" : String(msg);
  t.appendChild(ic);
  t.appendChild(txt);
  wrap.appendChild(t);
  setTimeout(function() { t.style.transition = "opacity .2s, transform .2s"; t.style.opacity = "0"; t.style.transform = "translateY(8px)"; }, 2100);
  setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 2400);
};
`;

// Primary, always-visible operational pages.
const navItems = [
	{ path: "/", label: "Dashboard", icon: "dashboard" },
	{ path: "/cron", label: "Cron", icon: "cron" },
	{ path: "/heartbeat", label: "Heartbeat", icon: "heartbeat" },
	{ path: "/search", label: "Search", icon: "search" },
	{ path: "/prompts", label: "Prompts", icon: "prompts" },
	{ path: "/submissions", label: "Submissions", icon: "submissions" },
	{ path: "/notifications", label: "Notifications", icon: "bell" },
	{ path: "/chat", label: "Chat", icon: "chat" },
];

// Secondary pages tucked under a collapsible "Settings" group.
const settingsItems = [
	{ path: "/settings", label: "Settings", icon: "config" },
	{ path: "/vault", label: "Vault", icon: "vault" },
	{ path: "/memory", label: "Memory", icon: "memory" },
	{ path: "/sessions", label: "Sessions", icon: "sessions" },
	{ path: "/audit", label: "Audit", icon: "audit" },
	{ path: "/tools", label: "Tools", icon: "tools" },
	{ path: "/mcp", label: "MCP", icon: "mcp" },
	{ path: "/github", label: "GitHub", icon: "github" },
	{ path: "/vercel", label: "Vercel", icon: "vercel" },
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
		'document.querySelectorAll("[data-brand-chat-label]").forEach(function(el){el.textContent=(b&&b.chatLabel)||"Chat";});',
		"}",
		"function apply(b){applyHead(b);if(document.body)applyBody(b);}",
		"var cached=read();",
		"applyHead(cached);",
		'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",function(){applyBody(cached);});}else{applyBody(cached);}',
		'fetch("/api/brand/ui").then(function(r){return r.json();}).then(function(d){var b=(d&&d.name)?d:null;try{localStorage.setItem(KEY,JSON.stringify(b));}catch(e){}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",function(){apply(b);});}else{apply(b);}}).catch(function(){});',
		"})()",
	].join("");
}

export const Layout: FC<LayoutProps> = ({
	title,
	currentPath,
	hideTopbar,
	children,
}) => (
	<html lang="en">
		<head>
			<meta charset="UTF-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			{raw(
				`<link rel="icon" id="favicon" type="image/png" href="/favicon.png" />`,
			)}
			{/* Fonts (Space Grotesk + JetBrains Mono) are vendored under /fonts and
			    declared via @font-face in ds.css — no external CDN (CSP-clean, offline). */}
			<title>{title} - Paw</title>
			{raw(
				`<script>(function(){var t=localStorage.getItem("paw-theme")||"system";var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark");if(localStorage.getItem("paw-sidebar-collapsed")==="1")document.documentElement.classList.add("sidebar-collapsed");window.__pawToggleSidebar=function(){var c=document.documentElement.classList.toggle("sidebar-collapsed");try{localStorage.setItem("paw-sidebar-collapsed",c?"1":"0");}catch(e){}};window.__pawSetTheme=function(t){localStorage.setItem("paw-theme",t);var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);document.querySelectorAll(".theme-btn").forEach(function(b){b.classList.toggle("active",b.dataset.theme===t);});};window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(){var t=localStorage.getItem("paw-theme")||"system";if(t==="system")__pawSetTheme("system");});})()</script>`,
			)}
			{/* The ~1700-line design system is served from 'self' as a real
			    stylesheet (src/web/public/app/ds.css), NOT inlined from a JS template
			    literal — a stray backtick in a CSS comment used to close the string
			    and break Layout entirely (it cost three sessions). Render-blocking +
			    same-origin, so no flash; ?v busts the cache each deploy. */}
			{raw(
				`<link rel="stylesheet" href="/app/static/ds.css?v=${ASSET_VERSION}">`,
			)}
			{/* Brand theme override — maps the active brand onto the design tokens.
			    Render-blocking + empty when no brand, so no flash and a true no-op. */}
			{raw(`<link rel="stylesheet" href="/api/brand/theme.css">`)}
			{raw(`<script>${brandIdentityScript()}</script>`)}
			{raw(`<script>${modalScript}</script>`)}
			{raw(`<script>${toastScript}</script>`)}
			{raw(`<script>(function(){
  function paint(n){var b=document.getElementById("nav-notif-badge");window.__pawNotifUnread=n;if(!b)return;if(n>0){b.textContent=n>99?"99+":String(n);b.style.display="inline-flex";}else{b.style.display="none";}}
  function poll(){fetch("/api/notifications").then(function(r){return r.json();}).then(function(d){paint((d&&d.unread)||0);}).catch(function(){});}
  document.addEventListener("DOMContentLoaded",function(){poll();setInterval(poll,20000);});
})()</script>`)}
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
								<span
									class="nav-label"
									data-brand-chat-label={item.path === "/chat" ? "" : undefined}
								>
									{item.label}
								</span>
								{item.path === "/notifications" && (
									<span
										id="nav-notif-badge"
										class="nav-badge"
										style="display:none"
									/>
								)}
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
				<div class={hideTopbar ? "main-area no-topbar" : "main-area"}>
					{hideTopbar ? null : (
						<header class="topbar">
							<div class="topbar-tt">
								<div class="crumb" data-brand-name="">
									Paw
								</div>
								<h1 class="page-title">{title}</h1>
							</div>
							<div class="topbar-sp" />
							{raw(
								`<span class="conn-pill"><span class="conn-dot pulse"></span>Online</span>`,
							)}
						</header>
					)}
					<main class="content">{children}</main>
				</div>
			</div>
			<div class="toast-wrap" id="toast-wrap" />
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
