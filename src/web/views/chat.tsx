import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";

interface ChatPageProps {
  sessionId: string;
}

const sendIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

export const ChatPage: FC<ChatPageProps> = ({ sessionId }) => {
  return (
    <Layout title="Chat" currentPath="/chat">
      <div style="margin-bottom:8px">
        <select id="session-selector" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;min-width:250px">
          <option value="">New conversation</option>
        </select>
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
        <div class="chat-input">
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
  var sessionId = document.getElementById("chat-container").dataset.sessionId;
  var messagesDiv = document.getElementById("messages");
  var input = document.getElementById("chat-input");
  var typingDiv = document.getElementById("typing");
  var selector = document.getElementById("session-selector");

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
      clearMessages();
      return;
    }
    fetch("/api/sessions/" + val + "/messages")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        sessionId = val;
        document.getElementById("chat-container").dataset.sessionId = val;
        clearMessages();
        var welcome = messagesDiv.querySelector(".chat-welcome");
        if (welcome) welcome.remove();
        (data.messages || []).forEach(function(m) {
          appendMsg(m.role === "user" ? "user" : "assistant", m.content);
        });
      });
  });

  loadSessions();

  // If page loaded with a session ID that matches an existing one, load its messages
  if (sessionId && !sessionId.startsWith("web-")) {
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
    if (!text) return;
    input.value = "";

    // Remove welcome state if present
    var welcome = messagesDiv.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    appendMsg("user", text);
    var sendBtn = document.getElementById("send-btn");
    sendBtn.disabled = true;

    // Show typing indicator
    typingDiv.style.display = "flex";
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId, message: text }),
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      appendMsg("assistant", data.response || data.error || "No response");
    })
    .catch(function(err) {
      appendMsg("assistant", "Error: " + err.message);
    })
    .finally(function() {
      sendBtn.disabled = false;
      typingDiv.style.display = "none";
    });
  };

  function appendMsg(role, text) {
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
