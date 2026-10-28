-- Sign-in and sign-up accounts (lightweight, for the college MVP).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- One row per account: an email, a role, a name and a password HASH (scrypt, made by the server; the password
-- itself is never stored). Nothing else in the database refers to it, so existing tables and data are untouched.

create table if not exists public.app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null
                check (email = lower(email) and char_length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role          text not null check (role in ('student', 'faculty')),
  full_name     text not null check (char_length(full_name) between 2 and 80),
  password_hash text not null check (char_length(password_hash) between 40 and 400),
  created_at    timestamptz not null default now()
);

-- One account per email. Two sign-ups at the same moment cannot both succeed.
create unique index if not exists app_users_email_key on public.app_users (email);

-- The browser never talks to the database. Lock the public (publishable-key) roles out completely; the server
-- uses the secret key, which bypasses RLS. Password hashes are never readable by anyone else.
alter table public.app_users enable row level security;
revoke all on public.app_users from public, anon, authenticated;

-- Check the result, and undo everything if anything is off.
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'app_users' and c.relrowsecurity) then
    raise exception 'app_users: row level security is not enabled';
  end if;
  if has_table_privilege('anon', 'public.app_users', 'select')
     or has_table_privilege('authenticated', 'public.app_users', 'select') then
    raise exception 'app_users: anon or authenticated can read the table';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'app_users' and indexname = 'app_users_email_key') then
    raise exception 'app_users: the unique email index is missing';
  end if;
end $$;
