# Supabase migrations — the agent's fenced yard

These are **operator-applied** SQL migrations. They are committed and reviewed in
the repo, but Paw **never runs them** and the agent **never composes SQL**. You
(the project owner) apply them once, by hand, so the agent gets a database it can
build in — safely, by construction.

## Why two Supabase credentials?

| Credential | Vault slot | Used by | Blast radius |
|---|---|---|---|
| Service-role key | `supabase.serviceKey` | CRUD tools (`supabase_select/insert/update/delete`) + the form receiver, over PostgREST | Reads/writes **rows** in exposed tables. Cannot run DDL. |
| `paw_builder` DSN | `supabase.builderDsn` | The typed provisioning tools (`supabase_create_table` / `supabase_add_column`), over a direct Postgres connection | Can `CREATE`/`ALTER` tables **only inside schema `canvas`**. Postgres-enforced. |

Splitting them means the high-frequency data path and the rare schema-change path
fail independently. A leaked or misused builder DSN still cannot escape schema
`canvas`; a leaked service key cannot change schema at all. Neither can run
arbitrary SQL through Paw — the provisioning tools generate DDL from validated
specs (closed type/identifier enums), never from agent-supplied strings.

## `001_canvas_yard.sql`

Creates:

- Schema **`canvas`** — the only place the agent may create tables.
- Role **`paw_builder`** — `LOGIN`, `NOSUPERUSER NOCREATEDB NOCREATEROLE`, with
  `USAGE` + `CREATE` on schema `canvas` **only**, and explicitly nothing on
  `public`, `auth`, `storage`, or any other schema.
- Default privileges so tables `paw_builder` creates in `canvas` are immediately
  read/writable by `service_role` and `authenticated` (the CRUD path), but not
  `anon` (v1 pages are write-only).

The migration is idempotent — safe to re-run.

## Apply it (once)

### Step 1 — run the migration as the project owner

**Supabase SQL editor:** paste the contents of `001_canvas_yard.sql` and run.

**Or via CLI / psql** (connection string from *Project Settings → Database*, the
`postgres` superuser/owner connection):

```bash
psql "$SUPABASE_OWNER_DSN" -f src/integrations/supabase/migrations/001_canvas_yard.sql
```

### Step 2 — set the builder password (the migration does NOT)

The role is created **without a usable password** so it is fail-closed until you
set one. Generate a strong secret and assign it:

```sql
alter role paw_builder with password '<GENERATE_A_STRONG_RANDOM_PASSWORD>';
```

(e.g. `openssl rand -base64 24` for the value — do not reuse another credential.)

### Step 3 — expose schema `canvas` through PostgREST

This is a **dashboard setting**, not SQL. In *Project Settings → API → Exposed
schemas* (a.k.a. `db-schemas` / `db_extra_search_path`), add `canvas` alongside
`public`, then save. PostgREST reloads its schema cache automatically; to force
it immediately you can run:

```sql
notify pgrst, 'reload schema';
```

Without this, the CRUD tools and the form receiver will 404 on `canvas.*` tables
even though they exist.

### Step 4 — store the builder DSN in the Paw vault

Assemble the DSN for the `paw_builder` role. Use the **session-mode** connection
host that matches your network (the Supavisor pooler host on port `5432` for
IPv4; the direct `db.<ref>.supabase.co:5432` host if you have IPv6). Example
shape:

```
postgres://paw_builder:<password-from-step-2>@<host>:5432/postgres?sslmode=require
```

Save it in the vault (Vault page, scope **supabase**, slot **`supabase.builderDsn`**),
or set config `supabase.builderDsn` to a `vault://supabase.builderDsn` reference.
It is resolved **server-side only** and never reaches the model.

## Step 5 — verify the fence (PROVE paw_builder cannot escape the yard)

Connect **as `paw_builder`** (using the DSN from step 4) and run these. The first
must **succeed**; the rest must **fail** with a permission error. If any of the
"must fail" statements succeeds, the fence is broken — stop and re-check the
migration applied cleanly.

```sql
-- MUST SUCCEED: create inside the yard.
create table if not exists canvas._fence_probe (ok boolean);
drop table canvas._fence_probe;

-- MUST FAIL: ERROR: permission denied for schema public
create table public._should_not_exist (id int);

-- MUST FAIL: ERROR: permission denied for schema auth (or: schema does not exist)
create table auth._should_not_exist (id int);

-- MUST FAIL: cannot create roles / escalate.
create role someone_else login;

-- MUST FAIL: not a superuser, cannot read another schema's data it was not granted.
select * from auth.users limit 1;
```

A one-liner the operator can run to confirm the role's attributes are locked:

```sql
select rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin
from pg_roles where rolname = 'paw_builder';
-- expect: paw_builder | f | f | f | t
```

## Destructive schema ops are operator-only

The provisioning tools deliberately ship **no `DROP`, `ALTER TYPE`, or `TRUNCATE`**
in v1. If you need to drop or restructure a `canvas` table, do it here, by hand,
as the owner. The agent will explain this limitation rather than improvising.
