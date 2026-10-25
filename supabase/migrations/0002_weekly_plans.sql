-- Phase 3: one generated weekly plan per project.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.weekly_plans (
  project_id   uuid primary key references public.projects (id) on delete cascade,
  plan         jsonb not null,
  model        text not null,
  generated_at timestamptz not null default now()
);

-- Same lock-down as projects: only the server (secret key) may access this.
alter table public.weekly_plans enable row level security;
revoke all on public.weekly_plans from anon, authenticated;
