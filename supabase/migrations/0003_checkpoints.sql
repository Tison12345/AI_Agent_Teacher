-- Phase 5: project baselines and weekly checkpoints.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.project_baselines (
  project_id  uuid primary key references public.projects (id) on delete cascade,
  commit_sha  text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  branch      text not null,
  recorded_at timestamptz not null default now()
);

create table if not exists public.weekly_checkpoints (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  week_number     integer not null check (week_number between 1 and 12),
  commit_sha      text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  base_commit_sha text not null check (base_commit_sha ~ '^[0-9a-f]{40}$'),
  branch          text not null,
  files_changed   integer not null check (files_changed >= 0),
  additions       integer not null check (additions >= 0),
  deletions       integer not null check (deletions >= 0),
  recorded_at     timestamptz not null default now(),
  -- One checkpoint per week: repeated or simultaneous clicks cannot create a second one.
  unique (project_id, week_number)
);

-- Baselines and checkpoints are evidence. They may be inserted but never edited,
-- so a recorded commit can't be silently replaced (even by a buggy server).
create or replace function public.prevent_row_update() returns trigger
language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = 'P0001';
end;
$$;

drop trigger if exists project_baselines_immutable on public.project_baselines;
create trigger project_baselines_immutable
  before update on public.project_baselines
  for each row execute function public.prevent_row_update();

drop trigger if exists weekly_checkpoints_immutable on public.weekly_checkpoints;
create trigger weekly_checkpoints_immutable
  before update on public.weekly_checkpoints
  for each row execute function public.prevent_row_update();

-- Same lock-down as the other tables: only the server (secret key) may access these.
alter table public.project_baselines enable row level security;
alter table public.weekly_checkpoints enable row level security;
revoke all on public.project_baselines from anon, authenticated;
revoke all on public.weekly_checkpoints from anon, authenticated;
