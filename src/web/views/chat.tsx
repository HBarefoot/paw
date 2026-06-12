import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout, pawMark } from "./layout.js";

interface ChatPageProps {
	sessionId: string;
	chatLabel?: string;
}

const sendIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const attachIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`;
const micIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const speakerIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
const canvasIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
const refreshIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const trashIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const shareIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
const exportIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
const templateIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
const historyIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const explorerIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z"/></svg>`;
const newFileIconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`;
const newFolderIconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`;

export const ChatPage: FC<ChatPageProps> = ({ sessionId, chatLabel }) => {
	return (
		<Layout title={chatLabel ?? "Chat"} currentPath="/chat">
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
						{raw(`<div class="chat-welcome">
							<div class="app-icon welcome-icon" style="width:56px;height:56px">${pawMark(31)}</div>
							<img class="welcome-logo" data-brand-logo alt="" style="display:none;height:56px;max-width:200px;object-fit:contain;border-radius:10px">
							<div class="welcome-title">Welcome to <span data-brand-name>Paw</span></div>
							<p>Your autonomous agent workspace. Send a message to begin.</p>
						</div>`)}
						<div id="typing" class="msg-wrapper" style="display: none">
							<div class="avatar bot-avatar">
								<img src="/paw-logo.jpg" alt="" data-brand-avatar />
							</div>
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
							`<input type="file" id="file-input" accept="image/*,audio/*,video/*,application/pdf,text/*,.csv,.tsv,.xlsx,.xls,.json,.jsonl,.md,.markdown,.yaml,.yml,.xml,.html,.htm,.log,.toml,.ini,.env,.js,.ts,.jsx,.tsx,.py,.go,.rs,.java,.c,.h,.cpp,.cs,.rb,.php,.sh,.sql" multiple style="display:none" />`,
						)}
						{raw(
							`<button class="attach-btn" id="attach-btn" onclick="document.getElementById('file-input').click()" title="Attach files">${attachIconSvg}</button>`,
						)}
						{raw(
							`<button class="attach-btn voice-btn" id="mic-btn" style="display:none" onclick="window.pawToggleDictation()" title="Dictate (speech to text)">${micIconSvg}</button>`,
						)}
						<textarea
							id="chat-input"
							placeholder="Type a message... (Shift+Enter for new line)"
							autocomplete="off"
							rows={1}
						/>
						{raw(
							`<button class="attach-btn voice-btn" id="speak-btn" style="display:none" onclick="window.pawToggleSpeak()" title="Speak replies aloud">${speakerIconSvg}</button>`,
						)}
						{raw(
							`<button class="send-btn" id="send-btn" onclick="sendMessage()">${sendIconSvg}</button>`,
						)}
					</div>
				</div>
				{raw(`<div class="canvas-panel" id="canvas-panel">
          <div class="canvas-toolbar">
            <button onclick="toggleExplorer()" title="Toggle workspace explorer" id="explorer-toggle-btn">${explorerIconSvg}</button>
            <span class="current-file" id="current-file">Home</span>
            <button onclick="canvasTemplateMenu(this)" title="Templates" id="canvas-template-btn">${templateIconSvg}</button>
            <button onclick="canvasExportMenu(this)" title="Export / Share" id="canvas-export-btn">${exportIconSvg}</button>
            <button onclick="canvasRefresh()" title="Refresh preview">${refreshIconSvg}</button>
            <button onclick="canvasClear()" title="Clear canvas" style="color:var(--error)">${trashIconSvg}</button>
          </div>
          <div class="canvas-body">
            <aside class="canvas-explorer" id="canvas-explorer">
              <div class="explorer-head">
                <span class="explorer-title">Workspace</span>
                <div class="explorer-actions">
                  <button onclick="canvasNewFile('')" title="New file">${newFileIconSvg}</button>
                  <button onclick="canvasNewFolder('')" title="New folder">${newFolderIconSvg}</button>
                  <button onclick="loadExplorer()" title="Refresh">${refreshIconSvg}</button>
                </div>
              </div>
              <div class="explorer-search">
                <input id="explorer-search-input" placeholder="Search files…" autocomplete="off" />
                <label class="explorer-search-toggle" title="Search inside file contents"><input type="checkbox" id="explorer-search-content" /> in files</label>
              </div>
              <div class="explorer-tree" id="explorer-tree"></div>
            </aside>
            <div class="canvas-main">
              <div class="canvas-tabs" id="canvas-tabs"></div>
              <div class="canvas-tab-content" id="canvas-tab-content"></div>
            </div>
          </div>
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

  function isImageFile(file) {
    return (file.type || "").indexOf("image/") === 0;
  }

  function ingestFile(file) {
    if (file.size > MAX_FILE_SIZE) {
      pawModal.alert("File too large", file.name + " exceeds the 5MB size limit.");
      return;
    }
    if (isImageFile(file)) {
      // Images go to the multimodal image path (sent to the model as an image).
      var reader = new FileReader();
      reader.onload = function(e) {
        var dataUrl = e.target.result;
        var base64 = dataUrl.split(",")[1];
        var mimeType = dataUrl.split(":")[1].split(";")[0];
        pendingImages.push({ data: base64, mimeType: mimeType, dataUrl: dataUrl });
        renderPendingAttachments();
      };
      reader.readAsDataURL(file);
    } else {
      // Everything else (PDF, text/code/json, CSV/Excel, audio/video, ...) goes
      // to the files path; the server's parseUploadedFiles extracts text where
      // it can (PDF/text/spreadsheet) or notes the file otherwise.
      var reader = new FileReader();
      reader.onload = function(e) {
        var base64 = btoa(new Uint8Array(e.target.result).reduce(function(data, byte) { return data + String.fromCharCode(byte); }, ""));
        var mimeType = file.type || "application/octet-stream";
        pendingFiles.push({ data: base64, mimeType: mimeType, name: file.name });
        renderPendingAttachments();
      };
      reader.readAsArrayBuffer(file);
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
      if (item.kind === "file") {
        var blob = item.getAsFile();
        if (!blob) continue;
        var named = blob.name
          ? blob
          : new File([blob], "pasted-" + Date.now() + "." + ((item.type.split("/")[1] || "bin").split(";")[0]), { type: item.type });
        ingestFile(named);
        handled = true;
      }
    }
    if (handled) e.preventDefault();
  });

  // ===== Voice: browser STT (dictation) + TTS (speak replies) =====
  // Browser-only (Web Speech API): the mic transcribes to text and the browser
  // speaks replies, so this works regardless of the AI model. NOTE: this is a
  // cooked template literal — no regex literals / no literal backticks (a
  // backtick is built via String.fromCharCode(96)).
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognition = null, recognizing = false, sttBase = "";
  function updateMicUI() {
    var b = document.getElementById("mic-btn");
    if (b) b.classList.toggle("recording", recognizing);
  }
  window.pawToggleDictation = function() {
    if (!SpeechRec) return;
    if (recognizing) { try { recognition.stop(); } catch (e) {} return; }
    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    sttBase = input.value ? input.value + " " : "";
    recognition.onresult = function(e) {
      var finalT = "", interimT = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) finalT += r[0].transcript; else interimT += r[0].transcript;
      }
      if (finalT) sttBase += finalT + " ";
      input.value = sttBase + interimT;
      try { input.dispatchEvent(new Event("input")); } catch (e2) {}
    };
    recognition.onerror = function() { recognizing = false; updateMicUI(); };
    recognition.onend = function() { recognizing = false; updateMicUI(); };
    try { recognition.start(); recognizing = true; updateMicUI(); } catch (e) {}
  };
  function stopDictation() {
    if (recognition && recognizing) { try { recognition.stop(); } catch (e) {} }
    recognizing = false; updateMicUI();
  }

  var speakEnabled = false;
  try { speakEnabled = localStorage.getItem("paw-speak") === "1"; } catch (e) {}
  function stripForSpeech(md) {
    var t = md || "";
    var bt = String.fromCharCode(96);
    var fence = bt + bt + bt;
    // Drop fenced code blocks (don't read code aloud).
    while (t.indexOf(fence) !== -1) {
      var a = t.indexOf(fence);
      var b = t.indexOf(fence, a + 3);
      if (b === -1) { t = t.slice(0, a); break; }
      t = t.slice(0, a) + ". " + t.slice(b + 3);
    }
    t = t.split(bt).join("");
    t = t.split("#").join("");
    t = t.split("*").join("");
    t = t.split("_").join(" ");
    return t.trim();
  }
  window.pawSpeakReply = function(text) {
    if (!speakEnabled || !window.speechSynthesis) return;
    var clean = stripForSpeech(text);
    if (!clean) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(clean);
      u.rate = 1.0;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  };
  window.pawToggleSpeak = function() {
    speakEnabled = !speakEnabled;
    try { localStorage.setItem("paw-speak", speakEnabled ? "1" : "0"); } catch (e) {}
    if (!speakEnabled && window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    var sb = document.getElementById("speak-btn");
    if (sb) sb.classList.toggle("active", speakEnabled);
  };
  // Reveal the voice buttons only where the browser supports them.
  (function() {
    var micBtn = document.getElementById("mic-btn");
    if (micBtn && SpeechRec) micBtn.style.display = "";
    var speakBtn = document.getElementById("speak-btn");
    if (speakBtn && window.speechSynthesis) {
      speakBtn.style.display = "";
      speakBtn.classList.toggle("active", speakEnabled);
    }
  })();

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
      var pf = pendingFiles[j];
      var mt = pf.mimeType || "";
      var rm = '<button class="attachment-remove" style="position:static;width:18px;height:18px;font-size:12px" onclick="removePendingFile(' + j + ')">\\u00d7</button>';
      if (mt.indexOf("video/") === 0) {
        // Inline preview — plays locally; the model still gets a file note.
        html += '<div class="attachment-thumb" style="width:auto;padding:4px" data-file-index="' + j + '">' +
          '<video src="data:' + mt + ';base64,' + pf.data + '" controls style="max-width:180px;max-height:120px;border-radius:6px;display:block"></video>' + rm + '</div>';
      } else if (mt.indexOf("audio/") === 0) {
        html += '<div class="attachment-thumb" style="display:flex;align-items:center;width:auto;padding:4px 6px;gap:4px" data-file-index="' + j + '">' +
          '<audio src="data:' + mt + ';base64,' + pf.data + '" controls style="height:32px"></audio>' + rm + '</div>';
      } else {
        html += '<div class="attachment-thumb" style="display:flex;align-items:center;justify-content:center;width:auto;padding:4px 10px;font-size:12px;gap:4px" data-file-index="' + j + '">' +
          '<span>\\uD83D\\uDCC4</span><span>' + escapeHtml(pf.name) + '</span>' + rm +
          '</div>';
      }
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

        // In canvas mode the message pane is owned by the canvas conversation
        // (loaded via applyCanvasMode → loadMessagesForSession(canvasSessionId)).
        // Don't let the chat-session loader clobber it on initial load.
        if (canvasMode) return;

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
      var bn = window.__brandName || "Paw";
      var bl = window.__brandLogo;
      var icon = bl
        ? '<img class="welcome-logo" src="' + bl + '" alt="" style="height:56px;max-width:200px;object-fit:contain;border-radius:10px">'
        : '<div class="app-icon welcome-icon" style="width:56px;height:56px">${pawMark(31)}</div>';
      w.innerHTML = icon + '<div class="welcome-title">Welcome to ' + bn + '</div><p>Your autonomous agent workspace. Send a message to begin.</p>';
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
    } else if (t && t.classList && t.classList.contains("code-expand")) {
      var cblock = t.closest(".code-block");
      if (!cblock) return;
      var collapsed = cblock.classList.toggle("collapsed");
      if (collapsed) {
        var codeEl = cblock.querySelector("pre code");
        var n = codeEl ? (codeEl.textContent || "").split("\\n").length : 0;
        t.textContent = "Show all " + n + " lines";
      } else {
        t.textContent = "Show less";
      }
    }
  });

  function createStreamingBubble() {
    var wrapper = document.createElement("div");
    wrapper.className = "msg-wrapper";

    var avatar = document.createElement("div");
    avatar.className = "avatar bot-avatar";
    avatar.innerHTML = '<img src="' + (window.__brandLogo || "/paw-logo.jpg") + '" alt="" />';

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
    mdDiv.innerHTML = renderMarkdown(text, true);
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

    // Relay tool activity to the canvas portrait (index.html) so the face
    // reacts in real time as the agent works.
    if (chunk.type === "tool_start" || chunk.type === "tool_end" || chunk.type === "thinking" || chunk.type === "roundtrip_start") notifyPortrait(chunk);

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
        notifyPortraitDone();
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
        // Re-render once with the finalized text (live=false) so a completed
        // code block becomes an interactive "Show all N lines" instead of
        // staying stuck on the streaming "writing…" placeholder when the model
        // never emits a closing fence.
        if (fullText) {
          streamBubble.mdDiv.innerHTML = renderMarkdown(fullText, false);
          if (window.pawSpeakReply) window.pawSpeakReply(fullText);
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
      notifyPortraitDone();
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
      avatar.innerHTML = '<img src="' + (window.__brandLogo || "/paw-logo.jpg") + '" alt="" />';
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

  function renderMarkdown(src, live) {
    var text = src.replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n");

    var codeBlocks = [];
    function makeCodeBlock(code, streaming) {
      var lines = code.split("\\n");
      var lang = lines[0].trim();
      var body = lang ? lines.slice(1).join("\\n") : code;
      if (lang && body.charAt(0) === "\\n") body = body.substring(1);
      if (!lang && body.charAt(0) === "\\n") body = body.substring(1);
      var bodyTrimmed = streaming ? body : body.replace(/\\n$/, "");
      var langLabel = lang ? '<span class="code-lang">' + esc(lang) + '</span>' : '';
      // Collapse large blocks by default (usually full files written to the
      // canvas). An in-progress (streaming, unclosed) fence is ALWAYS collapsed
      // so a long generation never takes over the chat.
      var lineCount = bodyTrimmed.split("\\n").length;
      var isLarge = streaming || lineCount > 16 || bodyTrimmed.length > 1200;
      var headerLeft = langLabel;
      if (streaming) {
        headerLeft += '<span class="code-streaming">writing… ' + lineCount + ' lines</span>';
      } else if (isLarge) {
        headerLeft += '<button class="code-expand" type="button">Show all ' + lineCount + ' lines</button>';
      }
      var copyBtn = '<button class="code-copy" type="button" title="Copy code" aria-label="Copy code">Copy</button>';
      codeBlocks.push(
        '<div class="code-block' + (isLarge ? ' collapsed' : '') + (streaming ? ' streaming' : '') + '">'
        + '<div class="code-header">' + headerLeft + copyBtn + '</div>'
        + '<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(bodyTrimmed) + '</code></pre>'
        + '</div>'
      );
      return "%%CODEBLOCK_" + (codeBlocks.length - 1) + "%%";
    }

    // Extract closed fenced code blocks first to protect them.
    text = text.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(m, code) {
      return makeCodeBlock(code, false);
    });
    // A remaining (leftmost) fence has no closing marker. During a LIVE stream
    // that means the block is still being written ("writing…"). For a finalized
    // render (page reload / DB load / completion re-render) it's just an
    // unclosed fence — render it as a normal interactive collapsible block so it
    // never sticks on the non-interactive streaming placeholder.
    text = text.replace(/\`\`\`([\\s\\S]*)$/, function(m, code) {
      return makeCodeBlock(code, !!live);
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
    // Don't reload the preview while the server is unreachable: the iframe is
    // showing the browser's error page, and reloading it throws a cross-origin
    // "Unsafe attempt to load URL" from that error page. Reconnect handles it.
    if (typeof canvasConsecutiveFailures !== "undefined" && canvasConsecutiveFailures > 0) return;
    if (_canvasRefreshTimer) clearTimeout(_canvasRefreshTimer);
    _canvasRefreshTimer = setTimeout(function() { canvasRefresh(); _canvasRefreshTimer = null; }, 300);
  }

  function debouncedRefreshFiles() {
    if (_canvasFileListTimer) clearTimeout(_canvasFileListTimer);
    _canvasFileListTimer = setTimeout(function() {
      refreshCanvasFiles();
      if (typeof window.loadExplorer === "function") window.loadExplorer();
      _canvasFileListTimer = null;
    }, 300);
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
  // First poll after page load: the event buffer may still hold the previous
  // (already-finished) turn's chunks. Replaying them rebuilds a stale streaming
  // bubble that can stick on "writing…". We skip the finished backlog on poll #1.
  var canvasFirstPoll = true;
  var canvasCurrentFileName = "__home__";
  var canvasThinkingEl = null;
  var attachBtn = document.getElementById("attach-btn");
  var canvasDividerEl = null;

  // Multi-tab state
  // Reserved path for the pinned "Home" tab: the live portrait, served by
  // /api/canvas/preview/__home__ regardless of any index.html the agent writes.
  var CANVAS_HOME_PATH = "__home__";
  var canvasTabs = [];
  var canvasTabIdSeq = 0;

  // Relay a tool_start/tool_end chunk to the canvas portrait (index.html) iframe
  // so the orb face + capability pills react in real time. Sandbox-safe: the
  // iframe is null-origin but can still receive postMessage.
  function notifyPortrait(chunk) {
    try {
      for (var i = 0; i < canvasTabs.length; i++) {
        var t = canvasTabs[i];
        if (t.path !== CANVAS_HOME_PATH || !t.iframeEl || !t.iframeEl.contentWindow) continue;
        // tool_start/end drive pills + feed; thinking/roundtrip_start are
        // keep-alive "work" heartbeats so the face stays working between tools.
        var phase = chunk.type === "tool_start" ? "start"
          : chunk.type === "tool_end" ? "end" : "work";
        t.iframeEl.contentWindow.postMessage({
          type: "paw:tool",
          phase: phase,
          kind: chunk.type,
          toolName: chunk.toolName,
          summary: chunk.toolSummary,
          skillKey: chunk.skillKey,
          agentName: chunk.agentName || null,
          isError: !!chunk.toolIsError,
          toolId: chunk.toolId,
          task: chunk.toolInput && chunk.toolInput.task ? String(chunk.toolInput.task) : "",
        }, "*");
      }
    } catch (e) {}
  }

  // Tell the portrait the turn is over so it can authoritatively reset its
  // pills + face — without this, an unpaired tool_start (sub-agent, abort,
  // error, or skillKey mismatch) leaves a pill stuck "active" forever.
  function notifyPortraitDone() {
    try {
      for (var i = 0; i < canvasTabs.length; i++) {
        var t = canvasTabs[i];
        if (t.path !== CANVAS_HOME_PATH || !t.iframeEl || !t.iframeEl.contentWindow) continue;
        t.iframeEl.contentWindow.postMessage({ type: "paw:tool", phase: "done" }, "*");
      }
    } catch (e) {}
  }

  // Relay ambient "you have something for you" state (unread notifications +
  // pending GitHub approvals) into the portrait so the face/GitHub node reacts
  // even when the agent isn't actively streaming.
  function notifyPortraitAmbient(unread, pendingApprovals) {
    try {
      for (var i = 0; i < canvasTabs.length; i++) {
        var t = canvasTabs[i];
        if (t.path !== CANVAS_HOME_PATH || !t.iframeEl || !t.iframeEl.contentWindow) continue;
        t.iframeEl.contentWindow.postMessage({ type: "paw:ambient", unread: unread, pendingApprovals: pendingApprovals }, "*");
      }
    } catch (e) {}
  }
  // The avatar "speaks" a fresh notification via a soft speech bubble.
  function notifyPortraitSpeak(n) {
    try {
      for (var i = 0; i < canvasTabs.length; i++) {
        var t = canvasTabs[i];
        if (t.path !== CANVAS_HOME_PATH || !t.iframeEl || !t.iframeEl.contentWindow) continue;
        t.iframeEl.contentWindow.postMessage({ type: "paw:notify", id: n.id, title: n.title, level: n.level, url: n.url || "" }, "*");
      }
    } catch (e) {}
  }
  var __lastNotifiedId = null;
  var __ambientFirstPoll = true;
  function pollAmbient() {
    Promise.all([
      fetch("/api/notifications").then(function(r){ return r.json(); }).catch(function(){ return {}; }),
      fetch("/api/github/pending").then(function(r){ return r.json(); }).catch(function(){ return {}; })
    ]).then(function(res){
      var notif = res[0] || {};
      var unread = notif.unread || 0;
      var pending = (res[1] && res[1].pending && res[1].pending.length) || 0;
      notifyPortraitAmbient(unread, pending);
      // Find the newest unread; let the avatar speak it once (skip stale ones on
      // first poll so it doesn't announce everything on page load).
      var list = notif.notifications || [];
      var newest = null;
      for (var i = 0; i < list.length; i++) { if (!list[i].read) { newest = list[i]; break; } }
      if (newest && newest.id !== __lastNotifiedId) {
        __lastNotifiedId = newest.id;
        if (!__ambientFirstPoll) notifyPortraitSpeak(newest);
      }
      __ambientFirstPoll = false;
    }).catch(function(){});
  }
  setInterval(pollAmbient, 20000);
  setTimeout(pollAmbient, 1500);
  // The portrait (sandboxed iframe) asks the parent to open a notification link.
  window.addEventListener("message", function(e){
    var m = e.data;
    if (m && m.type === "paw:notify-open") {
      if (m.url) window.open(m.url, "_blank", "noopener");
      else window.location.href = "/notifications";
    }
  });

  // The pinned Home tab hosts the live Skill Dock companion, served same-origin
  // at /companion so it can fetch /api/ops/feed AND receive notifyPortrait's
  // postMessage relay. Every other tab is real user canvas content behind the
  // null-origin sketch sandbox.
  function canvasTabSrc(path) {
    return path === CANVAS_HOME_PATH
      ? "/companion"
      : "/api/canvas/preview/" + encodeURIComponent(path);
  }

  function createCanvasTab(path, opts) {
    opts = opts || {};
    var id = ++canvasTabIdSeq;
    var iframe = document.createElement("iframe");
    iframe.src = canvasTabSrc(path);
    iframe.className = "hidden";
    iframe.style.background = "#fff";
    // allow-forms lets agent-wired canvas pages submit to /api/forms/:id.
    // We deliberately keep NO allow-same-origin: form posts carry Origin: null
    // + no cookies, which the public form receiver accepts. The Home companion
    // is paw's own trusted UI (same-origin), so it runs without the sandbox.
    if (path !== CANVAS_HOME_PATH) iframe.sandbox = "allow-scripts allow-forms";
    canvasTabContent.appendChild(iframe);
    var tab = { id: id, path: path, iframeEl: iframe, pinned: !!opts.pinned, label: opts.label || null };
    // Pinned tabs (the Home portrait) always sit first.
    if (tab.pinned) canvasTabs.unshift(tab); else canvasTabs.push(tab);
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
        canvasCurrentFile.textContent = canvasTabs[i].label || canvasTabs[i].path;
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
    // Never close the pinned Home tab.
    if (canvasTabs[idx].pinned) return;
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
      // Pinned tabs (Home) are never closable.
      var closeBtn = (!t.pinned && canvasTabs.length > 1)
        ? ' <span class="tab-close" data-tab-id="' + t.id + '">\\u00d7</span>'
        : "";
      var pinClass = t.pinned ? " canvas-tab-pinned" : "";
      html += '<div class="canvas-tab' + active + pinClass + '" data-tab-id="' + t.id + '">'
        + esc(t.label || t.path) + closeBtn + '</div>';
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

  // Initialize the pinned Home tab (the live portrait). Real files (incl. the
  // agent's index.html) open as their own tabs — see the file-changed handler.
  createCanvasTab(CANVAS_HOME_PATH, { pinned: true, label: "Home" });

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

    // Pointer Events + setPointerCapture so the divider keeps receiving
    // move events even when the cursor passes over the canvas preview
    // <iframe> (a plain document mousemove listener stops firing the moment
    // the pointer enters the iframe, which made the divider stick/jump).
    canvasDividerEl.addEventListener("pointerdown", function(e) {
      e.preventDefault();
      canvasDividerEl.setPointerCapture(e.pointerId);
      canvasDividerEl.classList.add("dragging");
      document.body.style.userSelect = "none";
      // Belt-and-braces: disable iframe hit-testing during the drag so it
      // can't swallow the pointer stream even if capture is unavailable.
      var iframes = canvasPanel.querySelectorAll("iframe");
      for (var i = 0; i < iframes.length; i++) iframes[i].style.pointerEvents = "none";

      var container = document.getElementById("chat-with-canvas");
      var containerRect = container.getBoundingClientRect();

      // Keep this in sync with the canvas-panel min-width in layout.tsx
      // so the % we set never collides with the CSS floor (which would
      // make the divider drift away from the cursor near the narrow end).
      var MIN_CANVAS_PX = 320;
      function onMove(e) {
        var x = e.clientX - containerRect.left;
        var canvasPx = containerRect.width - x;
        canvasPx = Math.max(
          MIN_CANVAS_PX,
          Math.min(containerRect.width * 0.8, canvasPx),
        );
        var pct = (canvasPx / containerRect.width) * 100;
        canvasPanel.style.setProperty("--canvas-width", pct + "%");
      }

      function onUp(e) {
        canvasDividerEl.classList.remove("dragging");
        document.body.style.userSelect = "";
        for (var i = 0; i < iframes.length; i++) iframes[i].style.pointerEvents = "";
        try { canvasDividerEl.releasePointerCapture(e.pointerId); } catch (_) {}
        canvasDividerEl.removeEventListener("pointermove", onMove);
        canvasDividerEl.removeEventListener("pointerup", onUp);
        canvasDividerEl.removeEventListener("pointercancel", onUp);
        var current = canvasPanel.style.getPropertyValue("--canvas-width");
        if (current) localStorage.setItem("paw-canvas-width", current);
      }

      canvasDividerEl.addEventListener("pointermove", onMove);
      canvasDividerEl.addEventListener("pointerup", onUp);
      canvasDividerEl.addEventListener("pointercancel", onUp);
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
      // The canvas conversation lives under canvasSessionId (separate from the
      // chat sessionId). Load its persisted messages so a page reload shows the
      // finalized history (correctly-rendered code blocks) instead of relying on
      // the ephemeral event-buffer replay, which can stick on "writing…".
      loadMessagesForSession(canvasSessionId);
      startCanvasPolling();
      refreshCanvasFiles();
      loadExplorer();
    } else {
      canvasPanel.classList.remove("open");
      canvasToggleBtn.classList.remove("active");
      removeDivider();
      stopCanvasPolling();
    }
  }

  // ===== Workspace explorer (folder tree + search + file ops) =====
  var explorerEntries = [];
  var explorerExpanded = (function() {
    try { return new Set(JSON.parse(localStorage.getItem("paw-explorer-expanded") || "[]")); }
    catch (_) { return new Set(); }
  })();
  function saveExplorerExpanded() {
    try { localStorage.setItem("paw-explorer-expanded", JSON.stringify(Array.from(explorerExpanded))); } catch (_) {}
  }
  var FOLDER_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z"/></svg>';
  var FILE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var TWISTY_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';

  window.loadExplorer = function() {
    var tree = document.getElementById("explorer-tree");
    if (!tree) return;
    fetch("/api/canvas/tree", { credentials: "same-origin" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        explorerEntries = (data && data.entries) || [];
        renderExplorer();
      })
      .catch(function() {});
  };

  function buildTree(entries) {
    var root = { name: "", path: "", type: "dir", children: {} };
    for (var i = 0; i < entries.length; i++) {
      var parts = entries[i].path.split("/");
      var node = root;
      var acc = "";
      for (var j = 0; j < parts.length; j++) {
        acc = acc ? acc + "/" + parts[j] : parts[j];
        var isLeaf = j === parts.length - 1;
        if (!node.children[parts[j]]) {
          node.children[parts[j]] = {
            name: parts[j], path: acc,
            type: isLeaf ? entries[i].type : "dir", children: {}
          };
        }
        node = node.children[parts[j]];
      }
    }
    return root;
  }

  function sortedChildren(node) {
    var arr = Object.keys(node.children).map(function(k) { return node.children[k]; });
    arr.sort(function(a, b) {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }

  function renderNode(node, depth, out) {
    var kids = sortedChildren(node);
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      var pad = 6 + depth * 12;
      if (n.type === "dir") {
        var open = explorerExpanded.has(n.path);
        out.push('<div class="tree-row tree-folder" data-path="' + esc(n.path) + '" data-type="dir" draggable="true" style="padding-left:' + pad + 'px">'
          + '<span class="tree-twisty' + (open ? " open" : "") + '">' + TWISTY_SVG + '</span>'
          + '<span class="tree-icon">' + FOLDER_SVG + '</span>'
          + '<span class="tree-name">' + esc(n.name) + '</span></div>');
        if (open) renderNode(n, depth + 1, out);
      } else {
        var active = n.path === canvasCurrentFileName ? " active" : "";
        out.push('<div class="tree-row tree-file' + active + '" data-path="' + esc(n.path) + '" data-type="file" draggable="true" style="padding-left:' + (pad + 12) + 'px">'
          + '<span class="tree-icon">' + FILE_SVG + '</span>'
          + '<span class="tree-name">' + esc(n.name) + '</span></div>');
      }
    }
  }

  function renderExplorer() {
    var tree = document.getElementById("explorer-tree");
    if (!tree) return;
    var searchInput = document.getElementById("explorer-search-input");
    var q = searchInput ? searchInput.value.trim().toLowerCase() : "";
    if (q && document.getElementById("explorer-search-content") && document.getElementById("explorer-search-content").checked) {
      return; // content search renders async via runContentSearch()
    }
    var entries = explorerEntries;
    if (q) entries = entries.filter(function(e) { return e.path.toLowerCase().indexOf(q) !== -1; });
    if (!entries.length) {
      tree.innerHTML = '<div class="tree-empty">' + (q ? "No matches" : "Empty workspace") + '</div>';
      return;
    }
    var rootTree = buildTree(entries);
    // When filtering, auto-expand all so matches are visible.
    if (q) {
      for (var i = 0; i < entries.length; i++) {
        var parts = entries[i].path.split("/"); var acc = "";
        for (var j = 0; j < parts.length - 1; j++) { acc = acc ? acc + "/" + parts[j] : parts[j]; explorerExpanded.add(acc); }
      }
    }
    var out = [];
    renderNode(rootTree, 0, out);
    tree.innerHTML = out.join("");
    bindTreeRows();
  }

  function bindTreeRows() {
    var tree = document.getElementById("explorer-tree");
    if (!tree) return;
    var rows = tree.querySelectorAll(".tree-row");
    for (var i = 0; i < rows.length; i++) {
      (function(row) {
        var path = row.getAttribute("data-path");
        var type = row.getAttribute("data-type");
        row.addEventListener("click", function(e) {
          if (e.target.closest(".tree-twisty") || type === "dir") {
            if (type === "dir") {
              if (explorerExpanded.has(path)) explorerExpanded.delete(path); else explorerExpanded.add(path);
              saveExplorerExpanded(); renderExplorer();
            }
            return;
          }
          findOrCreateTab(path);
          var all = tree.querySelectorAll(".tree-row");
          for (var k = 0; k < all.length; k++) all[k].classList.toggle("active", all[k].getAttribute("data-path") === path);
        });
        row.addEventListener("contextmenu", function(e) { e.preventDefault(); openTreeContextMenu(e, path, type); });
        // Drag to move into a folder
        row.addEventListener("dragstart", function(e) { e.dataTransfer.setData("text/plain", path); e.dataTransfer.effectAllowed = "move"; });
        if (type === "dir") {
          row.addEventListener("dragover", function(e) { e.preventDefault(); row.classList.add("drop-target"); });
          row.addEventListener("dragleave", function() { row.classList.remove("drop-target"); });
          row.addEventListener("drop", function(e) {
            e.preventDefault(); row.classList.remove("drop-target");
            var from = e.dataTransfer.getData("text/plain");
            if (!from || from === path) return;
            var base = from.split("/").pop();
            var to = path + "/" + base;
            if (from === to || to.indexOf(from + "/") === 0) return; // no-op / can't move into self
            canvasMovePath(from, to);
          });
        }
      })(rows[i]);
    }
  }

  function onExplorerSearchInput() {
    var contentChk = document.getElementById("explorer-search-content");
    var input = document.getElementById("explorer-search-input");
    if (contentChk && contentChk.checked && input && input.value.trim()) { runContentSearch(input.value.trim()); }
    else { renderExplorer(); }
  }

  function runContentSearch(q) {
    var tree = document.getElementById("explorer-tree");
    if (!tree) return;
    fetch("/api/canvas/search?content=1&q=" + encodeURIComponent(q), { credentials: "same-origin" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var results = (data && data.results) || [];
        if (!results.length) { tree.innerHTML = '<div class="tree-empty">No matches</div>'; return; }
        var out = [];
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          out.push('<div class="tree-row tree-file tree-search-hit" data-path="' + esc(r.path) + '" data-type="file" style="padding-left:10px">'
            + '<span class="tree-icon">' + FILE_SVG + '</span>'
            + '<span class="tree-name">' + esc(r.path) + (r.line ? ':' + r.line : '') + '</span>'
            + (r.snippet ? '<span class="tree-snippet">' + esc(r.snippet) + '</span>' : '') + '</div>');
        }
        tree.innerHTML = out.join("");
        bindTreeRows();
      })
      .catch(function() {});
  }

  function openTreeContextMenu(e, path, type) {
    var existing = document.getElementById("tree-ctx-menu");
    if (existing) existing.remove();
    var menu = document.createElement("div");
    menu.id = "tree-ctx-menu"; menu.className = "ctx-menu";
    menu.style.top = e.clientY + "px"; menu.style.left = e.clientX + "px";
    var folderBase = type === "dir" ? path : (path.indexOf("/") !== -1 ? path.split("/").slice(0, -1).join("/") : "");
    menu.innerHTML =
        '<div class="ctx-menu-item" data-act="new-file">New file</div>'
      + '<div class="ctx-menu-item" data-act="new-folder">New folder</div>'
      + '<div class="ctx-menu-sep"></div>'
      + '<div class="ctx-menu-item" data-act="rename">Rename</div>'
      + '<div class="ctx-menu-item danger" data-act="delete">Delete</div>';
    document.body.appendChild(menu);
    menu.querySelectorAll(".ctx-menu-item").forEach(function(item) {
      item.addEventListener("click", function() {
        var act = item.getAttribute("data-act"); menu.remove();
        if (act === "new-file") canvasNewFile(folderBase);
        else if (act === "new-folder") canvasNewFolder(folderBase);
        else if (act === "rename") canvasRenamePath(path);
        else if (act === "delete") canvasDeletePath(path, type);
      });
    });
    setTimeout(function() {
      function close(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", close); } }
      document.addEventListener("click", close);
    }, 0);
  }

  window.canvasNewFile = async function(folder) {
    var name = await pawModal.prompt("New file", "File name" + (folder ? " in " + folder : ""), "");
    if (!name) return;
    var path = folder ? folder + "/" + name : name;
    fetch("/api/canvas/new-file", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: path }) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.error) { pawModal.alert("Error", d.error); return; } if (folder) explorerExpanded.add(folder); loadExplorer(); findOrCreateTab(path); });
  };

  window.canvasNewFolder = async function(folder) {
    var name = await pawModal.prompt("New folder", "Folder name" + (folder ? " in " + folder : ""), "");
    if (!name) return;
    var path = folder ? folder + "/" + name : name;
    fetch("/api/canvas/mkdir", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: path }) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.error) { pawModal.alert("Error", d.error); return; } explorerExpanded.add(path); saveExplorerExpanded(); loadExplorer(); });
  };

  window.canvasRenamePath = async function(path) {
    var next = await pawModal.prompt("Rename / move", "New path (use / to move into a folder)", path);
    if (!next || next === path) return;
    canvasMovePath(path, next);
  };

  function canvasMovePath(from, to) {
    fetch("/api/canvas/rename", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: from, to: to }) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.error) { pawModal.alert("Error", d.error); return; } loadExplorer(); refreshCanvasFiles(); });
  }

  window.canvasDeletePath = async function(path, type) {
    var ok = await pawModal.confirm("Delete", "Delete " + (type === "dir" ? "folder" : "file") + " \\"" + path + "\\"" + (type === "dir" ? " and everything in it?" : "?"), { confirmLabel: "Delete", danger: true });
    if (!ok) return;
    fetch("/api/canvas/delete", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: path }) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.error) { pawModal.alert("Error", d.error); return; } loadExplorer(); refreshCanvasFiles(); });
  };

  window.toggleExplorer = function() {
    var ex = document.getElementById("canvas-explorer");
    if (!ex) return;
    ex.classList.toggle("collapsed");
    try { localStorage.setItem("paw-explorer-collapsed", ex.classList.contains("collapsed") ? "1" : "0"); } catch (_) {}
  };

  (function initExplorer() {
    var input = document.getElementById("explorer-search-input");
    if (input) input.addEventListener("input", onExplorerSearchInput);
    var chk = document.getElementById("explorer-search-content");
    if (chk) chk.addEventListener("change", onExplorerSearchInput);
    var ex = document.getElementById("canvas-explorer");
    try { if (ex && localStorage.getItem("paw-explorer-collapsed") === "1") ex.classList.add("collapsed"); } catch (_) {}
  })();

  window.toggleCanvasMode = function() {
    canvasMode = !canvasMode;
    localStorage.setItem("paw-canvas-mode", canvasMode);
    applyCanvasMode();
  };

  var canvasWaitingForResponse = false;
  var canvasPollInterval = 10000; // idle: 10s
  var CANVAS_POLL_FAST = 2000;   // active: 2s (stays under 60 req/min API rate limit)
  var CANVAS_POLL_IDLE = 10000;  // idle: 10s
  var CANVAS_POLL_MAX = 60000;   // backoff ceiling when the server is unreachable
  var canvasPollTimer = null;
  // Consecutive failed polls — drives exponential backoff so a stopped/crashed
  // server doesn't get hammered (and flood the console with ERR_CONNECTION_REFUSED).
  var canvasConsecutiveFailures = 0;

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
            if (window.pawSpeakReply) window.pawSpeakReply(evt.data.content || "");
          } else if (evt.event === "error" && evt.data) {
            hideCanvasThinking();
            canvasWaitingForResponse = false;
            canvasPollInterval = CANVAS_POLL_IDLE;
            appendMsg("assistant", "Error: " + (evt.data.message || "Unknown error"));
          } else if (evt.event === "file-changed") {
            hadFileChange = true;
            var changed = evt.data && evt.data.path ? evt.data.path : "";
            // Only refresh the viewed file when IT changes. The Home portrait
            // must stay stable while the agent works (it reacts live via
            // postMessage); reloading it on every file change wiped those
            // reactions.
            if (changed === canvasCurrentFileName) {
              debouncedCanvasRefresh();
            } else if (changed === "index.html") {
              // Auto-open the agent's main page once so the build "shows up
              // right here" next to the pinned Home tab (only if not already open).
              var alreadyOpen = false;
              for (var k = 0; k < canvasTabs.length; k++) {
                if (canvasTabs[k].path === "index.html") { alreadyOpen = true; break; }
              }
              if (!alreadyOpen) createCanvasTab("index.html");
            }
          }
        }
        if (hadFileChange) debouncedRefreshFiles();
        // Recovered: reset backoff, restore normal cadence, and reload the
        // preview once (it may be stuck on the browser's error page).
        if (canvasConsecutiveFailures > 0) {
          canvasConsecutiveFailures = 0;
          canvasPollInterval = canvasWaitingForResponse ? CANVAS_POLL_FAST : CANVAS_POLL_IDLE;
          debouncedCanvasRefresh();
        }
        if (canvasStatusDot) { canvasStatusDot.className = "dot connected"; }
        if (canvasStatusText) { canvasStatusText.textContent = canvasWaitingForResponse ? "Working..." : "Connected"; }
      })
      .catch(function() {
        // Server unreachable (down/restarting): back off exponentially up to
        // CANVAS_POLL_MAX instead of retrying every 2-10s forever.
        canvasConsecutiveFailures++;
        canvasPollInterval = Math.min(CANVAS_POLL_MAX, 2000 * Math.pow(2, canvasConsecutiveFailures));
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
    // The index.html portrait is a LIVE/dynamic view (reacts to agent activity
    // via postMessage) — reloading it just wipes its reactions/feed and
    // re-renders the same capabilities. Skip it so the refresh button doesn't
    // reset the live face. (Counts refresh when the canvas is reopened.)
    if (canvasCurrentFileName === CANVAS_HOME_PATH) return;
    // Refresh the active tab's iframe with a cache-busting query so the
    // preview re-fetches. We intentionally avoid the old "about:blank then
    // restore src" round-trip: in Safari, navigating a sandboxed (null-origin)
    // iframe through about:blank throws "Unsafe attempt to load URL ... Domains,
    // protocols and ports must match." A direct src reassignment with a unique
    // query is a clean parent-initiated navigation. The preview route ignores
    // the query string (it resolves files by path).
    for (var i = 0; i < canvasTabs.length; i++) {
      if (canvasTabs[i].path === canvasCurrentFileName) {
        var iframe = canvasTabs[i].iframeEl;
        var base = canvasTabSrc(canvasTabs[i].path);
        iframe.src = base + "?_r=" + Date.now();
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
        createCanvasTab(CANVAS_HOME_PATH, { pinned: true, label: "Home" });
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
      + "top:" + (rect.bottom + 4) + "px;right:" + (window.innerWidth - rect.right) + "px;";

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
        // DOM body (not an HTML string) so the bold filename renders and
        // stays XSS-safe under pawModal's string-escaping.
        var wrap = document.createElement("div");
        wrap.appendChild(document.createTextNode("Source code for "));
        var strong = document.createElement("strong");
        strong.textContent = canvasCurrentFileName;
        wrap.appendChild(strong);
        wrap.appendChild(document.createTextNode(" copied to clipboard."));
        pawModal.alert("Copied", wrap);
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
        // Build the body as DOM nodes — pawModal escapes string bodies for
        // XSS safety, so an HTML string would render as literal text. A Node
        // is appended as-is and keeps the input both safe and interactive.
        var wrap = document.createElement("div");
        var label = document.createElement("div");
        label.textContent = "Share this link (valid for 24 hours):";
        var input = document.createElement("input");
        input.type = "text";
        input.value = url;
        input.readOnly = true;
        input.style.width = "100%";
        input.style.marginTop = "8px";
        input.onclick = function() { this.select(); };
        wrap.appendChild(label);
        wrap.appendChild(input);
        pawModal.alert("Canvas Shared", wrap);
      })
      .catch(function(err) {
        pawModal.alert("Share Error", "Failed to share: " + err.message);
      });
  }

  // Override sendMessage when canvas mode is on
  var _origSendMessage = window.sendMessage;
  window.sendMessage = function() {
    stopDictation();
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
          + "top:" + (rect.bottom + 4) + "px;right:" + (window.innerWidth - rect.right) + "px;";

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
      // Keep the pinned Home portrait, then show the template's index.html.
      createCanvasTab(CANVAS_HOME_PATH, { pinned: true, label: "Home" });
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
        if (canvasFirstPoll) {
          canvasFirstPoll = false;
          // Drop everything up to and including the last done event, so a turn
          // that already finished before this page load is NOT replayed into a
          // stale streaming bubble (its finalized form loads from the DB instead).
          // Anything after the last done is a genuinely in-progress turn and
          // still replays so the live stream resumes.
          var lastDoneIdx = -1;
          for (var di = 0; di < events.length; di++) {
            var de = events[di];
            if (de.event === "chunk" && de.data && de.data.type === "done") lastDoneIdx = di;
          }
          if (lastDoneIdx >= 0) {
            canvasLastEventId = events[lastDoneIdx].id;
            events = events.slice(lastDoneIdx + 1);
          }
        }
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
                // Re-render with the finalized text (live=false) so a completed
                // code block becomes an interactive "Show all N lines" instead
                // of staying stuck on the streaming "writing…" placeholder.
                if (canvasStreamFullText) {
                  canvasStreamBubble.mdDiv.innerHTML = renderMarkdown(canvasStreamFullText, false);
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
              notifyPortraitDone(); // authoritative portrait reset (canvas turn ended)
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
            if (window.pawSpeakReply) window.pawSpeakReply(evt.data.content || "");
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
            // Only refresh the viewed file when IT changes. The Home portrait
            // must stay stable while the agent works (it reacts live via
            // postMessage); reloading it on every file change wiped those
            // reactions.
            if (changed === canvasCurrentFileName) {
              debouncedCanvasRefresh();
            } else if (changed === "index.html") {
              // Auto-open the agent's main page once so the build "shows up
              // right here" next to the pinned Home tab (only if not already open).
              var alreadyOpen = false;
              for (var k = 0; k < canvasTabs.length; k++) {
                if (canvasTabs[k].path === "index.html") { alreadyOpen = true; break; }
              }
              if (!alreadyOpen) createCanvasTab("index.html");
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
