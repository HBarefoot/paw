/**
 * PostHog web-analytics snippet for PUBLISHED pages (PR feat/posthog-instrument).
 *
 * Pure, dependency-free string builders — no secrets. Only the PUBLIC project key
 * is ever embedded; the private personal API key (read API) lives in the vault and
 * MUST NOT appear here.
 *
 * Privacy-friendly defaults: cookieless (`persistence: 'memory'`), pageviews only
 * (`autocapture: false`), `person_profiles: 'identified_only'`. So published pages
 * stay clean and need no consent banner by default (no PII, no cookies). The
 * `defaults: '2026-01-30'` flag injects the loader into <head> and turns pageview
 * capture into history-aware SPA tracking — see posthog.com/docs/libraries/js.
 */

/** Marker comment used to dedup the snippet if a page is processed twice. */
export const POSTHOG_MARKER = "<!-- paw-posthog -->";

export interface PostHogSnippetOptions {
	/** PUBLIC PostHog project key (safe to embed in client HTML). */
	projectApiKey: string;
	/** Ingestion/app host, e.g. https://us.i.posthog.com */
	host: string;
}

/** The verified posthog-js CDN loader + init, as a single <script> block. */
export function buildPostHogSnippet(opts: PostHogSnippetOptions): string {
	// JSON.stringify keeps the embedded values safely quoted/escaped.
	const key = JSON.stringify(opts.projectApiKey);
	const host = JSON.stringify(opts.host);
	// Standard PostHog array.js loader (verbatim from the docs), then init with
	// privacy-friendly, cookieless options.
	return `${POSTHOG_MARKER}
<script>
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  posthog.init(${key},{api_host:${host},defaults:'2026-01-30',person_profiles:'identified_only',autocapture:false,capture_pageview:true,capture_pageleave:true,persistence:'memory'})
</script>`;
}

/**
 * Splice the PostHog snippet into the page's <head> (idempotent). Returns the
 * HTML unchanged when the marker is already present, or when no projectApiKey is
 * configured. Falls back to prepending the snippet when there is no <head>.
 */
export function injectPostHogSnippet(
	html: string,
	opts: PostHogSnippetOptions,
): string {
	if (!opts.projectApiKey) return html;
	if (html.includes(POSTHOG_MARKER)) return html;
	const snippet = buildPostHogSnippet(opts);
	// Insert right after the opening <head ...> tag so it loads early.
	const headOpen = html.match(/<head[^>]*>/i);
	if (headOpen?.index !== undefined) {
		const at = headOpen.index + headOpen[0].length;
		return `${html.slice(0, at)}\n${snippet}${html.slice(at)}`;
	}
	// No <head> — prepend so analytics still load on this (non-standard) page.
	return `${snippet}\n${html}`;
}
