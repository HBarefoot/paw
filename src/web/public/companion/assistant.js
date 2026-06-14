// Page-scoped Assistant console (served at /canvas/assistant, framed in the
// canvas admin toolbar's panel). A REAL promptable chat surface: a composer that
// POSTs to /api/canvas/stream and renders the streamed agent reply. It passes the
// host page (from ?path=) as `pagePath` context so the agent edits the right page.
//
// This is a real .js module (NOT a cooked template literal), so normal JS —
// regex, escapes — is fine here.
(() => {
	const cfg = window.__ASSISTANT_CONFIG || {};
	const root = document.getElementById("assistant-root");
	if (!root) return;

	if (cfg.accent) {
		document.documentElement.style.setProperty("--pa", String(cfg.accent));
	}

	// The host page the admin is viewing (URL pathname), forwarded as context.
	const pagePath =
		new URLSearchParams(window.location.search).get("path") || "";
	// One session per console mount, reused across turns.
	const sessionId = `canvas-assistant-${
		(crypto.randomUUID && crypto.randomUUID()) ||
		String(Date.now()) + Math.floor(Math.random() * 1e6)
	}`;

	root.innerHTML =
		'<header id="pa-head"><span id="pa-title">Assistant</span>' +
		'<span id="pa-ctx"></span></header>' +
		'<div id="pa-msgs" role="log" aria-live="polite"></div>' +
		'<form id="pa-form"><textarea id="pa-input" rows="1" ' +
		'placeholder="Ask the assistant to change this page…" ' +
		'aria-label="Message"></textarea>' +
		'<button id="pa-send" type="submit" aria-label="Send">Send</button></form>';

	const msgs = root.querySelector("#pa-msgs");
	const form = root.querySelector("#pa-form");
	const input = root.querySelector("#pa-input");
	const sendBtn = root.querySelector("#pa-send");
	const ctx = root.querySelector("#pa-ctx");
	if (pagePath) {
		ctx.textContent = pagePath.split("/").pop() || pagePath;
		ctx.title = `Editing ${pagePath}`;
	}

	function bubble(role) {
		const el = document.createElement("div");
		el.className = `pa-msg pa-${role}`;
		msgs.appendChild(el);
		msgs.scrollTop = msgs.scrollHeight;
		return el;
	}

	function activity(parent, text) {
		let strip = parent.querySelector(".pa-activity");
		if (!strip) {
			strip = document.createElement("div");
			strip.className = "pa-activity";
			parent.appendChild(strip);
		}
		strip.textContent = text;
	}

	let busy = false;

	async function send(message) {
		if (busy || !message.trim()) return;
		busy = true;
		sendBtn.disabled = true;
		bubble("user").textContent = message;
		const reply = bubble("assistant");
		let full = "";

		try {
			const res = await fetch("/api/canvas/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId, message, pagePath }),
			});
			if (!res.ok || !res.body) {
				let detail = `Request failed (${res.status})`;
				try {
					const d = await res.json();
					if (d && d.error) detail = d.error;
				} catch {}
				reply.classList.add("pa-error");
				reply.textContent = detail;
				return;
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					let chunk;
					try {
						chunk = JSON.parse(line.slice(6));
					} catch {
						continue;
					}
					if (chunk.type === "text_delta" && chunk.text) {
						full += chunk.text;
						reply.textContent = full;
					} else if (chunk.type === "tool_start" && chunk.toolName) {
						activity(reply, `· ${chunk.toolName}…`);
					} else if (chunk.type === "tool_end") {
						activity(reply, "· working…");
					} else if (chunk.type === "error") {
						reply.classList.add("pa-error");
						reply.textContent = full || chunk.error || "Error";
					}
				}
				msgs.scrollTop = msgs.scrollHeight;
			}
			const strip = reply.querySelector(".pa-activity");
			if (strip) strip.remove();
			if (!full && !reply.classList.contains("pa-error")) {
				reply.textContent = "(done)";
			}
		} catch (err) {
			reply.classList.add("pa-error");
			reply.textContent = err && err.message ? err.message : String(err);
		} finally {
			busy = false;
			sendBtn.disabled = false;
			input.focus();
		}
	}

	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const v = input.value;
		input.value = "";
		send(v);
	});
	// Enter sends; Shift+Enter newlines.
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			form.requestSubmit();
		}
	});
})();
