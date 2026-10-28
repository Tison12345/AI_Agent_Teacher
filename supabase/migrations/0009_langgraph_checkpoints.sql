-- 0009: LangGraph checkpoint storage + run leases. Run once in the Supabase SQL Editor.
-- Checkpoint tables = @langchain/langgraph-checkpoint-postgres 1.1.2 (migrations 0..5, applied literally).
-- The "langgraph" schema must NOT be added to the Data API's exposed schemas. No password is set here.
-- The final block verifies the result and rolls EVERYTHING back if any check fails.
begin;

create schema if not exists langgraph;
comment on schema langgraph is 'LangGraph checkpoints and run leases. Server-only: never expose through the Data API.';

----------------------------------------------------------------------------------------------------------
-- The restricted role the app connects as (DATABASE_URL).
----------------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'langgraph_app') then
    create role langgraph_app login;
  end if;
end $$;
-- A new role already has no superuser, createdb, createrole, replication or bypassrls rights (the defaults).
-- Do NOT name those attributes here: Supabase's postgres user is not a real superuser, and Postgres refuses any
-- ALTER ROLE that mentions them. The verification block at the end proves the role has none of them.
alter role langgraph_app with login noinherit connection limit 5;
alter role langgraph_app set statement_timeout = '30s';
alter role langgraph_app set lock_timeout = '10s';
alter role langgraph_app set idle_in_transaction_session_timeout = '30s';

