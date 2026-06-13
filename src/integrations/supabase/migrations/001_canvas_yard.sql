-- 001_canvas_yard.sql
-- =============================================================================
-- The fenced yard: a dedicated schema + a least-privilege Postgres role that
-- lets the Paw agent provision its OWN tables (via the typed provisioning tools
-- in src/integrations/supabase/tools.ts) WITHOUT ever touching public/auth/
-- storage and WITHOUT raw SQL passthrough.
--
-- Blast radius is enforced by Postgres, not by application code: the agent's
-- DDL tools log in as `paw_builder`, whose privileges are confined to schema
-- `canvas`. Even a bug in the DDL generator cannot escape the yard, because the
-- database itself refuses anything `paw_builder` is not granted.
--
-- Apply ONCE, as the project owner, via the Supabase SQL editor or psql/CLI.
-- See README.md in this directory for the password step, the PostgREST exposed-
-- schemas dashboard setting, and the operator verification query that PROVES
-- the fence holds.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- 1. The yard ----------------------------------------------------------------
create schema if not exists canvas;

-- 2. The builder role --------------------------------------------------------
-- A LOGIN role that cannot escalate: NOSUPERUSER NOCREATEDB NOCREATEROLE.
-- It is created WITHOUT a usable password on purpose (fail-closed): nobody can
-- connect until the operator sets a strong password — see README step 2. Do not
-- commit a password into this file.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'paw_builder') then
    create role paw_builder login nosuperuser nocreatedb nocreaterole;
  end if;
end
$$;

-- Re-assert the escalation guards even if the role pre-existed from an earlier
-- (possibly looser) apply. These keep the fence honest.
--
-- IMPORTANT (hosted Supabase quirk): we deliberately do NOT include `nosuperuser`
-- here. On Supabase the project's `postgres` role is NOT a true superuser, and
-- Postgres requires actual superuser to touch the SUPERUSER attribute of any role
-- — even to set it to NO. So `alter role ... nosuperuser` fails with `42501:
-- permission denied`, which would abort the whole migration in the SQL editor.
-- It is also unnecessary: `nosuperuser` is the default and is already set at
-- CREATE time above (creating a NON-superuser role needs only CREATEROLE, not
-- superuser). Non-superuser-ness is ASSERTED instead via the README's pg_roles
-- check (`rolsuper` must be `f`), not re-applied here.
alter role paw_builder nocreatedb nocreaterole;

-- 3. Privileges INSIDE the yard ----------------------------------------------
-- USAGE + CREATE on `canvas` ONLY. This is the entire grant surface the builder
-- ever receives. Tables it creates are owned by it (so it can ALTER / ENABLE
-- RLS on them), but it can create them nowhere else.
grant usage, create on schema canvas to paw_builder;

-- 4. PostgREST / API roles reach the yard for the CRUD path ------------------
-- The runtime CRUD tools (supabase_select/insert/...) and the form receiver use
-- the SERVICE-ROLE key over PostgREST. Those API roles need USAGE on the schema
-- to see it at all. `service_role` has BYPASSRLS (so it can read/write tables
-- whose RLS is forced on with no policies); `authenticated`/`anon` are granted
-- USAGE so PostgREST can introspect, but get no table rights here — table-level
-- grants below decide that per future table.
grant usage on schema canvas to anon, authenticated, service_role;

-- 5. Default privileges for tables the builder will create -------------------
-- ALTER DEFAULT PRIVILEGES applies to OBJECTS CREATED LATER *by paw_builder* in
-- schema `canvas`. This is what makes a freshly-provisioned table immediately
-- usable by the service-key CRUD path without a second operator step.
--
--   * service_role  -> full CRUD (it is the key the receiver + agent tools use;
--                      BYPASSRLS lets it work even though WI2 forces RLS on).
--   * authenticated -> full CRUD (authed app-space submissions).
--   * anon          -> intentionally NOTHING. v1 published pages are
--                      write-only through the receiver and ship no Supabase
--                      credentials; anonymous direct reads are out of scope
--                      (phase 2 would add explicit RLS policies + anon SELECT).
alter default privileges for role paw_builder in schema canvas
  grant select, insert, update, delete on tables to service_role, authenticated;

-- Sequences a created table may use (e.g. an explicit serial) stay usable too.
alter default privileges for role paw_builder in schema canvas
  grant usage, select on sequences to service_role, authenticated;

-- 6. Defense-in-depth: keep the builder OUT of `public` ----------------------
-- On Supabase (Postgres 15+) the `public` schema does NOT grant CREATE to the
-- PUBLIC pseudo-role by default, so a fresh `paw_builder` already cannot create
-- there. We add an explicit, NON-INVASIVE revoke of any direct grant on `public`
-- from paw_builder (a no-op on a clean apply) rather than touching PUBLIC's
-- grants, which would alter privileges database-wide for every role. We do NOT
-- grant paw_builder anything on auth / storage / graphql_public — it was never
-- granted there and this migration never grants it; that silence is the fence.
-- The README's verification query proves paw_builder cannot create in `public`.
revoke all on schema public from paw_builder;

-- =============================================================================
-- After applying: set paw_builder's password (README step 2), add `canvas` to
-- the PostgREST exposed schemas (README step 3), then store the builder DSN in
-- the Paw vault under slot `supabase.builderDsn` (README step 4).
-- =============================================================================
