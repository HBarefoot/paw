import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";

const sendIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const refreshIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const trashIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

interface CanvasPageProps {
  sessionId: string;
}

export const CanvasPage: FC<CanvasPageProps> = ({ sessionId }) => {
  return (
    <Layout title="Canvas" currentPath="/canvas">
      {raw(`<style>
        .canvas-layout {
          display: flex;
          height: calc(100vh - 140px);
          gap: 0;
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }
        .canvas-sidebar {
          width: 380px;
          min-width: 320px;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border-primary);
          background: var(--bg-card);
        }
        .canvas-files {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-secondary);
          max-height: 140px;
          overflow-y: auto;
        }
        .canvas-files h4 {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-tertiary);
          margin-bottom: 6px;
        }
        .canvas-file-item {
          display: block;
          padding: 3px 8px;
          font-size: 13px;
          font-family: var(--font-mono);
          color: var(--text-secondary);
          text-decoration: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .canvas-file-item:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .canvas-file-item.active {
          background: var(--accent-subtle);
          color: var(--accent);
        }
        .canvas-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .canvas-input {
          display: flex;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid var(--border-primary);
          background: var(--bg-secondary);
        }
        .canvas-input textarea {
          flex: 1;
          resize: none;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 14px;
          min-height: 40px;
          max-height: 100px;
          background: var(--bg-card);
          border: 1px solid var(--border-primary);
        }
        .canvas-input .send-btn {
          border-radius: 50%;
          width: 38px;
          height: 38px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          align-self: flex-end;
        }
        .canvas-preview {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-secondary);
        }
        .canvas-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-bottom: 1px solid var(--border-secondary);
          background: var(--bg-card);
          font-size: 13px;
        }
        .canvas-toolbar .current-file {
          flex: 1;
          font-family: var(--font-mono);
          color: var(--text-secondary);
        }
        .canvas-toolbar button {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border-primary);
          padding: 4px 8px;
          border-radius: var(--radius-sm);
        }
        .canvas-toolbar button:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .canvas-iframe {
          flex: 1;
          border: none;
          background: #fff;
        }
        .canvas-msg {
          padding: 10px 14px;
          border-radius: var(--radius-md);
          font-size: 14px;
          line-height: 1.5;
        }
        .canvas-msg.user {
          background: var(--accent);
          color: var(--text-inverse);
          align-self: flex-end;
          max-width: 85%;
        }
        .canvas-msg.assistant {
          background: var(--bg-tertiary);
          color: var(--text-primary);
          max-width: 85%;
        }
        .canvas-msg.error {
          background: var(--error-bg);
          color: var(--error);
          font-size: 13px;
        }
        .canvas-msg.system {
          background: var(--info-bg);
          color: var(--info);
          font-size: 12px;
          text-align: center;
          align-self: center;
        }
        .canvas-welcome {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
          color: var(--text-tertiary);
          gap: 8px;
          text-align: center;
          padding: 40px 20px;
        }
        .canvas-welcome .icon { font-size: 40px; opacity: 0.2; }
        .canvas-welcome p { font-size: 14px; }
        .canvas-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-tertiary);
          padding: 0 16px 8px;
        }
        .canvas-status .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-tertiary);
        }
        .canvas-status .dot.connected { background: var(--success); }
        .canvas-status .dot.working { background: var(--warning); animation: pulse-dot 1s ease-in-out infinite; }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
        .canvas-thinking {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: var(--radius-md);
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          font-size: 13px;
        }
        .canvas-thinking .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid var(--border-primary);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>`)}
      <div class="canvas-layout" id="canvas-root" data-session-id={sessionId}>
        <div class="canvas-sidebar">
          <div class="canvas-files" id="canvas-files">
            <h4>Files</h4>
            <div id="file-list"><span class="text-muted text-xs">No files yet</span></div>
          </div>
          <div class="canvas-messages" id="canvas-messages">
            <div class="canvas-welcome" id="canvas-welcome">
              <div class="icon">🎨</div>
              <p>Describe what you want to build</p>
              <p class="text-xs text-muted">e.g. "Create a landing page with a hero section"</p>
            </div>
          </div>
          <div class="canvas-status" id="canvas-status">
            <span class="dot" id="status-dot"></span>
            <span id="status-text">Connecting...</span>
          </div>
          <div class="canvas-input">
            <textarea id="canvas-input" placeholder="Describe what to build..." rows="1"></textarea>
            {raw(`<button class="send-btn" id="canvas-send" onclick="canvasSend()">${sendIconSvg}</button>`)}
          </div>
        </div>
        <div class="canvas-preview">
          <div class="canvas-toolbar">
            <span class="current-file" id="current-file">index.html</span>
            {raw(`<button onclick="canvasRefresh()" title="Refresh preview">${refreshIconSvg}</button>`)}
            {raw(`<button onclick="canvasClear()" title="Clear canvas" style="color:var(--error)">${trashIconSvg}</button>`)}
          </div>
          <iframe class="canvas-iframe" id="canvas-iframe" src="/api/canvas/preview/index.html"></iframe>
        </div>
      </div>
      {raw(`<script src="/js/canvas.js"></script>`)}
    </Layout>
  );
};

