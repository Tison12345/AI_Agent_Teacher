-- Phase 2: projects table.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Tables for weekly plans, checkpoints, evaluations and teacher decisions are
-- added in the phases that use them.

create table if not exists public.projects (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(title) between 3 and 100),
  description    text not null check (char_length(description) between 20 and 1000),
  repo_url       text not null,
  duration_weeks integer not null default 12 check (duration_weeks = 12),
  created_at     timestamptz not null default now()
);

-- The browser never talks to the database. Lock the public (publishable-key)
-- roles out completely; the server uses the secret key, which bypasses RLS.
alter table public.projects enable row level security;
revoke all on public.projects from anon, authenticated;
