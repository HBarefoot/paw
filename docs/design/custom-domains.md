# Design note — Custom domains for canvas apps (DESIGN-FIRST, infra-aware, awaiting sign-off)

Source prompt: `docs/prompts/PROMPT-paw-custom-domains.md`. Map a custom domain
(e.g. `app.clientsite.com`) to a canvas app-space and serve it at the domain root instead of
`/canvas/share/<token>`. Branch: `feat/custom-domains`.

## Honest boundary (read first)
**TLS certs + edge termination are platform/infra, not app code** (Railway custom domains, or
Cloudflare/Caddy in front). **Paw owns:** the domain→app-space **mapping**, **host-based routing**,
and **verification**. Cert issuance + DNS are an operator step we *document*, not implement.

## 1. Mapping store (new SQLite table `custom_domains`)
```
id TEXT PK
domain TEXT UNIQUE NOT NULL          -- lowercased host, e.g. app.clientsite.com
app_space TEXT NOT NULL              -- target APP_NAMESPACE (apps/<space>/)
auth_policy TEXT NOT NULL DEFAULT 'public'   -- public | auth
brand_id TEXT                        -- optional brand to theme the domain
verified INTEGER NOT NULL DEFAULT 0
verify_token TEXT NOT NULL           -- TXT challenge value
created_at, updated_at TEXT DEFAULT (datetime('now'))
```
Store `src/store/custom-domains.ts` (CRUD + `getByDomain(host)`); CRUD routes `/api/domains`
(auth-guarded) + an admin page `/domains` under Settings.

## 2. Host-routing middleware (security-sensitive)
Runs **early** (before normal routing), reads the `Host` header:
- If host matches a **verified** `custom_domains` row → rewrite to that app-space and serve its entry
  from `/` via `injectCanvasRuntime` (honoring `auth_policy` + the companion gate from #120), through
  the existing `/api/app/:space/*` resolution.
- Else → fall through to normal paw routing.

**Hard safety rules (the risky part):**
- A mapped content domain may serve **only** an allowlist: the app-space static files + the public
  canvas/brand asset prefixes. **Never** the paw admin/console surface, `/api/*` admin routes,
  `/login`, `/config`, `/vault`, etc. — those return 404 on a content domain.
- The **primary paw host is never hijacked**: the middleware only acts on hosts present + verified in
  the table; the primary host (config) is excluded by construction.
- Host is normalized (lowercase, strip port) and matched exactly — no suffix/wildcard matching in v1
  (prevents host-confusion).

## 3. Verification flow
- On create: generate `verify_token`; show the operator a **CNAME target** (the paw host) + a **TXT
  record** (`_paw-verify.<domain>` = token).
- `POST /api/domains/:id/verify` does a DNS TXT lookup; only on match set `verified=1`. Unverified
  domains are **never served** (middleware checks `verified`).

## 4. Auth / cookie interaction with the companion
The #120 companion relies on a **same-origin `paw_session` cookie**. On a *custom* domain the cookie
domain differs, so the admin isn't "logged in" there. v1 decision: **`auth_policy: public` only +
no companion on custom content domains** (simplest, safest). `auth_policy: auth` and a per-domain
session are **deferred** (documented) — they need cross-domain auth design that interacts with the
copilot bridge. Flagged, not built here.

## 5. Operator runbook (documented, not automated)
1. Add the domain in Railway (or point it at the paw edge) so TLS is provisioned.
2. Create the mapping in `/domains`; copy the CNAME + TXT values.
3. Add the DNS records; click Verify.
4. The domain now serves `apps/<space>/` at `/`.

## Tests (with the design)
A verified mapped Host serves the right app-space at `/`; an unmapped Host → normal routing; an
**un**verified domain is not served; the admin/console surface is unreachable via a content domain
(allowlist enforced); the primary host is never hijacked; host normalization (case/port) holds.

## Open questions for sign-off
1. **v1 auth**: public-only (proposed) vs also support `auth` with a per-domain session now?
2. **Brand**: apply `brand_id` theming on the content domain in v1, or defer? (Proposed: apply — cheap, it's just the existing theme CSS.)
3. **Wildcard/subdomain** support: exact-match only in v1 (proposed) vs allow `*.clientsite.com`?
