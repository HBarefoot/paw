// Shared canvas static-serving primitives, used by BOTH the public
// `/api/canvas/preview/*` sketch surface and the authed `/api/app/:space/*`
// application surface. Keep these in one place so the two routes can't drift.

/** Extension → Content-Type for files served out of the canvas workspace. */
export const CANVAS_MIME_MAP: Record<string, string> = {
	".html": "text/html",
	".htm": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
};

/** Resolve a file extension (e.g. ".html") to a MIME type, octet-stream fallback. */
export function canvasContentType(ext: string): string {
	return CANVAS_MIME_MAP[ext.toLowerCase()] || "application/octet-stream";
}

// ⚠️ The two strings below are BROWSER JS embedded in a template literal — the
// recurring "inline-script-template-trap": backslashes are cooked once here
// before the browser sees them, so `\\n` here becomes a literal `\n` escape in
// the served script. Do not "simplify" the doubled backslashes, and avoid
// adding regex literals that contain backslashes. Guarded by
// tests/web/canvas-serve.test.ts (cook + run against a DOM stub).

const ERROR_OVERLAY = `<script>(function(){var d=document,o=null;function show(msg){if(o)o.remove();o=d.createElement("div");o.style.cssText="position:fixed;bottom:0;left:0;right:0;background:#fef2f2;border-top:2px solid #ef4444;color:#991b1b;font:13px/1.5 ui-monospace,monospace;padding:12px 16px;z-index:99999;max-height:40vh;overflow:auto";o.innerHTML='<div style="display:flex;justify-content:space-between;align-items:start"><pre style="margin:0;white-space:pre-wrap">'+msg.replace(/</g,"&lt;")+'</pre><button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:#991b1b;padding:0 4px">&times;</button></div>';d.body.appendChild(o)}window.onerror=function(m,f,l,c){show(m+"\\n  at "+(f||"?")+":"+(l||"?"));};window.onunhandledrejection=function(e){show("Unhandled rejection: "+(e.reason&&e.reason.message||e.reason||e))};})();</script>`;

// Anchor smooth-scroll + form→fetch shim. The canvas/app pages render with
// native form submits and in-page anchors disabled (preview is a null-origin
// sandbox; app pages keep a tight CSP), so this rewires them without a real
// navigation. Forms posting to /api/forms/* submit via fetch and toast the
// result.
const CANVAS_RUNTIME = `<script>(function(){document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a)return;e.preventDefault();var id=a.getAttribute("href").slice(1);if(!id){window.scrollTo({top:0,behavior:"smooth"});return;}var el=document.getElementById(id)||document.querySelector('[name="'+id+'"]');if(el)el.scrollIntoView({behavior:"smooth"});},true);document.addEventListener("submit",function(e){var f=e.target;if(!f||f.tagName!=="FORM")return;var action=f.getAttribute("action")||"";if(action.indexOf("/api/forms/")!==0)return;e.preventDefault();var body={};new FormData(f).forEach(function(v,k){body[k]=v;});var btn=f.querySelector('button,[type=submit]');if(btn)btn.disabled=true;fetch(action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return{ok:r.ok};});}).then(function(d){var ok=d&&d.ok;var m=document.createElement("div");m.textContent=ok?"\\u2713 Thanks! Your submission was received.":"Submission failed. Please try again.";m.style.cssText="margin-top:12px;padding:10px 14px;border-radius:8px;font:14px/1.4 system-ui,sans-serif;background:"+(ok?"#ecfdf5;color:#065f46":"#fef2f2;color:#991b1b");f.appendChild(m);if(ok)f.reset();if(btn)btn.disabled=false;}).catch(function(){if(btn)btn.disabled=false;});},true);})();</script>`;

// Opt-in data-file refresh poller for APP SPACE pages. A page opts in with
//   <meta name="paw-refresh" content="reload">   (full reload on change), or
//   <meta name="paw-refresh" content="event">    (dispatch paw:files-changed).
// It polls the existing /api/canvas/events file-changed stream and reacts only
// to changes under its OWN app space (apps/<space>/). It self-gates to
// /api/app/ pages: the preview iframe is null-origin sandboxed and CANNOT
// reload itself ("Unsafe attempt to load URL"), so the poller stays inert
// there. NOTE: backslash literals are unavailable in this cooked template —
// use String.fromCharCode(92) to normalize Windows watcher paths.
const REFRESH_POLLER = `<script>(function(){if(location.pathname.indexOf("/api/app/")!==0)return;var meta=document.querySelector('meta[name="paw-refresh"]');if(!meta)return;var mode=(meta.getAttribute("content")||"").trim().toLowerCase()||"event";var parts=location.pathname.split("/").filter(Boolean);var space=parts.length>=3?parts[2]:"";var prefix=space?("apps/"+space+"/"):"";var bs=String.fromCharCode(92);var since=0,started=false;function tick(){fetch("/api/canvas/events?sessionId=__files__&since="+since,{headers:{Accept:"application/json"}}).then(function(r){return r.json();}).then(function(d){var evs=(d&&d.events)||[];var changed=[];for(var i=0;i<evs.length;i++){var e=evs[i];if(e.id>since)since=e.id;if(e.event!=="file-changed")continue;var p=((e.data&&e.data.path)||"").split(bs).join("/");if(!prefix||p.indexOf(prefix)===0)changed.push(p);}if(started&&changed.length){if(mode==="reload"){location.reload();return;}try{window.dispatchEvent(new CustomEvent("paw:files-changed",{detail:{paths:changed}}));}catch(e2){}}started=true;}).catch(function(){}).then(function(){setTimeout(tick,2000);});}tick();})();</script>`;

