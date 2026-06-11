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

/**
 * Inject the error overlay + form/anchor runtime shim into a served HTML
 * document, before `</body>` when present (otherwise appended).
 */
export function injectCanvasRuntime(html: string): string {
	const inject = ERROR_OVERLAY + CANVAS_RUNTIME;
	if (html.includes("</body>")) {
		return html.replace("</body>", `${inject}</body>`);
	}
	return html + inject;
}
