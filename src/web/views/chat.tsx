import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";

interface ChatPageProps {
  sessionId: string;
}

const sendIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const attachIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`;

export const ChatPage: FC<ChatPageProps> = ({ sessionId }) => {
  return (
    <Layout title="Chat" currentPath="/chat">
      <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center">
        <select id="session-selector" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;min-width:250px">
          <option value="">New conversation</option>
        </select>
        {raw(`<button id="new-chat-btn" onclick="newChat()" style="padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--accent);color:#fff;font-size:13px;cursor:pointer;white-space:nowrap">New Chat</button>`)}
      </div>
      <div class="card chat-container" id="chat-container" data-session-id={sessionId}>
        <div class="chat-messages" id="messages">
          <div class="chat-welcome">
            <div class="welcome-icon">💬</div>
            <p>Send a message to start chatting with Paw</p>
          </div>
          <div id="typing" class="msg-wrapper" style="display: none">
            <div class="avatar bot-avatar">P</div>
            <div class="typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
        {raw(`<div class="chat-attachments" id="chat-attachments" style="display:none"></div>`)}
        <div class="chat-input">
          {raw(`<input type="file" id="file-input" accept="image/*" multiple style="display:none" />`)}
          {raw(`<button class="attach-btn" id="attach-btn" onclick="document.getElementById('file-input').click()" title="Attach images">${attachIconSvg}</button>`)}
          <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off" />
          {raw(`<button class="send-btn" id="send-btn" onclick="sendMessage()">${sendIconSvg}</button>`)}
        </div>
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
  var fileInput = document.getElementById("file-input");
  var attachmentsDiv = document.getElementById("chat-attachments");
  var pendingImages = [];

  fileInput.addEventListener("change", function() {
    var files = fileInput.files;
    for (var i = 0; i < files.length; i++) {
      (function(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
          var dataUrl = e.target.result;
          var base64 = dataUrl.split(",")[1];
          var mimeType = dataUrl.split(":")[1].split(";")[0];
          pendingImages.push({ data: base64, mimeType: mimeType, dataUrl: dataUrl });
          renderPendingImages();
        };
        reader.readAsDataURL(file);
      })(files[i]);
    }
    fileInput.value = "";
  });

  function renderPendingImages() {
    if (pendingImages.length === 0) {
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
    attachmentsDiv.innerHTML = html;
  }

  window.removePendingImage = function(index) {
    pendingImages.splice(index, 1);
    renderPendingImages();
  };

  // Load session list
  function loadSessions() {
    fetch("/api/sessions?limit=20")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var opts = '<option value="">New conversation</option>';
        (data.sessions || []).forEach(function(s) {
          var label = s.title || s.id.slice(0, 24);
          var selected = s.id === sessionId ? " selected" : "";
          opts += '<option value="' + s.id + '"' + selected + '>' + escapeHtml(label) + '</option>';
        });
        selector.innerHTML = opts;
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
    fetch("/api/sessions/" + val + "/messages")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        sessionId = val;
        document.getElementById("chat-container").dataset.sessionId = val;
        localStorage.setItem(STORAGE_KEY, val);
        clearMessages();
        var welcome = messagesDiv.querySelector(".chat-welcome");
        if (welcome) welcome.remove();
        (data.messages || []).forEach(function(m) {
          appendMsg(m.role === "user" ? "user" : "assistant", m.content);
        });
      });
  });

  loadSessions();

  // If page loaded with a saved session, load its messages
  if (savedSession) {
    fetch("/api/sessions/" + sessionId + "/messages")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.messages && data.messages.length > 0) {
          var welcome = messagesDiv.querySelector(".chat-welcome");
          if (welcome) welcome.remove();
          data.messages.forEach(function(m) {
            appendMsg(m.role === "user" ? "user" : "assistant", m.content);
          });
        }
      });
  }

  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  window.sendMessage = function sendMessage() {
    var text = input.value.trim();
    if (!text && pendingImages.length === 0) return;
    if (!text) text = "(image)";
    input.value = "";

    // Capture pending images for this message
    var imagesToSend = pendingImages.slice();
    var userImageUrls = imagesToSend.map(function(img) { return img.dataUrl; });
    pendingImages = [];
    renderPendingImages();

    // Remove welcome state if present
    var welcome = messagesDiv.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    appendMsg("user", text, userImageUrls);
    var sendBtn = document.getElementById("send-btn");
    sendBtn.disabled = true;

    // Show typing indicator
    typingDiv.style.display = "flex";
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    var payload = { sessionId: sessionId, message: text };
    if (imagesToSend.length > 0) {
      payload.images = imagesToSend.map(function(img) { return { data: img.data, mimeType: img.mimeType }; });
    }

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      appendMsg("assistant", data.response || data.error || "No response", data.images);
      localStorage.setItem(STORAGE_KEY, sessionId);
      loadSessions();
    })
    .catch(function(err) {
      appendMsg("assistant", "Error: " + err.message);
    })
    .finally(function() {
      sendBtn.disabled = false;
      typingDiv.style.display = "none";
    });
  };

  window.newChat = function newChat() {
    sessionId = "web-" + Date.now();
    document.getElementById("chat-container").dataset.sessionId = sessionId;
    localStorage.removeItem(STORAGE_KEY);
    selector.value = "";
    clearMessages();
    input.focus();
  };

  function appendMsg(role, text, images) {
    var wrapper = document.createElement("div");
    wrapper.className = "msg-wrapper" + (role === "user" ? " user-msg" : "");

    var avatar = document.createElement("div");
    avatar.className = "avatar " + (role === "user" ? "user-avatar" : "bot-avatar");
    avatar.textContent = role === "user" ? "U" : "P";

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

    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    messagesDiv.insertBefore(wrapper, typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
      codeBlocks.push('<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(body.replace(/\\n$/, "")) + '</code></pre>');
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

    // Bold + italic
    s = s.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, "<strong><em>$1</em></strong>");
    // Bold
    s = s.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>");
    // Italic
    s = s.replace(/\\*(.+?)\\*/g, "<em>$1</em>");
    // Strikethrough
    s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
    // Links
    s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Restore inline code
    s = s.replace(/%%INLINE_(\\d+)%%/g, function(m, idx) {
      return codes[parseInt(idx)];
    });

    return s;
  }
})();
`;
}
