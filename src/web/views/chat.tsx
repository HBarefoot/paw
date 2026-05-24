import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";

interface ChatPageProps {
	sessionId: string;
}

const sendIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const attachIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`;
const canvasIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
const refreshIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const trashIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const shareIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
const exportIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
const templateIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
const historyIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

export const ChatPage: FC<ChatPageProps> = ({ sessionId }) => {
	return (
		<Layout title="Chat" currentPath="/chat">
			{raw(
				`<script>document.querySelector(".content").classList.add("content-full")</script>`,
			)}
			<div class="chat-toolbar">
				<input
					type="search"
					id="session-search"
					class="session-search"
					placeholder="Search sessions..."
					aria-label="Search sessions"
				/>
				<select id="session-selector">
					<option value="">New conversation</option>
				</select>
				{raw(
					`<button class="chat-toolbar-btn primary" id="new-chat-btn" onclick="newChat()">+ New Chat</button>`,
				)}
				{raw(
					`<button class="chat-toolbar-btn" id="export-btn" onclick="exportSession()" title="Export current conversation">Export</button>`,
				)}
				{raw(
					`<button class="chat-toolbar-btn" id="prompts-btn" onclick="openPrompts()" title="Insert a saved prompt">Prompts</button>`,
				)}
				{raw(
					`<button class="chat-toolbar-btn" id="canvas-toggle" onclick="toggleCanvasMode()">${canvasIconSvg} Canvas</button>`,
				)}
			</div>
			<div class="chat-with-canvas" id="chat-with-canvas">
				<div
					class="chat-container"
					id="chat-container"
					data-session-id={sessionId}
				>
					<div class="chat-messages" id="messages">
						<div class="chat-welcome">
							<div class="welcome-icon">💬</div>
							<p>Send a message to start chatting with Paw</p>
						</div>
						<div id="typing" class="msg-wrapper" style="display: none">
							<div class="avatar bot-avatar"><img src="/paw-logo.jpg" alt="Paw" /></div>
							<div class="typing-indicator">
								<span></span>
								<span></span>
								<span></span>
							</div>
						</div>
					</div>
					{raw(
						`<div class="chat-attachments" id="chat-attachments" style="display:none"></div>`,
					)}
					<div class="chat-input">
						{raw(
							`<input type="file" id="file-input" accept="image/*,.csv,.xlsx,.xls" multiple style="display:none" />`,
						)}
						{raw(
							`<button class="attach-btn" id="attach-btn" onclick="document.getElementById('file-input').click()" title="Attach files">${attachIconSvg}</button>`,
						)}
						<textarea
							id="chat-input"
							placeholder="Type a message... (Shift+Enter for new line)"
							autocomplete="off"
							rows={1}
						/>
						{raw(
							`<button class="send-btn" id="send-btn" onclick="sendMessage()">${sendIconSvg}</button>`,
						)}
					</div>
				</div>
				{raw(`<div class="canvas-panel" id="canvas-panel">
          <div class="canvas-toolbar">
            <span class="current-file" id="current-file">index.html</span>
            <button onclick="canvasTemplateMenu(this)" title="Templates" id="canvas-template-btn">${templateIconSvg}</button>
            <button onclick="canvasExportMenu(this)" title="Export / Share" id="canvas-export-btn">${exportIconSvg}</button>
            <button onclick="canvasRefresh()" title="Refresh preview">${refreshIconSvg}</button>
            <button onclick="canvasClear()" title="Clear canvas" style="color:var(--error)">${trashIconSvg}</button>
          </div>
          <div class="canvas-tabs" id="canvas-tabs"></div>
          <div class="canvas-tab-content" id="canvas-tab-content"></div>
          <div class="canvas-status" id="canvas-status">
            <span class="dot" id="status-dot"></span>
            <span id="status-text">Idle</span>
            <span style="margin-left:auto"></span>
            <div id="canvas-files" style="display:flex;align-items:center;gap:4px">
              <span id="file-list" class="text-xs text-muted">No files</span>
            </div>
          </div>
        </div>`)}
			</div>
			{raw(`<script src="/js/chat.js"></script>`)}
		</Layout>
	);
};

/** Returns the chat page JavaScript as a plain string, served via /js/chat.js */
export function getChatScript(): string {
	return `(function() {
  var STORAGE_KEY = "paw-session-id";
  var savedSession = localStorage.getItem(STORAGE_KEY);
  var sessionId = savedSession || document.getElementById("chat-container").dataset.sessionId;
  document.getElementById("chat-container").dataset.sessionId = sessionId;
  var messagesDiv = document.getElementById("messages");
  var input = document.getElementById("chat-input");
  var typingDiv = document.getElementById("typing");
  var selector = document.getElementById("session-selector");
  var sessionSearch = document.getElementById("session-search");
  if (sessionSearch && selector) {
    sessionSearch.addEventListener("input", function() {
      var q = sessionSearch.value.trim().toLowerCase();
      for (var i = 0; i < selector.options.length; i++) {
        var opt = selector.options[i];
        if (!opt.value) continue; // keep placeholder
        var match = !q || opt.text.toLowerCase().indexOf(q) !== -1;
        opt.hidden = !match;
      }
    });
  }
  var fileInput = document.getElementById("file-input");
  var attachmentsDiv = document.getElementById("chat-attachments");
  var pendingImages = [];
  var pendingFiles = [];
  var MAX_FILE_SIZE = 5 * 1024 * 1024;

  function isSpreadsheet(file) {
    var ext = file.name.split(".").pop().toLowerCase();
    return ext === "csv" || ext === "xlsx" || ext === "xls" ||
      file.type === "text/csv" || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel";
  }

  function ingestFile(file) {
    if (file.size > MAX_FILE_SIZE) {
      pawModal.alert("File too large", file.name + " exceeds the 5MB size limit.");
      return;
    }
    if (isSpreadsheet(file)) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var base64 = btoa(new Uint8Array(e.target.result).reduce(function(data, byte) { return data + String.fromCharCode(byte); }, ""));
        var mimeType = file.type || "application/octet-stream";
        pendingFiles.push({ data: base64, mimeType: mimeType, name: file.name });
        renderPendingAttachments();
      };
      reader.readAsArrayBuffer(file);
    } else {
      var reader = new FileReader();
      reader.onload = function(e) {
        var dataUrl = e.target.result;
        var base64 = dataUrl.split(",")[1];
        var mimeType = dataUrl.split(":")[1].split(";")[0];
        pendingImages.push({ data: base64, mimeType: mimeType, dataUrl: dataUrl });
        renderPendingAttachments();
      };
      reader.readAsDataURL(file);
    }
  }

  fileInput.addEventListener("change", function() {
    var files = fileInput.files;
    for (var i = 0; i < files.length; i++) ingestFile(files[i]);
    fileInput.value = "";
  });

  // Drag-and-drop over the chat container. Ignore non-file drags so text
  // drags (e.g. selecting in the page) don't accidentally trigger the
  // drop overlay.
  var chatContainer = document.getElementById("chat-container");
  if (chatContainer) {
    var dragDepth = 0;
    function hasFiles(e) {
      return e.dataTransfer && e.dataTransfer.types &&
        Array.prototype.indexOf.call(e.dataTransfer.types, "Files") !== -1;
    }
    chatContainer.addEventListener("dragenter", function(e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      chatContainer.classList.add("drag-active");
    });
    chatContainer.addEventListener("dragover", function(e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
    });
    chatContainer.addEventListener("dragleave", function(e) {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) chatContainer.classList.remove("drag-active");
    });
    chatContainer.addEventListener("drop", function(e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      chatContainer.classList.remove("drag-active");
      var files = e.dataTransfer.files;
      for (var i = 0; i < files.length; i++) ingestFile(files[i]);
    });
  }

  // Clipboard paste — capture images pasted into the input (e.g. from
  // screenshot tools) and treat them like any other attachment.
  input.addEventListener("paste", function(e) {
    if (!e.clipboardData || !e.clipboardData.items) return;
    var items = e.clipboardData.items;
    var handled = false;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.kind === "file" && item.type.indexOf("image/") === 0) {
        var blob = item.getAsFile();
        if (!blob) continue;
        var ext = (item.type.split("/")[1] || "png").split(";")[0];
        var named = new File([blob], "pasted-" + Date.now() + "." + ext, {
          type: item.type,
        });
        ingestFile(named);
        handled = true;
      }
    }
    if (handled) e.preventDefault();
  });

  function renderPendingAttachments() {
    if (pendingImages.length === 0 && pendingFiles.length === 0) {
      attachmentsDiv.style.display = "none";
      attachmentsDiv.innerHTML = "";
      return;
    }
    attachmentsDiv.style.display = "flex";
    var html = "";
    for (var i = 0; i < pendingImages.length; i++) {
      html += '<div class="attachment-thumb" data-index="' + i + '">' +
        '<img src="' + pendingImages[i].dataUrl + '" alt="Preview" />' +
        '<button class="attachment-remove" onclick="removePendingImage(' + i + ')">\\u00d7</button>' +
        '</div>';
    }
    for (var j = 0; j < pendingFiles.length; j++) {
      html += '<div class="attachment-thumb" style="display:flex;align-items:center;justify-content:center;width:auto;padding:4px 10px;font-size:12px;gap:4px" data-file-index="' + j + '">' +
        '<span>\\uD83D\\uDCC4</span><span>' + escapeHtml(pendingFiles[j].name) + '</span>' +
        '<button class="attachment-remove" style="position:static;width:18px;height:18px;font-size:12px" onclick="removePendingFile(' + j + ')">\\u00d7</button>' +
        '</div>';
    }
    attachmentsDiv.innerHTML = html;
  }

  window.removePendingImage = function(index) {
    pendingImages.splice(index, 1);
    renderPendingAttachments();
  };

  window.removePendingFile = function(index) {
    pendingFiles.splice(index, 1);
    renderPendingAttachments();
  };

  // Strip canvas system-prompt boilerplate from stored user messages
  function extractUserDisplay(content) {
    var m = content.match(/\\[CANVAS MODE\\][\\s\\S]*?User request:\\s*([\\s\\S]*?)(?:\\n\\n--- Current Canvas Files ---|$)/);
    if (m) return m[1].trim();
    return content;
  }

  function loadMessagesForSession(sid) {
    fetch("/api/sessions/" + sid + "/messages")
      .then(function(r) { if (!r.ok) throw new Error("not found"); return r.json(); })
      .then(function(data) {
        if (data.messages && data.messages.length > 0) {
          clearMessages();
          var welcome = messagesDiv.querySelector(".chat-welcome");
          if (welcome) welcome.remove();
          data.messages.forEach(function(m) {
            var text = m.role === "user" ? extractUserDisplay(m.content) : m.content;
            appendMsg(m.role === "user" ? "user" : "assistant", text);
          });
        }
      })
      .catch(function() { /* session may have been deleted */ });
  }

  // Load session list, then auto-load messages for the active session
  function loadSessions(skipMessageLoad) {
    fetch("/api/sessions?limit=20")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var opts = '<option value="">New conversation</option>';
        var foundSession = false;
        (data.sessions || []).forEach(function(s) {
          var label = s.title || s.id.slice(0, 24);
          var selected = s.id === sessionId ? " selected" : "";
          if (s.id === sessionId) foundSession = true;
          opts += '<option value="' + s.id + '"' + selected + '>' + escapeHtml(label) + '</option>';
        });
        selector.innerHTML = opts;

        if (skipMessageLoad) return;

        // If we have a valid session selected, load its messages
        if (foundSession && !sessionId.startsWith("canvas-")) {
          loadMessagesForSession(sessionId);
          return;
        }

        // No saved session — auto-restore the most recent web session
        if (!savedSession) {
          var sessions = data.sessions || [];
          for (var i = 0; i < sessions.length; i++) {
            var s = sessions[i];
            if (s.channel === "web") {
              sessionId = s.id;
              document.getElementById("chat-container").dataset.sessionId = sessionId;
              localStorage.setItem(STORAGE_KEY, sessionId);
              selector.value = sessionId;
              loadMessagesForSession(sessionId);
              return;
            }
          }
        }
      });
  }

  function clearMessages() {
    var welcome = messagesDiv.querySelector(".chat-welcome");
    var wrappers = messagesDiv.querySelectorAll(".msg-wrapper:not(#typing)");
    for (var i = 0; i < wrappers.length; i++) wrappers[i].remove();
    if (!welcome) {
      var w = document.createElement("div");
      w.className = "chat-welcome";
      w.innerHTML = '<div class="welcome-icon">\\uD83D\\uDCAC</div><p>Send a message to start chatting with Paw</p>';
      messagesDiv.insertBefore(w, typingDiv);
    }
  }

  selector.addEventListener("change", function() {
    var val = selector.value;
    if (!val) {
      sessionId = "web-" + Date.now();
      document.getElementById("chat-container").dataset.sessionId = sessionId;
      localStorage.removeItem(STORAGE_KEY);
      clearMessages();
      return;
    }
    sessionId = val;
    document.getElementById("chat-container").dataset.sessionId = val;
    localStorage.setItem(STORAGE_KEY, val);
    loadMessagesForSession(val);
  });

  loadSessions();

  function autoResizeInput() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
    input.style.overflowY = input.scrollHeight > 200 ? "auto" : "hidden";
  }

  input.addEventListener("keydown", function(e) {
    // Enter sends (Shift+Enter = newline). Ctrl/Cmd+Enter also sends so
    // users accustomed to Slack/Discord bindings feel at home.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener("input", autoResizeInput);

  // Delegate clicks for code-block copy buttons. Because markdown is
  // rendered via innerHTML, we can't attach handlers directly.
  messagesDiv.addEventListener("click", function(e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains("code-copy")) {
      var block = t.closest(".code-block");
      var code = block ? block.querySelector("pre code") : null;
      if (!code) return;
      var text = code.textContent || "";
      try {
        navigator.clipboard.writeText(text);
      } catch (err) { /* ignore */ }
      var orig = t.textContent;
      t.textContent = "Copied!";
      setTimeout(function() { t.textContent = orig; }, 1200);
    }
  });

  function createStreamingBubble() {
    var wrapper = document.createElement("div");
    wrapper.className = "msg-wrapper";

    var avatar = document.createElement("div");
    avatar.className = "avatar bot-avatar";
    avatar.innerHTML = '<img src="/paw-logo.jpg" alt="Paw" />';

    var bubble = document.createElement("div");
    bubble.className = "msg assistant";
    bubble.innerHTML = '<div class="role">assistant</div>';

    var mdDiv = document.createElement("div");
    mdDiv.className = "md-content";
    bubble.appendChild(mdDiv);

    // Thinking indicator lives outside the collapsible area so it's always visible
    var thinkingDiv = document.createElement("div");
    thinkingDiv.className = "activity-thinking";
    thinkingDiv.style.display = "none";
    bubble.appendChild(thinkingDiv);

    var activityHeader = document.createElement("div");
    activityHeader.className = "activity-timeline-header";
    activityHeader.innerHTML = '<span class="activity-toggle-icon">&#9654;</span><span class="activity-summary-counts"></span>';
    bubble.appendChild(activityHeader);

    var activityDiv = document.createElement("div");
    activityDiv.className = "activity-timeline collapsed";
    activityDiv.style.display = "none";
    bubble.appendChild(activityDiv);

    activityHeader.addEventListener("click", function() {
      var isCollapsed = activityDiv.classList.toggle("collapsed");
      var chevron = activityHeader.querySelector(".activity-toggle-icon");
      if (chevron) chevron.classList.toggle("expanded", !isCollapsed);
    });

    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    messagesDiv.insertBefore(wrapper, typingDiv);
    return { wrapper: wrapper, mdDiv: mdDiv, activityDiv: activityDiv, activityHeader: activityHeader, thinkingDiv: thinkingDiv, _timers: [], _doneCount: 0, _errorCount: 0, _runningCount: 0 };
  }

  function updateActivitySummary(streamBubble) {
    var parts = [];
    if (streamBubble._doneCount > 0) parts.push('<span class="activity-summary-done">\\u2713 ' + streamBubble._doneCount + ' done</span>');
    if (streamBubble._runningCount > 0) parts.push('<span class="activity-summary-running">\\u21BB ' + streamBubble._runningCount + ' running</span>');
    if (streamBubble._errorCount > 0) parts.push('<span class="activity-summary-error">\\u2717 ' + streamBubble._errorCount + ' failed</span>');
    var countsEl = streamBubble.activityHeader.querySelector(".activity-summary-counts");
    if (countsEl) countsEl.innerHTML = parts.join(' <span style="color:var(--text-tertiary)">\\u00b7</span> ');
  }

  function updateStreamContent(mdDiv, text) {
    mdDiv.innerHTML = renderMarkdown(text);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function showThinking(streamBubble) {
    var area = streamBubble.thinkingDiv;
    area.style.display = "";
    area.innerHTML = '<span class="activity-spinner"></span> Thinking...';
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function hideThinking(streamBubble) {
    // If we have thinking text content, collapse it instead of removing
    var textEl = streamBubble.thinkingDiv.querySelector(".thinking-text-content");
    if (textEl && textEl.textContent.trim()) {
      var details = streamBubble.thinkingDiv.querySelector("details");
      if (details) details.removeAttribute("open");
      return;
    }
    streamBubble.thinkingDiv.style.display = "none";
    streamBubble.thinkingDiv.innerHTML = "";
  }

  function showThinkingText(streamBubble, text) {
    var area = streamBubble.thinkingDiv;
    area.style.display = "";
    // Create the collapsible thinking section if it doesn't exist
    if (!area.querySelector(".thinking-text-content")) {
      area.innerHTML = '<details open class="thinking-details"><summary class="thinking-summary"><span class="activity-spinner"></span> Thinking...</summary><div class="thinking-text-content"></div></details>';
    }
    var contentEl = area.querySelector(".thinking-text-content");
    if (contentEl) {
      contentEl.textContent += text;
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  }

  function addActivityStep(streamBubble, chunk) {
    var activityDiv = streamBubble.activityDiv;

    if (chunk.type === "thinking") {
      // Skip sub-agent thinking — parent spawn_agent step already shows it's running
      if (!streamBubble._activeAgentId) showThinking(streamBubble);
      return;
    }

    if (chunk.type === "roundtrip_start") {
      // Skip sub-agent roundtrip dividers — their tool calls already nest under the parent
      if (streamBubble._activeAgentId) return;
      showThinking(streamBubble);
      if (chunk.roundtrip > 0) {
        activityDiv.style.display = "";
        var divider = document.createElement("div");
        divider.className = "activity-roundtrip-divider";
        divider.textContent = "Step " + (chunk.roundtrip + 1);
        activityDiv.appendChild(divider);
      }
      typingDiv.style.display = "none";
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      return;
    }

    // [a] [b] [c] discover_franchises → [c] discover_franchises
    function cleanAgentLabel(label) {
      var match = label.match(/^(?:\\[[^\\]]+\\]\\s*)+/);
      if (!match) return label;
      var brackets = match[0];
      var rest = label.slice(brackets.length);
      var parts = brackets.match(/\\[([^\\]]+)\\]/g);
      var last = parts[parts.length - 1];
      return last + " " + rest;
    }

    if (chunk.type === "tool_start") {
      // First tool step: show the activity header and timeline
      hideThinking(streamBubble);
      activityDiv.style.display = "";
      if (streamBubble.activityHeader && !streamBubble.activityHeader.classList.contains("visible")) {
        streamBubble.activityHeader.classList.add("visible");
      }

      var id = "tool-" + (chunk.toolId || chunk.toolName).replace(/[^a-zA-Z0-9]/g, "_");
      var step = document.createElement("div");
      step.className = "activity-step running";
      step.setAttribute("data-tool-id", id);

      var label = cleanAgentLabel(chunk.toolSummary || chunk.toolName);
      var durationSpan = '<span class="activity-duration" data-start="' + Date.now() + '">0.0s</span>';

      step.innerHTML = '<div class="activity-step-header">'
        + '<span class="activity-icon"><span class="activity-spinner"></span></span>'
        + '<span class="activity-label">' + escapeHtml(label) + '</span>'
        + durationSpan
        + '</div>';

      // Detect spawn_agent so we can track sub-agent context
      var isSpawnAgent = chunk.toolName === "spawn_agent" || (chunk.toolSummary && chunk.toolSummary.indexOf("Spawning agent") === 0);
      if (isSpawnAgent) {
        step.classList.add("agent-parent");
        streamBubble._activeAgentId = id;
      }

      // All tool calls (including sub-agent ones) appear flat in the timeline.
      // The [agent-name] prefix in the label already identifies the source.
      activityDiv.appendChild(step);

      streamBubble._runningCount++;
      updateActivitySummary(streamBubble);

      // Start live duration counter
      var durEl = step.querySelector(".activity-duration");
      var startTime = Date.now();
      var timer = setInterval(function() {
        var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        durEl.textContent = elapsed + "s";
      }, 100);
      step._timer = timer;
      streamBubble._timers.push(timer);

      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      return;
    }

    if (chunk.type === "tool_end") {
      var id2 = "tool-" + (chunk.toolId || chunk.toolName).replace(/[^a-zA-Z0-9]/g, "_");
      var existing = activityDiv.querySelector("[data-tool-id='" + id2 + "']");
      if (!existing) return;

      // Stop timer
      if (existing._timer) {
        clearInterval(existing._timer);
        existing._timer = null;
      }

      var isError = chunk.toolIsError;

      // Clear active agent tracking when spawn_agent finishes
      if (existing.classList.contains("agent-parent")) {
        streamBubble._activeAgentId = null;
      }

      existing.className = "activity-step " + (isError ? "error" : "done");

      streamBubble._runningCount = Math.max(0, streamBubble._runningCount - 1);
      if (isError) streamBubble._errorCount++;
      else streamBubble._doneCount++;
      updateActivitySummary(streamBubble);

      // Update icon
      var iconEl = existing.querySelector(":scope > .activity-step-header .activity-icon");
      if (iconEl) {
        iconEl.innerHTML = isError ? '<span style="color:var(--error);font-weight:600">\\u2717</span>' : '<span style="color:var(--success,#16a34a);font-weight:600">\\u2713</span>';
      }

      // Update duration
      var durEl2 = existing.querySelector(":scope > .activity-step-header .activity-duration");
      if (durEl2 && chunk.durationMs !== undefined) {
        var secs = (chunk.durationMs / 1000).toFixed(1);
        durEl2.textContent = secs + "s";
      }

      // Add collapsible result preview
      if (chunk.toolResult) {
        var details = document.createElement("details");
        details.className = "activity-details";
        details.innerHTML = '<summary>Result</summary><div class="activity-result-preview">' + escapeHtml(chunk.toolResult) + '</div>';
        existing.appendChild(details);
      }

      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      return;
    }

    if (chunk.type === "error") {
      hideThinking(streamBubble);
      activityDiv.style.display = "";
      var errCard = document.createElement("div");
      errCard.className = "activity-error-card";
      errCard.innerHTML = '<span style="font-weight:600;flex-shrink:0">\\u26A0</span> <span>' + escapeHtml(chunk.error || "Unknown error") + '</span>';
      activityDiv.appendChild(errCard);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      return;
    }
  }

  window.sendMessage = function sendMessage() {
    var text = input.value.trim();
    if (!text && pendingImages.length === 0 && pendingFiles.length === 0) return;
    if (!text) text = pendingFiles.length > 0 ? "(file attached)" : "(image)";
    input.value = "";
    input.style.height = "auto";

    // Capture pending attachments for this message
    var imagesToSend = pendingImages.slice();
    var filesToSend = pendingFiles.slice();
    var userImageUrls = imagesToSend.map(function(img) { return img.dataUrl; });
    var userFileNames = filesToSend.map(function(f) { return f.name; });
    pendingImages = [];
    pendingFiles = [];
    renderPendingAttachments();

    // Remove welcome state if present
    var welcome = messagesDiv.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    appendMsg("user", text, userImageUrls, userFileNames);
    var sendBtn = document.getElementById("send-btn");
    sendBtn.disabled = true;

    // Show typing indicator with stop button
    typingDiv.style.display = "flex";
    var stopBtn = document.createElement("button");
    stopBtn.className = "stop-btn";
    stopBtn.textContent = "Stop";
    stopBtn.title = "Stop generation";
    typingDiv.appendChild(stopBtn);
    var abortCtrl = new AbortController();
    stopBtn.onclick = function() {
      abortCtrl.abort();
      stopBtn.disabled = true;
      stopBtn.textContent = "Stopping...";
      // Also tell the server to cancel
      fetch("/api/chat/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId })
      }).catch(function() {});
    };
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Save session ID to localStorage BEFORE sending so it survives mid-stream reloads
    localStorage.setItem(STORAGE_KEY, sessionId);

    var payload = { sessionId: sessionId, message: text };
    if (imagesToSend.length > 0) {
      payload.images = imagesToSend.map(function(img) { return { data: img.data, mimeType: img.mimeType }; });
    }
    if (filesToSend.length > 0) {
      payload.files = filesToSend.map(function(f) { return { data: f.data, mimeType: f.mimeType, name: f.name }; });
    }

    var streamBubble = createStreamingBubble();
    var fullText = "";

    fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abortCtrl.signal,
    })
    .then(function(res) {
      if (!res.ok) {
        return res.json().then(function(d) { throw new Error(d.error || "Request failed"); });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      function pump() {
        return reader.read().then(function(result) {
          if (result.done) {
            // Process any remaining buffer
            if (buffer.trim()) {
              processSSELines(buffer.split("\\n"));
            }
            finalize(_doneMessageId);
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split("\\n");
          buffer = lines.pop() || "";
          processSSELines(lines);
          return pump();
        });
      }

      var _doneMessageId = null;
      var _totalUsage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
      function processSSELines(lines) {
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.startsWith("data: ")) {
            try {
              var chunk = JSON.parse(line.slice(6));
              if (chunk.type === "text_delta" && chunk.text) {
                fullText += chunk.text;
                updateStreamContent(streamBubble.mdDiv, fullText);
              } else if (chunk.type === "thinking_delta" && chunk.thinkingText) {
                showThinkingText(streamBubble, chunk.thinkingText);
              } else if (chunk.type === "tool_start" || chunk.type === "tool_end" || chunk.type === "thinking" || chunk.type === "roundtrip_start") {
                addActivityStep(streamBubble, chunk);
              } else if (chunk.type === "error") {
                addActivityStep(streamBubble, chunk);
              } else if (chunk.type === "usage" && chunk.usage) {
                _totalUsage.inputTokens += chunk.usage.inputTokens || 0;
                _totalUsage.outputTokens += chunk.usage.outputTokens || 0;
                _totalUsage.estimatedCostUsd += chunk.usage.estimatedCostUsd || 0;
              } else if (chunk.type === "done" && chunk.messageId) {
                _doneMessageId = chunk.messageId;
              }
            } catch(e) { /* ignore parse errors */ }
          }
        }
      }

      function finalize(doneMessageId) {
        // Clean up: hide thinking indicator, stop timers
        hideThinking(streamBubble);
        for (var t = 0; t < streamBubble._timers.length; t++) {
          clearInterval(streamBubble._timers[t]);
        }
        streamBubble._timers = [];
        // Mark any still-running steps as done
        var running = streamBubble.activityDiv.querySelectorAll(".activity-step.running");
        for (var r = 0; r < running.length; r++) {
          running[r].className = "activity-step done";
          var icon = running[r].querySelector(".activity-icon");
          if (icon) icon.innerHTML = '<span style="color:var(--success,#16a34a);font-weight:600">\\u2713</span>';
        }
        // Only show fallback text if no text AND no activity content (errors/tools)
        var hasActivity = streamBubble.activityDiv.children.length > 0;
        if (!fullText && !hasActivity) {
          streamBubble.mdDiv.innerHTML = "<p>No response</p>";
        }
        if (!hasActivity) {
          streamBubble.activityDiv.style.display = "none";
          if (streamBubble.activityHeader) streamBubble.activityHeader.classList.remove("visible");
        }
        // Auto-expand timeline if there were errors
        if (streamBubble._errorCount > 0) {
          streamBubble.activityDiv.classList.remove("collapsed");
          var chevron = streamBubble.activityHeader && streamBubble.activityHeader.querySelector(".activity-toggle-icon");
          if (chevron) chevron.classList.add("expanded");
        }
        updateActivitySummary(streamBubble);
        // Show usage badge if we have token data
        if (_totalUsage.inputTokens > 0 || _totalUsage.outputTokens > 0) {
          var usageBadge = document.createElement("div");
          usageBadge.className = "usage-badge";
          var totalTokens = _totalUsage.inputTokens + _totalUsage.outputTokens;
          var tokenText = totalTokens > 1000 ? (totalTokens / 1000).toFixed(1) + "k" : totalTokens;
          usageBadge.textContent = tokenText + " tokens";
          if (_totalUsage.estimatedCostUsd > 0) {
            usageBadge.textContent += " · $" + _totalUsage.estimatedCostUsd.toFixed(4);
          }
          var bubble = streamBubble.wrapper.querySelector(".msg.assistant");
          if (bubble) bubble.appendChild(usageBadge);
        }
        // Add feedback buttons if we have a message ID
        if (doneMessageId && fullText) {
          addFeedbackButtons(streamBubble.wrapper.querySelector(".msg.assistant"), doneMessageId, sessionId);
        }
        localStorage.setItem(STORAGE_KEY, sessionId);
        loadSessions(true);
        sendBtn.disabled = false;
        typingDiv.style.display = "none";
        if (stopBtn.parentNode) stopBtn.remove();
      }

      return pump();
    })
    .catch(function(err) {
      if (err.name === "AbortError") {
        // User cancelled — show what we have so far
        if (!fullText) {
          streamBubble.mdDiv.innerHTML = "<p><em>Generation stopped.</em></p>";
        }
      } else if (!fullText) {
        streamBubble.mdDiv.innerHTML = "<p>Error: " + escapeHtml(err.message) + "</p>";
      }
      sendBtn.disabled = false;
      typingDiv.style.display = "none";
      if (stopBtn.parentNode) stopBtn.remove();
      // Clean up timers
      for (var t = 0; t < streamBubble._timers.length; t++) {
        clearInterval(streamBubble._timers[t]);
      }
    });
  };

  window.newChat = function newChat() {
    sessionId = "web-" + Date.now();
    document.getElementById("chat-container").dataset.sessionId = sessionId;
    localStorage.removeItem(STORAGE_KEY);
    // Reset canvas session so next canvas use gets a fresh one
    canvasSessionId = "canvas-" + crypto.randomUUID();
    localStorage.setItem(CANVAS_SESSION_KEY, canvasSessionId);
    canvasLastEventId = 0;
    selector.value = "";
    clearMessages();
    input.focus();
  };

  window.openPrompts = async function openPrompts() {
    var res = await fetch("/api/prompts?limit=100");
    if (!res.ok) {
      await pawModal.alert("Prompts", "Could not load the prompt library (HTTP " + res.status + ").");
      return;
    }
    var data = await res.json();
    var prompts = (data.prompts || []);
    if (prompts.length === 0) {
      var create = await pawModal.confirm("Prompts", "You don't have any saved prompts yet. Open the Prompts page to create one?", { confirmLabel: "Open Prompts" });
      if (create) window.location.href = "/prompts";
      return;
    }
    var items = prompts.map(function(p) {
      var tags = p.tags ? " · " + p.tags : "";
      var preview = (p.body || "").slice(0, 80).replace(/\\s+/g, " ");
      return '<div class="prompt-pick" data-pid="' + p.id + '">'
        + '<div><strong>' + escapeHtml(p.title) + '</strong>'
        + '<span class="text-xs text-muted" style="margin-left:6px">' + escapeHtml(tags) + '</span></div>'
        + '<div class="text-xs text-muted" style="margin-top:4px">' + escapeHtml(preview) + '...</div></div>';
    }).join("");
    pawModal._show(
      "Insert a prompt",
      '<div class="prompt-pick-list">' + items + '</div>',
      '<button class="btn-cancel">Cancel</button>'
    );
    pawModal._overlay.querySelector(".btn-cancel").onclick = function() { pawModal._close(); };
    pawModal._overlay.querySelectorAll(".prompt-pick").forEach(function(el) {
      el.onclick = async function() {
        var pid = el.dataset.pid;
        pawModal._close();
        var useRes = await fetch("/api/prompts/" + encodeURIComponent(pid) + "/use", { method: "POST" });
        if (!useRes.ok) return;
        var useData = await useRes.json();
        var body = (useData.prompt && useData.prompt.body) || "";
        input.value = input.value ? input.value + "\\n\\n" + body : body;
        autoResizeInput();
        input.focus();
      };
    });
  };

  window.exportSession = async function exportSession() {
    if (!sessionId || !selector.value) {
      await pawModal.alert("Export", "Select or send a message first to export.");
      return;
    }
    var format = await pawModal.prompt(
      "Export conversation",
      'Choose format: <code>md</code> (default), <code>html</code>, or <code>json</code>.',
      "md"
    );
    if (!format) return;
    var f = String(format).trim().toLowerCase();
    if (f !== "md" && f !== "html" && f !== "json") f = "md";
    window.location.href = "/api/sessions/" + encodeURIComponent(sessionId) + "/export?format=" + f;
  };

  function appendMsg(role, text, images, fileNames) {
    var wrapper = document.createElement("div");
    wrapper.className = "msg-wrapper" + (role === "user" ? " user-msg" : "");

    var avatar = document.createElement("div");
    avatar.className = "avatar " + (role === "user" ? "user-avatar" : "bot-avatar");
    if (role === "user") {
      avatar.textContent = "U";
    } else {
      avatar.innerHTML = '<img src="/paw-logo.jpg" alt="Paw" />';
    }

    var bubble = document.createElement("div");
    bubble.className = "msg " + role;

    if (role === "assistant") {
      var mdDiv = document.createElement("div");
      mdDiv.className = "md-content";
      mdDiv.innerHTML = renderMarkdown(text);
      bubble.innerHTML = '<div class="role">' + role + '</div>';
      bubble.appendChild(mdDiv);
    } else {
      bubble.innerHTML = '<div class="role">' + role + '</div>' + escapeHtml(text);
    }

    // Render any attached images (works for both user and assistant)
    if (images && images.length > 0) {
      for (var idx = 0; idx < images.length; idx++) {
        var img = document.createElement("img");
        img.src = images[idx];
        img.alt = role === "user" ? "Attached image" : "Screenshot";
        img.style.cssText = "max-width:100%;border-radius:8px;margin-top:8px;cursor:pointer";
        img.onclick = function() { window.open(this.src, "_blank"); };
        bubble.appendChild(img);
      }
    }

    // Render file badges
    if (fileNames && fileNames.length > 0) {
      for (var fi = 0; fi < fileNames.length; fi++) {
        var badge = document.createElement("div");
        badge.className = "file-badge";
        badge.textContent = "\\uD83D\\uDCC4 " + fileNames[fi];
        bubble.appendChild(badge);
      }
    }

    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    messagesDiv.insertBefore(wrapper, typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function addFeedbackButtons(bubbleEl, messageId, sid) {
    if (!bubbleEl || !messageId) return;
    var bar = document.createElement("div");
    bar.className = "feedback-bar";

    var copyBtn = document.createElement("button");
    copyBtn.className = "feedback-btn action-btn";
    copyBtn.textContent = "Copy";
    copyBtn.title = "Copy message";
    copyBtn.onclick = function() {
      var md = bubbleEl.querySelector(".md-content");
      var text = md ? (md.innerText || md.textContent || "") : "";
      if (!text) return;
      try { navigator.clipboard.writeText(text); } catch (e) { /* ignore */ }
      var orig = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(function() { copyBtn.textContent = orig; }, 1200);
    };

    var retryBtn = document.createElement("button");
    retryBtn.className = "feedback-btn action-btn";
    retryBtn.textContent = "Retry";
    retryBtn.title = "Regenerate from last user message";
    retryBtn.onclick = function() {
      // Find the last user message bubble preceding this one.
      var wrappers = messagesDiv.querySelectorAll(".msg-wrapper");
      var target = null;
      var thisWrapper = bubbleEl.closest(".msg-wrapper");
      for (var i = wrappers.length - 1; i >= 0; i--) {
        if (wrappers[i] === thisWrapper) continue;
        var userMsg = wrappers[i].querySelector(".msg.user .md-content");
        if (userMsg) { target = userMsg; break; }
      }
      if (!target) return;
      input.value = target.innerText || target.textContent || "";
      autoResizeInput();
      input.focus();
    };

    var forkBtn = document.createElement("button");
    forkBtn.className = "feedback-btn action-btn";
    forkBtn.textContent = "Fork";
    forkBtn.title = "Branch the conversation at this message into a new session";
    forkBtn.onclick = async function() {
      try {
        var res = await fetch("/api/sessions/" + encodeURIComponent(sid) + "/fork", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: messageId })
        });
        var data = await res.json();
        if (!res.ok || !data.newSessionId) {
          await pawModal.alert("Fork failed", data.error || ("HTTP " + res.status));
          return;
        }
        // Jump to the forked session: setting the selector triggers loadSession.
        await loadSessions(true);
        selector.value = data.newSessionId;
        selector.dispatchEvent(new Event("change"));
      } catch (e) {
        await pawModal.alert("Fork failed", String(e));
      }
    };

    var upBtn = document.createElement("button");
    upBtn.className = "feedback-btn";
    upBtn.innerHTML = "\\u{1F44D}";
    upBtn.title = "Good response";
    var downBtn = document.createElement("button");
    downBtn.className = "feedback-btn";
    downBtn.innerHTML = "\\u{1F44E}";
    downBtn.title = "Bad response";

    function sendFeedback(rating) {
      var payload = { messageId: messageId, sessionId: sid, rating: rating };
      if (rating === "down") {
        var reason = prompt("What was wrong with this response? (optional)");
        if (reason) payload.reason = reason;
      }
      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      bar.innerHTML = rating === "up"
        ? '<span class="feedback-thanks">\\u{1F44D} Thanks!</span>'
        : '<span class="feedback-thanks">\\u{1F44E} Noted</span>';
    }

    upBtn.onclick = function() { sendFeedback("up"); };
    downBtn.onclick = function() { sendFeedback("down"); };
    bar.appendChild(copyBtn);
    bar.appendChild(retryBtn);
    bar.appendChild(forkBtn);
    bar.appendChild(upBtn);
    bar.appendChild(downBtn);
    bubbleEl.appendChild(bar);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\\n/g, "<br>");
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderMarkdown(src) {
    var text = src.replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n");

    // Extract fenced code blocks first to protect them
    var codeBlocks = [];
    text = text.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(m, code) {
      var lines = code.split("\\n");
      var lang = lines[0].trim();
      var body = lang ? lines.slice(1).join("\\n") : code;
      if (lang && body.charAt(0) === "\\n") body = body.substring(1);
      if (!lang && body.charAt(0) === "\\n") body = body.substring(1);
      var bodyTrimmed = body.replace(/\\n$/, "");
      var langLabel = lang ? '<span class="code-lang">' + esc(lang) + '</span>' : '';
      var copyBtn = '<button class="code-copy" type="button" title="Copy code" aria-label="Copy code">Copy</button>';
      codeBlocks.push(
        '<div class="code-block">'
        + '<div class="code-header">' + langLabel + copyBtn + '</div>'
        + '<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(bodyTrimmed) + '</code></pre>'
        + '</div>'
      );
      return "%%CODEBLOCK_" + (codeBlocks.length - 1) + "%%";
    });

    var lines = text.split("\\n");
    var html = [];
    var i = 0;
    var inList = false;
    var listType = "";

    function closePendingList() {
      if (inList) {
        html.push("</" + listType + ">");
        inList = false;
        listType = "";
      }
    }

    while (i < lines.length) {
      var line = lines[i];

      // Horizontal rule
      if (/^(\\s*[-*_]\\s*){3,}$/.test(line)) {
        closePendingList();
        html.push("<hr>");
        i++; continue;
      }

      // Headers
      var hMatch = line.match(/^(#{1,6})\\s+(.+)$/);
      if (hMatch) {
        closePendingList();
        var level = hMatch[1].length;
        html.push("<h" + level + ">" + inlineMarkdown(hMatch[2]) + "</h" + level + ">");
        i++; continue;
      }

      // Unordered list item
      var ulMatch = line.match(/^\\s*[-*+]\\s+(.+)$/);
      if (ulMatch) {
        if (!inList || listType !== "ul") {
          closePendingList();
          html.push("<ul>");
          inList = true;
          listType = "ul";
        }
        html.push("<li>" + inlineMarkdown(ulMatch[1]) + "</li>");
        i++; continue;
      }

      // Ordered list item
      var olMatch = line.match(/^\\s*\\d+[.)\\s]\\s*(.+)$/);
      if (olMatch) {
        if (!inList || listType !== "ol") {
          closePendingList();
          html.push("<ol>");
          inList = true;
          listType = "ol";
        }
        html.push("<li>" + inlineMarkdown(olMatch[1]) + "</li>");
        i++; continue;
      }

      // Blockquote
      if (line.match(/^>\\s?/)) {
        closePendingList();
        var bqLines = [];
        while (i < lines.length && lines[i].match(/^>\\s?/)) {
          bqLines.push(lines[i].replace(/^>\\s?/, ""));
          i++;
        }
        html.push("<blockquote>" + inlineMarkdown(bqLines.join("<br>")) + "</blockquote>");
        continue;
      }

      // Code block placeholder
      if (line.match(/^%%CODEBLOCK_\\d+%%$/)) {
        closePendingList();
        var idx = parseInt(line.match(/\\d+/)[0]);
        html.push(codeBlocks[idx]);
        i++; continue;
      }

      // Empty line
      if (line.trim() === "") {
        closePendingList();
        i++; continue;
      }

      // Paragraph
      closePendingList();
      var paraLines = [];
      while (i < lines.length) {
        var pl = lines[i];
        if (pl.trim() === "" || pl.match(/^#{1,6}\\s/) || pl.match(/^\\s*[-*+]\\s+/) ||
            pl.match(/^\\s*\\d+[.)\\s]\\s/) || pl.match(/^>\\s?/) || pl.match(/^%%CODEBLOCK_/) ||
            pl.match(/^(\\s*[-*_]\\s*){3,}$/)) break;
        paraLines.push(pl);
        i++;
      }
      html.push("<p>" + inlineMarkdown(paraLines.join("<br>")) + "</p>");
    }
    closePendingList();

    return html.join("\\n");
  }

  function inlineMarkdown(text) {
    var codes = [];
    var s = text.replace(/\`([^\`]+)\`/g, function(m, c) {
      codes.push('<code>' + esc(c) + '</code>');
      return "%%INLINE_" + (codes.length - 1) + "%%";
    });

    s = esc(s);

    // Restore <br> tags that the AI may include
    s = s.replace(/&lt;br\\s*\\/?&gt;/gi, "<br>");

    // Bold + italic
    s = s.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, "<strong><em>$1</em></strong>");
    // Bold
    s = s.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>");
    // Italic
    s = s.replace(/\\*(.+?)\\*/g, "<em>$1</em>");
    // Strikethrough
    s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
    // Links — validate scheme to prevent javascript:/data:/vbscript: XSS
    s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(m, label, url) {
      var u = String(url).trim();
      var safe = /^(https?:|mailto:|\\/|#)/i.test(u) || /^[a-zA-Z0-9._~\\-]/.test(u);
      if (!safe) return label;
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });

    // Memory citations — \\[mem:<id>\\] becomes a clickable footnote badge.
    // IDs are restricted to safe chars so they can't escape the attribute.
    s = s.replace(/\\[mem:([a-zA-Z0-9-]{4,64})\\]/g, function(_m, id) {
      return '<sup class="mem-cite" data-mem-id="' + id + '" title="Click to view memory" tabindex="0">[' + id.slice(0, 6) + ']</sup>';
    });

    // Restore inline code
    s = s.replace(/%%INLINE_(\\d+)%%/g, function(m, idx) {
      return codes[parseInt(idx)];
    });

    return s;
  }

  // Lazy-fetch + show the text behind a [mem:ID] citation.
  messagesDiv.addEventListener("click", async function(e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains("mem-cite")) return;
    var id = t.dataset.memId;
    if (!id) return;
    try {
      var res = await fetch("/api/memory/" + encodeURIComponent(id));
      if (!res.ok) {
        await pawModal.alert("Memory unavailable", "Could not load memory " + id + " (HTTP " + res.status + ").");
        return;
      }
      var data = await res.json();
      var mem = data.memory || {};
      var body = "<div style='max-height:40vh;overflow:auto;font-size:14px;line-height:1.5'>"
        + "<div class='text-xs text-muted' style='margin-bottom:8px'>"
        + "ID: <code>" + id + "</code> \\u00B7 category: " + escapeHtml(mem.category || "?")
        + (mem.source ? " \\u00B7 source: " + escapeHtml(mem.source) : "")
        + "</div>"
        + "<div>" + escapeHtml(mem.text || "") + "</div></div>";
      await pawModal.alert("Memory " + id.slice(0, 6), body);
    } catch (err) {
      await pawModal.alert("Memory unavailable", String(err));
    }
  });

  // ===== CANVAS MODE =====
  var _canvasRefreshTimer = null;
  var _canvasFileListTimer = null;

  function debouncedCanvasRefresh() {
    if (_canvasRefreshTimer) clearTimeout(_canvasRefreshTimer);
    _canvasRefreshTimer = setTimeout(function() { canvasRefresh(); _canvasRefreshTimer = null; }, 300);
  }

  function debouncedRefreshFiles() {
    if (_canvasFileListTimer) clearTimeout(_canvasFileListTimer);
    _canvasFileListTimer = setTimeout(function() { refreshCanvasFiles(); _canvasFileListTimer = null; }, 300);
  }

  var canvasMode = localStorage.getItem("paw-canvas-mode") === "true";
  var canvasPanel = document.getElementById("canvas-panel");
  var canvasToggleBtn = document.getElementById("canvas-toggle");
  var canvasTabsBar = document.getElementById("canvas-tabs");
  var canvasTabContent = document.getElementById("canvas-tab-content");
  var canvasFileList = document.getElementById("file-list");
  var canvasCurrentFile = document.getElementById("current-file");
  var canvasStatusDot = document.getElementById("status-dot");
  var canvasStatusText = document.getElementById("status-text");
  var CANVAS_SESSION_KEY = "paw-canvas-session-id";
  var canvasSessionId = localStorage.getItem(CANVAS_SESSION_KEY) || "canvas-" + crypto.randomUUID();
  localStorage.setItem(CANVAS_SESSION_KEY, canvasSessionId);
  var canvasLastEventId = 0;
  var canvasPolling = false;
  var canvasCurrentFileName = "index.html";
  var canvasThinkingEl = null;
  var attachBtn = document.getElementById("attach-btn");
  var canvasDividerEl = null;

  // Multi-tab state
  var canvasTabs = [];
  var canvasTabIdSeq = 0;

  function createCanvasTab(path) {
    var id = ++canvasTabIdSeq;
    var iframe = document.createElement("iframe");
    iframe.src = "/api/canvas/preview/" + encodeURIComponent(path);
    iframe.className = "hidden";
    iframe.style.background = "#fff";
    iframe.sandbox = "allow-scripts";
    canvasTabContent.appendChild(iframe);
    var tab = { id: id, path: path, iframeEl: iframe };
    canvasTabs.push(tab);
    renderCanvasTabs();
    activateCanvasTab(id);
    return tab;
  }

  function activateCanvasTab(id) {
    for (var i = 0; i < canvasTabs.length; i++) {
      var isActive = canvasTabs[i].id === id;
      canvasTabs[i].iframeEl.classList.toggle("hidden", !isActive);
      if (isActive) {
        canvasCurrentFileName = canvasTabs[i].path;
        canvasCurrentFile.textContent = canvasTabs[i].path;
      }
    }
    renderCanvasTabs();
  }

  function closeCanvasTab(id) {
    var idx = -1;
    for (var i = 0; i < canvasTabs.length; i++) {
      if (canvasTabs[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return;
    // Don't allow closing the last tab
    if (canvasTabs.length <= 1) return;
    var tab = canvasTabs[idx];
    tab.iframeEl.remove();
    canvasTabs.splice(idx, 1);
    // If closed tab was active, activate nearest
    if (tab.path === canvasCurrentFileName) {
      var newIdx = Math.min(idx, canvasTabs.length - 1);
      activateCanvasTab(canvasTabs[newIdx].id);
    }
    renderCanvasTabs();
  }

  function renderCanvasTabs() {
    var html = "";
    for (var i = 0; i < canvasTabs.length; i++) {
      var t = canvasTabs[i];
      var active = t.path === canvasCurrentFileName ? " active" : "";
      var closeBtn = canvasTabs.length > 1
        ? ' <span class="tab-close" data-tab-id="' + t.id + '">\\u00d7</span>'
        : "";
      html += '<div class="canvas-tab' + active + '" data-tab-id="' + t.id + '">'
        + esc(t.path) + closeBtn + '</div>';
    }
    html += '<div class="canvas-tab canvas-tab-add" id="canvas-tab-add" title="Open file">+</div>';
    canvasTabsBar.innerHTML = html;
    // Attach event listeners for tabs
    var tabEls = canvasTabsBar.querySelectorAll(".canvas-tab:not(.canvas-tab-add)");
    for (var j = 0; j < tabEls.length; j++) {
      (function(el) {
        el.addEventListener("click", function(e) {
          if (e.target.classList.contains("tab-close")) {
            closeCanvasTab(parseInt(e.target.getAttribute("data-tab-id")));
          } else {
            activateCanvasTab(parseInt(el.getAttribute("data-tab-id")));
          }
        });
      })(tabEls[j]);
    }
    // "+" button — show file picker dropdown
    var addBtn = document.getElementById("canvas-tab-add");
    if (addBtn) {
      addBtn.addEventListener("click", function() {
        showTabFilePicker(addBtn);
      });
    }
  }

  function showTabFilePicker(anchorEl) {
    // Remove existing picker if any
    var existing = document.getElementById("canvas-tab-picker");
    if (existing) { existing.remove(); return; }

    fetch("/api/canvas/files", { credentials: "same-origin" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var files = data.files || [];
        // Filter out files already open in tabs
        var openPaths = {};
        for (var i = 0; i < canvasTabs.length; i++) openPaths[canvasTabs[i].path] = true;
        var available = files.filter(function(f) { return !openPaths[f.path]; });

        var picker = document.createElement("div");
        picker.id = "canvas-tab-picker";

        // Position using fixed coordinates from the anchor button
        var rect = anchorEl.getBoundingClientRect();
        picker.style.cssText = "position:fixed;z-index:9000;min-width:180px;max-height:240px;overflow-y:auto;background:var(--bg-card);border:1px solid var(--border-primary);border-radius:var(--radius-sm);box-shadow:var(--shadow-lg);padding:4px 0;"
          + "top:" + rect.bottom + "px;left:" + rect.left + "px;";

        var html = "";
        if (available.length === 0) {
          html = '<div style="padding:10px 14px;font-size:12px;color:var(--text-tertiary);text-align:center">All files are already open</div>';
        } else {
          for (var j = 0; j < available.length; j++) {
            html += '<div class="canvas-tab-picker-item" data-path="' + esc(available[j].path) + '" style="padding:6px 12px;font-size:12px;font-family:var(--font-mono);cursor:pointer;color:var(--text-secondary)">' + esc(available[j].path) + '</div>';
          }
        }
        picker.innerHTML = html;

        document.body.appendChild(picker);

        // Hover styles and click handlers for file items
        var items = picker.querySelectorAll(".canvas-tab-picker-item");
        for (var k = 0; k < items.length; k++) {
          (function(item) {
            item.addEventListener("mouseenter", function() { item.style.background = "var(--bg-hover)"; });
            item.addEventListener("mouseleave", function() { item.style.background = "transparent"; });
            item.addEventListener("click", function() {
              findOrCreateTab(item.getAttribute("data-path"));
              picker.remove();
            });
          })(items[k]);
        }

        // Close on outside click
        setTimeout(function() {
          function closePicker(e) {
            if (!picker.contains(e.target) && e.target !== anchorEl) {
              picker.remove();
              document.removeEventListener("click", closePicker);
            }
          }
          document.addEventListener("click", closePicker);
        }, 0);
      });
  }

  function findOrCreateTab(path) {
    for (var i = 0; i < canvasTabs.length; i++) {
      if (canvasTabs[i].path === path) {
        activateCanvasTab(canvasTabs[i].id);
        return canvasTabs[i];
      }
    }
    return createCanvasTab(path);
  }

  // Initialize default tab
  createCanvasTab("index.html");

  // Draggable divider
  function insertDivider() {
    if (canvasDividerEl) return;
    canvasDividerEl = document.createElement("div");
    canvasDividerEl.className = "canvas-divider";
    var chatWithCanvas = document.getElementById("chat-with-canvas");
    chatWithCanvas.insertBefore(canvasDividerEl, canvasPanel);

    // Restore saved width
    var savedWidth = localStorage.getItem("paw-canvas-width");
    if (savedWidth) canvasPanel.style.setProperty("--canvas-width", savedWidth);

    canvasDividerEl.addEventListener("mousedown", function(e) {
      e.preventDefault();
      canvasDividerEl.classList.add("dragging");
      var container = document.getElementById("chat-with-canvas");
      var containerRect = container.getBoundingClientRect();

      function onMouseMove(e) {
        var x = e.clientX - containerRect.left;
        var pct = ((containerRect.width - x) / containerRect.width) * 100;
        pct = Math.max(20, Math.min(80, pct));
        canvasPanel.style.setProperty("--canvas-width", pct + "%");
      }

      function onMouseUp() {
        canvasDividerEl.classList.remove("dragging");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        var current = canvasPanel.style.getPropertyValue("--canvas-width");
        if (current) localStorage.setItem("paw-canvas-width", current);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  function removeDivider() {
    if (canvasDividerEl) { canvasDividerEl.remove(); canvasDividerEl = null; }
  }

  function applyCanvasMode() {
    if (canvasMode) {
      canvasPanel.classList.add("open");
      canvasToggleBtn.classList.add("active");
      insertDivider();
      startCanvasPolling();
      refreshCanvasFiles();
    } else {
      canvasPanel.classList.remove("open");
      canvasToggleBtn.classList.remove("active");
      removeDivider();
      stopCanvasPolling();
    }
  }

  window.toggleCanvasMode = function() {
    canvasMode = !canvasMode;
    localStorage.setItem("paw-canvas-mode", canvasMode);
    applyCanvasMode();
  };

  var canvasWaitingForResponse = false;
  var canvasPollInterval = 10000; // idle: 10s
  var CANVAS_POLL_FAST = 2000;   // active: 2s (stays under 60 req/min API rate limit)
  var CANVAS_POLL_IDLE = 10000;  // idle: 10s
  var canvasPollTimer = null;

  function startCanvasPolling() {
    if (canvasPolling) return;
    canvasPolling = true;
    canvasPollInterval = canvasWaitingForResponse ? CANVAS_POLL_FAST : CANVAS_POLL_IDLE;
    pollCanvasEvents();
  }

  function stopCanvasPolling() {
    canvasPolling = false;
    if (canvasPollTimer) { clearTimeout(canvasPollTimer); canvasPollTimer = null; }
  }

  function scheduleNextPoll() {
    if (!canvasPolling) return;
    if (canvasPollTimer) clearTimeout(canvasPollTimer);
    canvasPollTimer = setTimeout(pollCanvasEvents, canvasPollInterval);
  }

  function pollCanvasEvents() {
    if (!canvasPolling) return;
    fetch("/api/canvas/events?sessionId=" + encodeURIComponent(canvasSessionId) + "&since=" + canvasLastEventId, { credentials: "same-origin" })
      .then(function(r) {
        if (r.status === 401) {
          stopCanvasPolling();
          if (canvasStatusDot) { canvasStatusDot.className = "dot"; }
          if (canvasStatusText) { canvasStatusText.textContent = "Session expired — please refresh"; }
          return null;
        }
        return r.json();
      })
      .then(function(data) {
        if (!data) return;
        var events = data.events || [];
        var hadFileChange = false;
        for (var i = 0; i < events.length; i++) {
          var evt = events[i];
          if (evt.id > canvasLastEventId) canvasLastEventId = evt.id;
          if (evt.event === "message" && evt.data) {
            hideCanvasThinking();
            canvasWaitingForResponse = false;
            canvasPollInterval = CANVAS_POLL_IDLE;
            appendMsg("assistant", evt.data.content || "(empty response)");
          } else if (evt.event === "error" && evt.data) {
            hideCanvasThinking();
            canvasWaitingForResponse = false;
            canvasPollInterval = CANVAS_POLL_IDLE;
            appendMsg("assistant", "Error: " + (evt.data.message || "Unknown error"));
          } else if (evt.event === "file-changed") {
            hadFileChange = true;
            var changed = evt.data && evt.data.path ? evt.data.path : "";
            if (changed === canvasCurrentFileName || canvasCurrentFileName === "index.html") {
              debouncedCanvasRefresh();
            }
          }
        }
        if (hadFileChange) debouncedRefreshFiles();
        if (canvasStatusDot) { canvasStatusDot.className = "dot connected"; }
        if (canvasStatusText) { canvasStatusText.textContent = canvasWaitingForResponse ? "Working..." : "Connected"; }
      })
      .catch(function() {
        if (canvasStatusDot) { canvasStatusDot.className = "dot"; }
        if (canvasStatusText) { canvasStatusText.textContent = "Reconnecting..."; }
      })
      .finally(function() {
        scheduleNextPoll();
      });
  }

  var canvasThinkingTimeout = null;

  function showCanvasThinking() {
    if (canvasThinkingEl) return;
    canvasWaitingForResponse = true;
    canvasPollInterval = CANVAS_POLL_FAST;
    // Restart polling at fast rate immediately
    if (canvasPollTimer) { clearTimeout(canvasPollTimer); }
    scheduleNextPoll();
    if (canvasStatusDot) { canvasStatusDot.className = "dot working"; }
    if (canvasStatusText) { canvasStatusText.textContent = "Working..."; }
    canvasThinkingEl = document.createElement("div");
    canvasThinkingEl.className = "canvas-thinking";
    canvasThinkingEl.innerHTML = '<div class="spinner"></div> Generating...';
    messagesDiv.insertBefore(canvasThinkingEl, typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    // Auto-clear after 5 minutes to prevent stuck state
    if (canvasThinkingTimeout) clearTimeout(canvasThinkingTimeout);
    canvasThinkingTimeout = setTimeout(function() {
      if (canvasWaitingForResponse) {
        hideCanvasThinking();
        canvasWaitingForResponse = false;
        canvasPollInterval = CANVAS_POLL_IDLE;
        appendMsg("assistant", "Request timed out. The AI may still be processing — check the canvas preview or try again.");
      }
    }, 300000);
  }

  function hideCanvasThinking() {
    if (canvasThinkingTimeout) { clearTimeout(canvasThinkingTimeout); canvasThinkingTimeout = null; }
    if (canvasStatusDot) { canvasStatusDot.className = "dot connected"; }
    if (canvasStatusText) { canvasStatusText.textContent = "Connected"; }
    if (canvasThinkingEl) { canvasThinkingEl.remove(); canvasThinkingEl = null; }
  }

  function refreshCanvasFiles() {
    fetch("/api/canvas/files", { credentials: "same-origin" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.files || data.files.length === 0) {
          canvasFileList.innerHTML = '<span class="text-xs text-muted">No files</span>';
          return;
        }
        var html = "";
        data.files.forEach(function(f) {
          var active = f.path === canvasCurrentFileName ? " active" : "";
          html += '<a class="canvas-file-item' + active + '" data-path="' + esc(f.path) + '" onclick="canvasOpenFile(this)">' + esc(f.path) + '</a>';
        });
        canvasFileList.innerHTML = html;
      })
      .catch(function() {});
  }

  window.canvasOpenFile = function(el) {
    var path = el.getAttribute("data-path");
    findOrCreateTab(path);
    var items = canvasFileList.querySelectorAll(".canvas-file-item");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle("active", items[i].getAttribute("data-path") === path);
    }
  };

  window.canvasRefresh = function() {
    // Refresh the active tab's iframe
    for (var i = 0; i < canvasTabs.length; i++) {
      if (canvasTabs[i].path === canvasCurrentFileName) {
        var iframe = canvasTabs[i].iframeEl;
        var src = iframe.src;
        iframe.src = "about:blank";
        setTimeout(function() { iframe.src = src; }, 50);
        break;
      }
    }
  };

  window.canvasClear = async function() {
    var ok = await pawModal.confirm("Clear Canvas", "Delete all canvas files and start fresh?", { confirmLabel: "Clear All", danger: true });
    if (!ok) return;
    fetch("/api/canvas/clear", { method: "POST", credentials: "same-origin" })
      .then(function(r) { return r.json(); })
      .then(function() {
        canvasFileList.innerHTML = '<span class="text-muted text-xs">No files yet</span>';
        // Reset tabs — remove all iframes and recreate default tab
        for (var i = 0; i < canvasTabs.length; i++) canvasTabs[i].iframeEl.remove();
        canvasTabs = [];
        canvasTabIdSeq = 0;
        createCanvasTab("index.html");
        appendMsg("assistant", "Canvas cleared.");
      })
      .catch(function(err) {
        appendMsg("assistant", "Failed to clear: " + err.message);
      });
  };

  // Export / Share menu
  window.canvasExportMenu = function(anchorEl) {
    var existing = document.getElementById("canvas-export-picker");
    if (existing) { existing.remove(); return; }

    var rect = anchorEl.getBoundingClientRect();
    var menu = document.createElement("div");
    menu.id = "canvas-export-picker";
    menu.style.cssText = "position:fixed;z-index:9000;min-width:200px;background:var(--bg-card);border:1px solid var(--border-primary);border-radius:var(--radius-sm);box-shadow:var(--shadow-lg);padding:4px 0;"
      + "top:" + rect.bottom + 4 + "px;right:" + (window.innerWidth - rect.right) + "px;";

    menu.innerHTML = ''
      + '<div class="canvas-export-item" data-action="copy-source" style="padding:8px 14px;font-size:13px;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:15px">\\uD83D\\uDCCB</span> Copy source code</div>'
      + '<div class="canvas-export-item" data-action="download-file" style="padding:8px 14px;font-size:13px;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:15px">\\uD83D\\uDCC4</span> Download current file</div>'
      + '<div class="canvas-export-item" data-action="download-zip" style="padding:8px 14px;font-size:13px;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:15px">\\uD83D\\uDCE6</span> Download all as ZIP</div>'
      + '<div style="border-top:1px solid var(--border-secondary);margin:4px 0"></div>'
      + '<div class="canvas-export-item" data-action="share-link" style="padding:8px 14px;font-size:13px;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:15px">\\uD83D\\uDD17</span> Share link (24h)</div>';

    document.body.appendChild(menu);

    var items = menu.querySelectorAll(".canvas-export-item");
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        item.addEventListener("mouseenter", function() { item.style.background = "var(--bg-hover)"; });
        item.addEventListener("mouseleave", function() { item.style.background = "transparent"; });
        item.addEventListener("click", function() {
          menu.remove();
          var action = item.getAttribute("data-action");
          if (action === "copy-source") canvasCopySource();
          else if (action === "download-file") canvasDownloadFile();
          else if (action === "download-zip") canvasDownloadZip();
          else if (action === "share-link") canvasShareLink();
        });
      })(items[i]);
    }

    setTimeout(function() {
      function closeMenu(e) {
        if (!menu.contains(e.target) && e.target !== anchorEl) {
          menu.remove();
          document.removeEventListener("click", closeMenu);
        }
      }
      document.addEventListener("click", closeMenu);
    }, 0);
  };

  function canvasCopySource() {
    fetch("/api/canvas/preview/" + encodeURIComponent(canvasCurrentFileName), { credentials: "same-origin" })
      .then(function(r) {
        if (!r.ok) throw new Error("File not found");
        return r.text();
      })
      .then(function(text) {
        return navigator.clipboard.writeText(text);
      })
      .then(function() {
        pawModal.alert("Copied", "Source code for <strong>" + esc(canvasCurrentFileName) + "</strong> copied to clipboard.");
      })
      .catch(function(err) {
        pawModal.alert("Error", "Failed to copy: " + err.message);
      });
  }

  function canvasDownloadFile() {
    var a = document.createElement("a");
    a.href = "/api/canvas/preview/" + encodeURIComponent(canvasCurrentFileName);
    a.download = canvasCurrentFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function canvasDownloadZip() {
    var a = document.createElement("a");
    a.href = "/api/canvas/download";
    a.download = "canvas.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function canvasShareLink() {
    fetch("/api/canvas/share", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: canvasCurrentFileName }) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) { pawModal.alert("Share Error", data.error); return; }
        var url = location.origin + data.url;
        pawModal.alert("Canvas Shared", "Share this link (valid for 24 hours):<br><br><input type=\\"text\\" value=\\"" + url + "\\" onclick=\\"this.select()\\" readonly style=\\"width:100%;margin-top:4px\\">");
      })
      .catch(function(err) {
        pawModal.alert("Share Error", "Failed to share: " + err.message);
      });
  }

  // Override sendMessage when canvas mode is on
  var _origSendMessage = window.sendMessage;
  window.sendMessage = function() {
    if (!canvasMode) return _origSendMessage();

    var text = input.value.trim();
    if (!text && pendingImages.length === 0 && pendingFiles.length === 0) return;
    if (!text) text = pendingFiles.length > 0 ? "(file attached)" : "(image)";
    input.value = "";
    input.style.height = "auto";

    // Capture pending attachments
    var imagesToSend = pendingImages.slice();
    var filesToSend = pendingFiles.slice();
    var userImageUrls = imagesToSend.map(function(img) { return img.dataUrl; });
    var userFileNames = filesToSend.map(function(f) { return f.name; });
    pendingImages = [];
    pendingFiles = [];
    renderPendingAttachments();

    var welcome = messagesDiv.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    appendMsg("user", text, userImageUrls, userFileNames);

    var sendBtn = document.getElementById("send-btn");
    sendBtn.disabled = true;

    // Show working status in canvas bar
    if (canvasStatusDot) { canvasStatusDot.className = "dot working"; }
    if (canvasStatusText) { canvasStatusText.textContent = "Working..."; }

    var payload = { sessionId: canvasSessionId, message: text };
    if (imagesToSend.length > 0) {
      payload.images = imagesToSend.map(function(img) { return { data: img.data, mimeType: img.mimeType }; });
    }
    if (filesToSend.length > 0) {
      payload.files = filesToSend.map(function(f) { return { data: f.data, mimeType: f.mimeType, name: f.name }; });
    }

    // Use async POST + polling instead of SSE to avoid Bun chunked encoding issues on long-running streams
    fetch("/api/canvas/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    })
    .then(function(res) {
      if (!res.ok) {
        return res.json().then(function(d) { throw new Error(d.error || "Request failed"); });
      }
      // Start fast polling to pick up streaming chunks
      canvasWaitingForResponse = true;
      canvasPollInterval = CANVAS_POLL_FAST;
      if (canvasPollTimer) clearTimeout(canvasPollTimer);
      scheduleNextPoll();
    })
    .catch(function(err) {
      appendMsg("assistant", "Failed to send: " + escapeHtml(err.message));
      sendBtn.disabled = false;
      if (canvasStatusDot) { canvasStatusDot.className = "dot connected"; }
      if (canvasStatusText) { canvasStatusText.textContent = "Connected"; }
    });
  };

  // B1: Version history — show history dropdown for current tab
  window.canvasShowHistory = function(anchorEl) {
    var existing = document.getElementById("canvas-history-picker");
    if (existing) { existing.remove(); return; }

    fetch("/api/canvas/versions/" + encodeURIComponent(canvasCurrentFileName), { credentials: "same-origin" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var versions = data.versions || [];
        var picker = document.createElement("div");
        picker.id = "canvas-history-picker";
        var rect = anchorEl.getBoundingClientRect();
        picker.style.cssText = "position:fixed;z-index:9000;min-width:260px;max-height:300px;overflow-y:auto;background:var(--bg-card);border:1px solid var(--border-primary);border-radius:var(--radius-sm);box-shadow:var(--shadow-lg);padding:4px 0;"
          + "top:" + rect.bottom + "px;left:" + rect.left + "px;";

        if (versions.length === 0) {
          picker.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:var(--text-tertiary);text-align:center">No version history yet</div>';
        } else {
          var html = '<div style="padding:6px 12px;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px">Version History</div>';
          for (var i = 0; i < versions.length; i++) {
            var v = versions[i];
            var time = new Date(v.created_at + "Z").toLocaleString();
            html += '<div class="canvas-history-item" data-id="' + v.id + '" style="padding:6px 12px;font-size:12px;cursor:pointer;color:var(--text-secondary);display:flex;justify-content:space-between;align-items:center">'
              + '<span>' + esc(time) + '</span>'
              + '<span class="canvas-history-restore" data-id="' + v.id + '" style="color:var(--primary);font-size:11px;font-weight:500">Restore</span>'
              + '</div>';
          }
          picker.innerHTML = html;
        }
        document.body.appendChild(picker);

        var restoreBtns = picker.querySelectorAll(".canvas-history-restore");
        for (var j = 0; j < restoreBtns.length; j++) {
          (function(btn) {
            btn.addEventListener("click", function(e) {
              e.stopPropagation();
              var vId = btn.getAttribute("data-id");
              canvasRestoreVersion(vId);
              picker.remove();
            });
          })(restoreBtns[j]);
        }

        var items = picker.querySelectorAll(".canvas-history-item");
        for (var k = 0; k < items.length; k++) {
          (function(item) {
            item.addEventListener("mouseenter", function() { item.style.background = "var(--bg-hover)"; });
            item.addEventListener("mouseleave", function() { item.style.background = "transparent"; });
          })(items[k]);
        }

        setTimeout(function() {
          function closeH(e) {
            if (!picker.contains(e.target) && e.target !== anchorEl) { picker.remove(); document.removeEventListener("click", closeH); }
          }
          document.addEventListener("click", closeH);
        }, 0);
      });
  };

  function canvasRestoreVersion(id) {
    fetch("/api/canvas/restore/" + id, { method: "POST", credentials: "same-origin" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) { pawModal.alert("Restore Error", data.error); return; }
        canvasRefresh();
        appendMsg("assistant", "Restored previous version of " + esc(data.path));
      })
      .catch(function(err) { pawModal.alert("Error", "Failed to restore: " + err.message); });
  }

  // B3: Templates menu
  window.canvasTemplateMenu = function(anchorEl) {
    var existing = document.getElementById("canvas-template-picker");
    if (existing) { existing.remove(); return; }

    fetch("/api/canvas/templates", { credentials: "same-origin" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var templates = data.templates || [];
        var picker = document.createElement("div");
        picker.id = "canvas-template-picker";
        var rect = anchorEl.getBoundingClientRect();
        picker.style.cssText = "position:fixed;z-index:9000;min-width:220px;max-height:300px;overflow-y:auto;background:var(--bg-card);border:1px solid var(--border-primary);border-radius:var(--radius-sm);box-shadow:var(--shadow-lg);padding:4px 0;"
          + "top:" + rect.bottom + 4 + "px;right:" + (window.innerWidth - rect.right) + "px;";

        var html = '<div style="padding:6px 12px;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px">Templates</div>';
        for (var i = 0; i < templates.length; i++) {
          var t = templates[i];
          html += '<div class="canvas-template-item" data-name="' + esc(t.name) + '" style="padding:8px 12px;cursor:pointer;color:var(--text-secondary)">'
            + '<div style="font-size:13px;font-weight:500">' + esc(t.name) + '</div>'
            + '<div style="font-size:11px;color:var(--text-tertiary)">' + esc(t.description) + '</div>'
            + '</div>';
        }
        picker.innerHTML = html;
        document.body.appendChild(picker);

        var items = picker.querySelectorAll(".canvas-template-item");
        for (var j = 0; j < items.length; j++) {
          (function(item) {
            item.addEventListener("mouseenter", function() { item.style.background = "var(--bg-hover)"; });
            item.addEventListener("mouseleave", function() { item.style.background = "transparent"; });
            item.addEventListener("click", async function() {
              picker.remove();
              var name = item.getAttribute("data-name");
              var ok = await pawModal.confirm("Apply Template", 'This will clear all existing canvas files and apply the "' + name + '" template. Continue?', { confirmLabel: "Apply", danger: true });
              if (!ok) return;
              canvasApplyTemplate(name);
            });
          })(items[j]);
        }

        setTimeout(function() {
          function closeT(e) {
            if (!picker.contains(e.target) && e.target !== anchorEl) { picker.remove(); document.removeEventListener("click", closeT); }
          }
          document.addEventListener("click", closeT);
        }, 0);
      });
  };

  function canvasApplyTemplate(name) {
    fetch("/api/canvas/template", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { pawModal.alert("Template Error", data.error); return; }
      for (var i = 0; i < canvasTabs.length; i++) canvasTabs[i].iframeEl.remove();
      canvasTabs = [];
      canvasTabIdSeq = 0;
      createCanvasTab("index.html");
      refreshCanvasFiles();
      appendMsg("assistant", "Applied template. Files: " + data.files.join(", "));
    })
    .catch(function(err) { pawModal.alert("Error", "Failed to apply template: " + err.message); });
  }

  // B4: Simple line diff algorithm (LCS-based)
  function computeLineDiff(oldText, newText) {
    var oldLines = oldText.split("\\n");
    var newLines = newText.split("\\n");
    var maxLines = 500;
    if (oldLines.length > maxLines || newLines.length > maxLines) {
      return [{ type: "info", text: "(file too large for inline diff)" }];
    }
    var dp = [];
    for (var i = 0; i <= oldLines.length; i++) {
      dp[i] = [];
      for (var j = 0; j <= newLines.length; j++) {
        if (i === 0 || j === 0) dp[i][j] = 0;
        else if (oldLines[i-1] === newLines[j-1]) dp[i][j] = dp[i-1][j-1] + 1;
        else dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
      }
    }
    var diffs = [];
    var i = oldLines.length, j = newLines.length;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i-1] === newLines[j-1]) {
        diffs.unshift({ type: "same", text: oldLines[i-1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
        diffs.unshift({ type: "add", text: newLines[j-1] });
        j--;
      } else {
        diffs.unshift({ type: "del", text: oldLines[i-1] });
        i--;
      }
    }
    return diffs;
  }

  // B4: Show diff in chat after file changes
  function showFileDiff(path, oldContent, newContent) {
    var diffs = computeLineDiff(oldContent, newContent);
    var hasChanges = diffs.some(function(d) { return d.type !== "same"; });
    if (!hasChanges) return;

    var html = '<details class="canvas-diff"><summary style="cursor:pointer;font-size:12px;color:var(--text-tertiary);margin:4px 0">View changes to ' + esc(path) + '</summary>'
      + '<pre style="font-size:11px;line-height:1.4;margin:4px 0;padding:8px;background:var(--bg-secondary);border-radius:var(--radius-sm);overflow-x:auto;max-height:300px">';
    for (var k = 0; k < diffs.length; k++) {
      var d = diffs[k];
      if (d.type === "add") html += '<span style="color:#16a34a;background:#dcfce7">+ ' + esc(d.text) + '</span>\\n';
      else if (d.type === "del") html += '<span style="color:#dc2626;background:#fee2e2">- ' + esc(d.text) + '</span>\\n';
      else if (d.type === "info") html += '<span style="color:var(--text-tertiary)">' + esc(d.text) + '</span>\\n';
    }
    html += '</pre></details>';

    var wrapper = document.createElement("div");
    wrapper.className = "msg-wrapper";
    wrapper.innerHTML = '<div class="avatar bot-avatar">P</div><div class="msg assistant"><div class="md-content">' + html + '</div></div>';
    messagesDiv.insertBefore(wrapper, typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // B5: Save indicator + conflict detection
  var canvasFileMtimes = {};
  var canvasSaveIndicators = {};

  function updateSaveIndicator(path, status) {
    canvasSaveIndicators[path] = status;
    renderCanvasTabs();
    if (status === "saved") {
      setTimeout(function() {
        if (canvasSaveIndicators[path] === "saved") {
          canvasSaveIndicators[path] = null;
          renderCanvasTabs();
        }
      }, 3000);
    }
  }

  // Override renderCanvasTabs to include history button and save indicators
  var _origRenderCanvasTabs = renderCanvasTabs;
  renderCanvasTabs = function() {
    var html = "";
    for (var i = 0; i < canvasTabs.length; i++) {
      var t = canvasTabs[i];
      var active = t.path === canvasCurrentFileName ? " active" : "";
      var indicator = "";
      var si = canvasSaveIndicators[t.path];
      if (si === "saved") indicator = '<span class="save-dot save-dot-green" title="Saved"></span>';
      else if (si === "external") indicator = '<span class="save-dot save-dot-orange" title="Changed externally"></span>';
      var closeBtn = canvasTabs.length > 1
        ? ' <span class="tab-close" data-tab-id="' + t.id + '">\\u00d7</span>'
        : "";
      var histBtn = active ? ' <span class="tab-history" data-tab-id="' + t.id + '" title="Version history">${historyIconSvg}</span>' : "";
      html += '<div class="canvas-tab' + active + '" data-tab-id="' + t.id + '">'
        + indicator + esc(t.path) + histBtn + closeBtn + '</div>';
    }
    html += '<div class="canvas-tab canvas-tab-add" id="canvas-tab-add" title="Open file">+</div>';
    canvasTabsBar.innerHTML = html;

    var tabEls = canvasTabsBar.querySelectorAll(".canvas-tab:not(.canvas-tab-add)");
    for (var j = 0; j < tabEls.length; j++) {
      (function(el) {
        el.addEventListener("click", function(e) {
          if (e.target.classList.contains("tab-close")) {
            closeCanvasTab(parseInt(e.target.getAttribute("data-tab-id")));
          } else if (e.target.closest && e.target.closest(".tab-history")) {
            canvasShowHistory(e.target.closest(".tab-history"));
          } else if (e.target.classList.contains("tab-history") || e.target.tagName === "svg" || e.target.tagName === "circle" || e.target.tagName === "polyline") {
            var histEl = el.querySelector(".tab-history");
            if (histEl) canvasShowHistory(histEl);
          } else {
            activateCanvasTab(parseInt(el.getAttribute("data-tab-id")));
          }
        });
      })(tabEls[j]);
    }

    var addBtn = document.getElementById("canvas-tab-add");
    if (addBtn) {
      addBtn.addEventListener("click", function() {
        showTabFilePicker(addBtn);
      });
    }
  };

  // B5: Track file mtimes from file list refreshes
  var _origRefreshCanvasFiles = refreshCanvasFiles;
  refreshCanvasFiles = function() {
    fetch("/api/canvas/files", { credentials: "same-origin" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.files || data.files.length === 0) {
          canvasFileList.innerHTML = '<span class="text-xs text-muted">No files</span>';
          return;
        }
        var html = "";
        data.files.forEach(function(f) {
          var active = f.path === canvasCurrentFileName ? " active" : "";
          html += '<a class="canvas-file-item' + active + '" data-path="' + esc(f.path) + '" onclick="canvasOpenFile(this)">' + esc(f.path) + '</a>';

          if (canvasFileMtimes[f.path] !== undefined && f.mtime > canvasFileMtimes[f.path]) {
            if (!canvasWaitingForResponse) {
              updateSaveIndicator(f.path, "external");
            } else {
              updateSaveIndicator(f.path, "saved");
            }
          }
          canvasFileMtimes[f.path] = f.mtime;
        });
        canvasFileList.innerHTML = html;
      })
      .catch(function() {});
  };

  // B4: Enhanced polling to track file changes for diff view
  // Streaming state for chunk events received via polling
  var canvasStreamBubble = null;
  var canvasStreamFullText = "";

  pollCanvasEvents = function() {
    if (!canvasPolling) return;
    fetch("/api/canvas/events?sessionId=" + encodeURIComponent(canvasSessionId) + "&since=" + canvasLastEventId, { credentials: "same-origin" })
      .then(function(r) {
        if (r.status === 401) {
          stopCanvasPolling();
          if (canvasStatusDot) { canvasStatusDot.className = "dot"; }
          if (canvasStatusText) { canvasStatusText.textContent = "Session expired — please refresh"; }
          return null;
        }
        if (r.status === 429) {
          // Rate limited — back off then retry
          var retryAfter = parseInt(r.headers.get("Retry-After") || "5", 10);
          canvasPollInterval = Math.max(retryAfter * 1000, 5000);
          return null;
        }
        // Restore fast interval after successful poll if still waiting
        if (canvasWaitingForResponse && canvasPollInterval > CANVAS_POLL_FAST) {
          canvasPollInterval = CANVAS_POLL_FAST;
        }
        return r.json();
      })
      .then(function(data) {
        if (!data) return;
        var events = data.events || [];
        var hadFileChange = false;
        var changedPaths = [];
        for (var i = 0; i < events.length; i++) {
          var evt = events[i];
          if (evt.id > canvasLastEventId) canvasLastEventId = evt.id;
          if (evt.event === "chunk" && evt.data) {
            var chunk = evt.data;
            if (chunk.type === "text_delta" && chunk.text) {
              if (!canvasStreamBubble) {
                hideCanvasThinking();
                canvasStreamBubble = createStreamingBubble();
                canvasStreamFullText = "";
              }
              canvasStreamFullText += chunk.text;
              updateStreamContent(canvasStreamBubble.mdDiv, canvasStreamFullText);
            } else if (chunk.type === "tool_start" || chunk.type === "tool_end" || chunk.type === "thinking" || chunk.type === "roundtrip_start") {
              if (!canvasStreamBubble) {
                hideCanvasThinking();
                canvasStreamBubble = createStreamingBubble();
                canvasStreamFullText = "";
              }
              addActivityStep(canvasStreamBubble, chunk);
              if (chunk.type === "tool_end" && chunk.toolName === "canvas_write") {
                debouncedCanvasRefresh();
                debouncedRefreshFiles();
              }
            } else if (chunk.type === "error") {
              if (!canvasStreamBubble) {
                hideCanvasThinking();
                canvasStreamBubble = createStreamingBubble();
                canvasStreamFullText = "";
              }
              addActivityStep(canvasStreamBubble, chunk);
            } else if (chunk.type === "done") {
              // Finalize the streaming bubble
              if (canvasStreamBubble) {
                hideThinking(canvasStreamBubble);
                for (var t = 0; t < canvasStreamBubble._timers.length; t++) {
                  clearInterval(canvasStreamBubble._timers[t]);
                }
                canvasStreamBubble._timers = [];
                var running = canvasStreamBubble.activityDiv.querySelectorAll(".activity-step.running");
                for (var r = 0; r < running.length; r++) {
                  running[r].className = "activity-step done";
                  var icon = running[r].querySelector(".activity-icon");
                  if (icon) icon.innerHTML = '<span style="color:var(--success,#16a34a);font-weight:600">\\u2713</span>';
                }
                var hasActivity = canvasStreamBubble.activityDiv.children.length > 0;
                if (!canvasStreamFullText && !hasActivity) {
                  canvasStreamBubble.mdDiv.innerHTML = "<p>Done — canvas updated.</p>";
                }
                if (!hasActivity) {
                  canvasStreamBubble.activityDiv.style.display = "none";
                }
              }
              hideCanvasThinking();
              canvasStreamBubble = null;
              canvasStreamFullText = "";
              canvasWaitingForResponse = false;
              canvasPollInterval = CANVAS_POLL_IDLE;
              if (canvasStatusDot) { canvasStatusDot.className = "dot connected"; }
              if (canvasStatusText) { canvasStatusText.textContent = "Connected"; }
              var sendBtn = document.getElementById("send-btn");
              if (sendBtn) sendBtn.disabled = false;
              debouncedCanvasRefresh();
              debouncedRefreshFiles();
            }
          } else if (evt.event === "message" && evt.data) {
            hideCanvasThinking();
            canvasWaitingForResponse = false;
            canvasPollInterval = CANVAS_POLL_IDLE;
            appendMsg("assistant", evt.data.content || "(empty response)");
          } else if (evt.event === "error" && evt.data) {
            hideCanvasThinking();
            canvasWaitingForResponse = false;
            canvasPollInterval = CANVAS_POLL_IDLE;
            appendMsg("assistant", "Error: " + (evt.data.message || "Unknown error"));
            var sendBtn2 = document.getElementById("send-btn");
            if (sendBtn2) sendBtn2.disabled = false;
          } else if (evt.event === "file-changed") {
            hadFileChange = true;
            var changed = evt.data && evt.data.path ? evt.data.path : "";
            if (changed) changedPaths.push(changed);
            if (changed === canvasCurrentFileName || canvasCurrentFileName === "index.html") {
              debouncedCanvasRefresh();
            }
          }
        }
        if (hadFileChange) debouncedRefreshFiles();
        // B4: Show diffs for changed files
        for (var ci = 0; ci < changedPaths.length; ci++) {
          (function(cpath) {
            fetch("/api/canvas/versions/" + encodeURIComponent(cpath), { credentials: "same-origin" })
              .then(function(r) { return r.json(); })
              .then(function(vdata) {
                var versions = vdata.versions || [];
                if (versions.length === 0) return;
                fetch("/api/canvas/version-content/" + versions[0].id, { credentials: "same-origin" })
                  .then(function(r) { return r.json(); })
                  .then(function(vc) {
                    if (!vc.content) return;
                    fetch("/api/canvas/preview/" + encodeURIComponent(cpath), { credentials: "same-origin" })
                      .then(function(r) { return r.text(); })
                      .then(function(currentContent) {
                        showFileDiff(cpath, vc.content, currentContent);
                      });
                  });
              });
          })(changedPaths[ci]);
        }
        if (canvasStatusDot) { canvasStatusDot.className = "dot connected"; }
        if (canvasStatusText) { canvasStatusText.textContent = canvasWaitingForResponse ? "Working..." : "Connected"; }
      })
      .catch(function() {
        if (canvasStatusDot) { canvasStatusDot.className = "dot"; }
        if (canvasStatusText) { canvasStatusText.textContent = "Reconnecting..."; }
      })
      .finally(function() {
        scheduleNextPoll();
      });
  };

  // Initialize canvas mode on page load
  applyCanvasMode();
})();
`;
}