/** Sentinel that marks an already-injected launcher, used to keep injection
 *  idempotent: a document that already carries the launcher (e.g. touched by
 *  both injectCanvasRuntime and injectCompanionLauncher) is never given a
 *  second one. */
export const COMPANION_LAUNCHER_MARKER = 'id="paw-cmp-launcher"';

// Floating companion launcher, injected ONLY for authenticated admins viewing a
// served canvas page (the caller decides via the `companion` flag / the standalone
// injectCompanionLauncher below). It is fully self-contained and carries NO
// secrets: just static markup + the same-origin "/companion" URL, which itself
// resolves the visitor's session server-side. Everything is scoped under the
// `paw-cmp-*` ids so it can't clobber the page's own styles/scripts.
//
// SINGLE ENTRY POINT PER TOP-LEVEL PAGE: the launcher markup is HIDDEN by
// default (`#paw-cmp-launcher{display:none}`) and the script only REVEALS it when
// the page is genuinely top-level (window.top === window.self). When the page is
// embedded — the console canvas pane, the /canvas/share wrapper's inner preview
// iframe, a null-origin sandbox — the script returns early and the launcher stays
// display:none, so an embedded copy can NEVER paint a second (dead) ✦ button next
// to the real top-level one. (Previously the self-gate only skipped the JS wiring
// but left the fixed-position button visible — the duplication this fixes.)
// CSP-safe: every canvas CSP variant allows inline script/style + a same-origin
// frame ("/companion").
const COMPANION_LAUNCHER = `<style>
#paw-cmp-launcher,#paw-cmp-panel{position:fixed;right:20px;z-index:2147483000;}
#paw-cmp-launcher{bottom:20px;display:none;}
#paw-cmp-launcher.paw-cmp-top{display:block;}
#paw-cmp-btn{width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;background:#7458f5;color:#fff;font-size:22px;line-height:1;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;}
#paw-cmp-btn:hover{filter:brightness(1.08);}
#paw-cmp-panel{bottom:84px;width:380px;height:560px;max-width:calc(100vw - 40px);max-height:calc(100vh - 110px);border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.35);background:#fff;display:none;}
#paw-cmp-panel.paw-open{display:block;}
#paw-cmp-frame{width:100%;height:100%;border:none;}
</style>
<div id="paw-cmp-launcher"><button id="paw-cmp-btn" type="button" aria-label="Open assistant" title="Assistant">✦</button></div>
<div id="paw-cmp-panel" aria-hidden="true"><iframe id="paw-cmp-frame" title="Assistant" loading="lazy"></iframe></div>
<script>(function(){try{if(window.top!==window.self)return;}catch(e){return;}var l=document.getElementById("paw-cmp-launcher"),b=document.getElementById("paw-cmp-btn"),p=document.getElementById("paw-cmp-panel"),f=document.getElementById("paw-cmp-frame");if(!l||!b||!p||!f)return;l.classList.add("paw-cmp-top");var loaded=false;b.addEventListener("click",function(){var open=p.classList.toggle("paw-open");p.setAttribute("aria-hidden",open?"false":"true");if(open&&!loaded){f.src="/companion";loaded=true;}});})();</script>`;

/**
 * Inject the error overlay + form/anchor runtime shim + opt-in app-space
 * refresh poller into a served HTML document, before `</body>` when present
 * (otherwise appended). Pass `{ companion: true }` to also inject the companion
 * launcher (authenticated admins only — the caller resolves the session). The
 * one-arg signature is unchanged, so existing/legacy callers inject no companion.
 */
export function injectCanvasRuntime(
	html: string,
	opts?: { companion?: boolean },
): string {
	let inject = ERROR_OVERLAY + CANVAS_RUNTIME + REFRESH_POLLER;
	// Idempotent: only add the launcher if the document doesn't already carry one
	// (so a page touched by both this and injectCompanionLauncher gets exactly one).
	if (opts?.companion && !html.includes(COMPANION_LAUNCHER_MARKER)) {
		inject += COMPANION_LAUNCHER;
	}
	if (html.includes("</body>")) {
		return html.replace("</body>", `${inject}</body>`);
	}
	return html + inject;
}

/**
 * Decide whether a served canvas page should carry the companion launcher: only
 * for an authenticated admin. `admin` is the value the auth middleware sets on
 * authed routes (truthy when present); on PUBLIC canvas routes the middleware
 * skips session validation, so the caller passes the raw `paw_session` cookie
 * and a `validateSession` probe for the fallback check. Anonymous → false.
 */
export function shouldServeCompanion(input: {
	admin?: unknown;
	sessionToken?: string | null;
	validateSession: (token: string) => unknown;
}): boolean {
	if (input.admin) return true;
	const token = input.sessionToken;
	if (!token) return false;
	return input.validateSession(token) != null;
}

/**
 * Inject ONLY the companion launcher (no canvas runtime) — for pages that serve
 * their own HTML without injectCanvasRuntime, e.g. the `/canvas/share` wrapper.
 * Same before-`</body>` placement. Caller gates on an authenticated admin.
 */
export function injectCompanionLauncher(html: string): string {
	// Idempotent: never add a second launcher to a document that already has one.
	if (html.includes(COMPANION_LAUNCHER_MARKER)) return html;
	if (html.includes("</body>")) {
		return html.replace("</body>", `${COMPANION_LAUNCHER}</body>`);
	}
	return html + COMPANION_LAUNCHER;
}