----------------------------------------------------------------------------------------------------------
-- Checkpoint tables: the package's six migrations, in order, with the schema filled in.
----------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS langgraph.checkpoint_migrations (
  v INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS langgraph.checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE IF NOT EXISTS langgraph.checkpoint_blobs (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);
CREATE TABLE IF NOT EXISTS langgraph.checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  blob BYTEA NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
ALTER TABLE langgraph.checkpoint_blobs ALTER COLUMN blob DROP not null;
ALTER TABLE langgraph.checkpoint_writes ADD COLUMN IF NOT EXISTS task_path TEXT NOT NULL DEFAULT '';
-- What setup() would have recorded after running all six: v = 0..5. The app never calls setup().
insert into langgraph.checkpoint_migrations (v) select generate_series(0, 5) on conflict do nothing;

----------------------------------------------------------------------------------------------------------
-- Run leases: at most one process runs a workflow thread at a time. All decisions use the database clock.
-- The functions run as their owner (SECURITY DEFINER), so the app role needs no write access to the table.
----------------------------------------------------------------------------------------------------------
create table if not exists langgraph.run_leases (
  thread_id   text primary key check (thread_id ~ '^(submission|evaluation):[0-9a-fA-F-]{36}$'),
  holder      uuid not null,
  acquired_at timestamptz not null default now(),
  renewed_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- True only if the caller now holds the lease: nobody held it, or the previous lease had expired.
create or replace function langgraph.claim_run(p_thread_id text, p_holder uuid, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare got uuid;
begin
  if p_seconds not between 10 and 600 then raise exception 'lease must be 10 to 600 seconds'; end if;
  insert into langgraph.run_leases as l (thread_id, holder, expires_at)
  values (p_thread_id, p_holder, now() + make_interval(secs => p_seconds))
  on conflict (thread_id) do update
     set holder = excluded.holder, acquired_at = now(), renewed_at = now(), expires_at = excluded.expires_at
   where l.expires_at <= now()
  returning l.holder into got;
  return got is not null;
end $$;

-- Strict: only the current holder, and only while its lease has not expired. False means "stop now".
create or replace function langgraph.renew_run(p_thread_id text, p_holder uuid, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_seconds not between 10 and 600 then raise exception 'lease must be 10 to 600 seconds'; end if;
  update langgraph.run_leases
     set expires_at = now() + make_interval(secs => p_seconds), renewed_at = now()
   where thread_id = p_thread_id and holder = p_holder and expires_at > now();
  return found;
end $$;

create or replace function langgraph.release_run(p_thread_id text, p_holder uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from langgraph.run_leases where thread_id = p_thread_id and holder = p_holder;
  return found;
end $$;

----------------------------------------------------------------------------------------------------------
-- Permissions: only langgraph_app, and only what the saver's statements use.
----------------------------------------------------------------------------------------------------------
revoke all on schema langgraph from public, anon, authenticated, service_role;
revoke all on all tables in schema langgraph from public, anon, authenticated, service_role;
revoke all on all functions in schema langgraph from public, anon, authenticated, service_role;

grant usage on schema langgraph to langgraph_app;
grant select, insert, update, delete on langgraph.checkpoints       to langgraph_app;  -- upsert + deleteThread
grant select, insert, delete         on langgraph.checkpoint_blobs  to langgraph_app;  -- insert ... do nothing; no update
grant select, insert, update, delete on langgraph.checkpoint_writes to langgraph_app;  -- upsert + deleteThread
grant select                         on langgraph.run_leases        to langgraph_app;  -- read-only; writes go via the functions
grant execute on function langgraph.claim_run(text, uuid, integer)   to langgraph_app;
grant execute on function langgraph.renew_run(text, uuid, integer)   to langgraph_app;
grant execute on function langgraph.release_run(text, uuid)          to langgraph_app;
-- checkpoint_migrations: no grant. The app never runs setup().

alter table langgraph.checkpoint_migrations enable row level security;
alter table langgraph.checkpoints           enable row level security;
alter table langgraph.checkpoint_blobs      enable row level security;
alter table langgraph.checkpoint_writes     enable row level security;
alter table langgraph.run_leases            enable row level security;
create policy app_only on langgraph.checkpoints       for all    to langgraph_app using (true) with check (true);
create policy app_only on langgraph.checkpoint_blobs  for all    to langgraph_app using (true) with check (true);
create policy app_only on langgraph.checkpoint_writes for all    to langgraph_app using (true) with check (true);
create policy app_only on langgraph.run_leases        for select to langgraph_app using (true);

----------------------------------------------------------------------------------------------------------
-- Verification: fails (and rolls back everything) unless the REAL effective privileges are exactly as intended.
----------------------------------------------------------------------------------------------------------
do $$
declare
  r constant name := 'langgraph_app';
  bad text;
begin
  -- 1. The checkpoint tables are exactly what the pinned saver expects.
  select string_agg(x, '; ') into bad from (
    select c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || case when a.attnotnull then ' not null' else '' end as x
      from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'langgraph'::regnamespace
       and c.relname in ('checkpoint_migrations', 'checkpoints', 'checkpoint_blobs', 'checkpoint_writes')
       and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  ) cols
  where x <> all (array[
    'checkpoint_migrations.v integer not null',
    'checkpoints.thread_id text not null', 'checkpoints.checkpoint_ns text not null', 'checkpoints.checkpoint_id text not null',
    'checkpoints.parent_checkpoint_id text', 'checkpoints.type text', 'checkpoints.checkpoint jsonb not null', 'checkpoints.metadata jsonb not null',
    'checkpoint_blobs.thread_id text not null', 'checkpoint_blobs.checkpoint_ns text not null', 'checkpoint_blobs.channel text not null',
    'checkpoint_blobs.version text not null', 'checkpoint_blobs.type text not null', 'checkpoint_blobs.blob bytea',
    'checkpoint_writes.thread_id text not null', 'checkpoint_writes.checkpoint_ns text not null', 'checkpoint_writes.checkpoint_id text not null',
    'checkpoint_writes.task_id text not null', 'checkpoint_writes.idx integer not null', 'checkpoint_writes.channel text not null',
    'checkpoint_writes.type text', 'checkpoint_writes.blob bytea not null', 'checkpoint_writes.task_path text not null'
  ]);
  if bad is not null then raise exception 'unexpected checkpoint columns: %', bad; end if;
  if (select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace = 'langgraph'::regnamespace
         and c.relname in ('checkpoint_migrations', 'checkpoints', 'checkpoint_blobs', 'checkpoint_writes')
         and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped) <> 23 then
    raise exception 'checkpoint tables are missing columns';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'langgraph.checkpoint_migrations'::regclass and contype = 'p') is distinct from 'PRIMARY KEY (v)'
     or (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'langgraph.checkpoints'::regclass and contype = 'p') is distinct from 'PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)'
     or (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'langgraph.checkpoint_blobs'::regclass and contype = 'p') is distinct from 'PRIMARY KEY (thread_id, checkpoint_ns, channel, version)'
     or (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'langgraph.checkpoint_writes'::regclass and contype = 'p') is distinct from 'PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)' then
    raise exception 'checkpoint primary keys differ from the pinned saver';
  end if;
  if (select array_agg(v order by v) from langgraph.checkpoint_migrations) is distinct from array[0, 1, 2, 3, 4, 5] then
    raise exception 'checkpoint_migrations must hold exactly versions 0..5';
  end if;

  -- 2. The role itself: login only, no powers, no memberships.
  if exists (select 1 from pg_roles where rolname = r
              and (rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolreplication or not rolcanlogin)) then
    raise exception 'langgraph_app has unexpected attributes';
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member where u.rolname = r) then
    raise exception 'langgraph_app must not be a member of any role';
  end if;
  if has_schema_privilege(r, 'public', 'CREATE') or has_schema_privilege(r, 'langgraph', 'CREATE')
     or has_database_privilege(r, current_database(), 'CREATE') then
    raise exception 'langgraph_app can create objects';
  end if;

  -- 3. It reaches NO table, view or sequence outside langgraph (effective privileges: defaults, PUBLIC and inheritance included).
  select string_agg(distinct format('%I.%I', n.nspname, c.relname), ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p', 'v', 'm', 'f')
     and n.nspname <> 'langgraph'
     and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'extensions')
     and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
     and (has_any_column_privilege(r, c.oid, 'SELECT') or has_any_column_privilege(r, c.oid, 'INSERT')
          or has_any_column_privilege(r, c.oid, 'UPDATE') or has_any_column_privilege(r, c.oid, 'REFERENCES')
          or has_table_privilege(r, c.oid, 'DELETE') or has_table_privilege(r, c.oid, 'TRUNCATE')
          or has_table_privilege(r, c.oid, 'TRIGGER'));
  if bad is not null then raise exception 'langgraph_app can reach tables or views outside langgraph: %', bad; end if;
  select string_agg(distinct format('%I.%I', n.nspname, c.relname), ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'S' and n.nspname <> 'langgraph'
     and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'extensions')
     and (has_sequence_privilege(r, c.oid, 'USAGE') or has_sequence_privilege(r, c.oid, 'SELECT') or has_sequence_privilege(r, c.oid, 'UPDATE'));
  if bad is not null then raise exception 'langgraph_app can reach sequences: %', bad; end if;
  select string_agg(format('%I.%I', n.nspname, p.proname), ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege(r, p.oid, 'EXECUTE')
     -- Trigger and event-trigger functions cannot be called directly with SQL, so they are not a way in.
     and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype);
  if bad is not null then raise exception 'langgraph_app can run privileged functions in public: %', bad; end if;

  -- 4. Inside langgraph it has exactly the intended rights, and nobody else has any.
  if not (has_table_privilege(r, 'langgraph.checkpoints', 'SELECT') and has_table_privilege(r, 'langgraph.checkpoints', 'INSERT')
          and has_table_privilege(r, 'langgraph.checkpoints', 'UPDATE') and has_table_privilege(r, 'langgraph.checkpoints', 'DELETE')
          and has_table_privilege(r, 'langgraph.checkpoint_blobs', 'SELECT') and has_table_privilege(r, 'langgraph.checkpoint_blobs', 'INSERT')
          and has_table_privilege(r, 'langgraph.checkpoint_blobs', 'DELETE')
          and has_table_privilege(r, 'langgraph.checkpoint_writes', 'SELECT') and has_table_privilege(r, 'langgraph.checkpoint_writes', 'INSERT')
          and has_table_privilege(r, 'langgraph.checkpoint_writes', 'UPDATE') and has_table_privilege(r, 'langgraph.checkpoint_writes', 'DELETE')
          and has_table_privilege(r, 'langgraph.run_leases', 'SELECT')
          and has_function_privilege(r, 'langgraph.claim_run(text, uuid, integer)', 'EXECUTE')
          and has_function_privilege(r, 'langgraph.renew_run(text, uuid, integer)', 'EXECUTE')
          and has_function_privilege(r, 'langgraph.release_run(text, uuid)', 'EXECUTE')) then
    raise exception 'langgraph_app is missing a privilege the saver needs';
  end if;
  if has_table_privilege(r, 'langgraph.checkpoint_blobs', 'UPDATE')
     or has_table_privilege(r, 'langgraph.run_leases', 'INSERT') or has_table_privilege(r, 'langgraph.run_leases', 'UPDATE')
     or has_table_privilege(r, 'langgraph.run_leases', 'DELETE')
     or has_any_column_privilege(r, 'langgraph.checkpoint_migrations', 'SELECT')
     or has_any_column_privilege(r, 'langgraph.checkpoint_migrations', 'INSERT')
     or has_any_column_privilege(r, 'langgraph.checkpoint_migrations', 'UPDATE') then
    raise exception 'langgraph_app has more rights than the saver needs';
  end if;
  select string_agg(distinct c.relname, ', ') into bad
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'langgraph'::regnamespace and c.relkind = 'r'
     and a.grantee <> (select oid from pg_roles where rolname = r) and a.grantee <> c.relowner;
  if bad is not null then raise exception 'unexpected grantees on langgraph tables (including PUBLIC): %', bad; end if;
  select string_agg(distinct p.proname, ', ') into bad
    from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'langgraph'::regnamespace
     and a.grantee <> (select oid from pg_roles where rolname = r) and a.grantee <> p.proowner;
  if bad is not null then raise exception 'unexpected grantees on langgraph functions (including PUBLIC): %', bad; end if;
  if exists (select 1 from pg_namespace n, lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
              where n.nspname = 'langgraph' and a.grantee <> (select oid from pg_roles where rolname = r) and a.grantee <> n.nspowner) then
    raise exception 'unexpected grantees on schema langgraph (including PUBLIC)';
  end if;
end $$;

commit;