export function getCanvasScript(): string {
  return `(function() {
  var sessionId = document.getElementById("canvas-root").dataset.sessionId;
  var messagesDiv = document.getElementById("canvas-messages");
  var input = document.getElementById("canvas-input");
  var iframe = document.getElementById("canvas-iframe");
  var fileListDiv = document.getElementById("file-list");
  var currentFileSpan = document.getElementById("current-file");
  var statusDot = document.getElementById("status-dot");
  var statusText = document.getElementById("status-text");
  var welcomeDiv = document.getElementById("canvas-welcome");
  var currentFile = "index.html";
  var lastEventId = 0;
  var polling = true;
  var lastFileCount = 0;
  var waiting = false;
  var thinkingEl = null;

  // Mark connected immediately — polling is always "connected"
  statusDot.className = "dot connected";
  statusText.textContent = "Connected";

  function showThinking() {
    if (thinkingEl) return;
    waiting = true;
    statusDot.className = "dot working";
    statusText.textContent = "Working...";
    thinkingEl = document.createElement("div");
    thinkingEl.className = "canvas-thinking";
    thinkingEl.id = "canvas-thinking";
    thinkingEl.innerHTML = '<div class="spinner"></div> Generating...';
    messagesDiv.appendChild(thinkingEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function hideThinking() {
    waiting = false;
    statusDot.className = "dot connected";
    statusText.textContent = "Connected";
    if (thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }

  // Poll for events every 1s
  function pollEvents() {
    if (!polling) return;
    fetch("/api/canvas/events?sessionId=" + encodeURIComponent(sessionId) + "&since=" + lastEventId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var events = data.events || [];
        var hadFileChange = false;
        for (var i = 0; i < events.length; i++) {
          var evt = events[i];
          if (evt.id > lastEventId) lastEventId = evt.id;

          if (evt.event === "message" && evt.data && evt.data.content) {
            hideThinking();
            appendMsg("assistant", evt.data.content);
          } else if (evt.event === "file-changed") {
            hadFileChange = true;
            var changed = evt.data && evt.data.path ? evt.data.path : "";
            if (changed === currentFile || currentFile === "index.html") {
              canvasRefresh();
            }
          } else if (evt.event === "error-msg" && evt.data) {
            appendMsg("error", evt.data.content || "An error occurred");
          }
        }
        if (hadFileChange) refreshFiles();

        statusDot.className = "dot connected";
        statusText.textContent = "Connected";
      })
      .catch(function() {
        statusDot.className = "dot";
        statusText.textContent = "Reconnecting...";
      })
      .finally(function() {
        if (polling) setTimeout(pollEvents, 1000);
      });
  }

  pollEvents();

  // Load initial file list
  refreshFiles();

  function refreshFiles() {
    fetch("/api/canvas/files")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.files || data.files.length === 0) {
          fileListDiv.innerHTML = '<span class="text-muted text-xs">No files yet</span>';
          lastFileCount = 0;
          return;
        }
        lastFileCount = data.files.length;
        var html = "";
        data.files.forEach(function(f) {
          var active = f.path === currentFile ? " active" : "";
          html += '<a class="canvas-file-item' + active + '" data-path="' + esc(f.path) + '" onclick="canvasOpenFile(this)">' + esc(f.path) + '</a>';
        });
        fileListDiv.innerHTML = html;
      })
      .catch(function() {});
  }

  window.canvasOpenFile = function(el) {
    var path = el.getAttribute("data-path");
    currentFile = path;
    currentFileSpan.textContent = path;
    iframe.src = "/api/canvas/preview/" + encodeURIComponent(path);
    // Update active state
    var items = fileListDiv.querySelectorAll(".canvas-file-item");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle("active", items[i].getAttribute("data-path") === path);
    }
  };

  window.canvasRefresh = function() {
    var src = iframe.src;
    iframe.src = "about:blank";
    setTimeout(function() { iframe.src = src; }, 50);
  };

  window.canvasClear = function() {
    if (!confirm("Delete all canvas files and start fresh?")) return;
    fetch("/api/canvas/clear", { method: "POST" })
      .then(function(r) { return r.json(); })
      .then(function() {
        fileListDiv.innerHTML = '<span class="text-muted text-xs">No files yet</span>';
        currentFile = "index.html";
        currentFileSpan.textContent = "index.html";
        iframe.src = "/api/canvas/preview/index.html";
        appendMsg("system", "Canvas cleared.");
      })
      .catch(function(err) {
        appendMsg("error", "Failed to clear: " + err.message);
      });
  };

  window.canvasSend = function() {
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.style.height = "auto";

    if (welcomeDiv) {
      welcomeDiv.remove();
      welcomeDiv = null;
    }

    appendMsg("user", text);
    showThinking();

    fetch("/api/canvas/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId, message: text }),
    })
    .then(function(res) {
      if (!res.ok) return res.json().then(function(d) { throw new Error(d.error || "Request failed"); });
    })
    .catch(function(err) {
      hideThinking();
      appendMsg("error", "Failed to send: " + err.message);
    });
  };

  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      canvasSend();
    }
  });

  // Auto-resize textarea
  input.addEventListener("input", function() {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 100) + "px";
  });

  function appendMsg(role, text) {
    var div = document.createElement("div");
    div.className = "canvas-msg " + role;
    if (role === "assistant") {
      div.innerHTML = renderMarkdown(text);
    } else {
      div.textContent = text;
    }
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderMarkdown(src) {
    var text = src.replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n");

    // Fenced code blocks
    var codeBlocks = [];
    text = text.replace(/\\\`\\\`\\\`([\\s\\S]*?)\\\`\\\`\\\`/g, function(m, code) {
      var lines = code.split("\\n");
      var lang = lines[0].trim();
      var body = lang ? lines.slice(1).join("\\n") : code;
      if (body.charAt(0) === "\\n") body = body.substring(1);
      codeBlocks.push('<pre><code>' + esc(body.replace(/\\n$/, "")) + '</code></pre>');
      return "%%CB_" + (codeBlocks.length - 1) + "%%";
    });

    var lines = text.split("\\n");
    var html = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.match(/^%%CB_\\d+%%$/)) {
        html.push(codeBlocks[parseInt(line.match(/\\d+/)[0])]);
      } else if (line.match(/^#{1,3}\\s/)) {
        var m = line.match(/^(#{1,3})\\s+(.+)$/);
        if (m) html.push("<h" + m[1].length + ">" + inlineMd(m[2]) + "</h" + m[1].length + ">");
      } else if (line.match(/^\\s*[-*+]\\s+/)) {
        html.push("<li>" + inlineMd(line.replace(/^\\s*[-*+]\\s+/, "")) + "</li>");
      } else if (line.trim() === "") {
        // skip
      } else {
        html.push("<p>" + inlineMd(line) + "</p>");
      }
    }
    return html.join("\\n");
  }

  function inlineMd(text) {
    var s = esc(text);
    s = s.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>");
    s = s.replace(/\\*(.+?)\\*/g, "<em>$1</em>");
    s = s.replace(/\\\`([^\\\`]+)\\\`/g, "<code>$1</code>");
    return s;
  }
})();
`;
}
