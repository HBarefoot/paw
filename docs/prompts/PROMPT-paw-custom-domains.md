# Prompt: Paw master — custom domains for canvas apps (DESIGN-FIRST, infra-aware)

You're in the **paw** repo (`~/repos-and-projects/paw`). **Follow `docs/prompts/_CONVENTIONS.md`**.
Task detail only below.

**Goal:** map a custom domain (e.g. `app.clientsite.com`) to a specific canvas app-space and serve it
at the domain root, instead of `/canvas/share/<token>`. Branch: `feat/custom-domains`.

## Honest boundary — read first
**TLS certs and edge termination are platform/infra, not app code.** On Railway that's their
custom-domain feature; alternatively Cloudflare/Caddy in front. **paw owns:** the domain→app-space
**mapping**, **host-based routing**, and **verification**. Cert issuance + DNS are an operator step
you must *document*, not implement. Don't try to provision certs from app code.

## Build on (verified)
- Canvas apps serve from `canvasRoot` (`config.web.canvas.root`, Railway `/data/canvas`); app-spaces
  exist (`APP_NAMESPACE`, `src/web/app-spaces.ts`) and serve via `GET /api/app/:space/*` (`app.ts`
  ~3064) through `injectCanvasRuntime`.
- Auth middleware + `PUBLIC_PREFIXES` (`src/web/middleware/auth.ts`); security headers via
  `createSecurityHeaders`.

## Design FIRST — propose and PAUSE for sign-off
Host-based routing is security-sensitive (host confusion, admin-surface exposure). Write a design
note before coding:
1. **Mapping store:** a `custom_domains` table — `domain`, target `app_space`, `auth_policy`
   (`public` | `auth`), optional `brand_id`, `verified` flag, `verify_token`, timestamps. CRUD under
   `/api/domains` (auth-guarded) + an admin page.
2. **Host routing middleware:** runs early; reads the `Host` header; if it matches a **verified**
   custom domain → rewrite to that app-space and serve its entry from `/` (through
   `injectCanvasRuntime`, honoring `auth_policy`); otherwise fall through to normal paw routing. It
   must **never** expose the paw admin/console surface on a mapped content domain (allowlist exactly
   what a content domain may serve), and never hijack the primary paw host.
3. **Verification flow:** issue a CNAME target + TXT token; `POST /api/domains/:id/verify` checks DNS
   before the domain is marked `verified` and served.
4. **Auth/cookie interaction with the companion:** the auth-gated companion (`feat/companion-on-
   canvas`) relies on a same-origin session cookie. On a *custom* domain the cookie domain differs —
   decide: per-domain session, or **no companion on custom content domains initially** (simplest).
   Document the choice.
5. **Operator runbook:** the exact infra steps (add domain in Railway / point CNAME / cert), so the
   app-side mapping has a clear external counterpart.

**Stop for sign-off on the design before implementing.** Tests defined with the design; at minimum:
a verified mapped Host serves the right app-space at `/`; an unmapped Host → normal routing; an
**un**verified domain is not served; the admin/console surface is unreachable via a content domain;
the primary host is never hijacked.

## Out of scope
Cert/edge provisioning (infra/operator); the companion bridge; fork UI. Keep host-routing additions
minimal and clearly marked.
