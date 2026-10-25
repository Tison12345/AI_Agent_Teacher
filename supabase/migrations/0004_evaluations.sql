-- Phase 6: AI evaluations of recorded weekly checkpoints.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.evaluations (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  -- One evaluation per checkpoint: repeated or simultaneous requests cannot create a second.
  checkpoint_id   uuid not null unique references public.weekly_checkpoints (id) on delete cascade,
  week_number     integer not null check (week_number between 1 and 12),
  -- The AI's recommendation only. The official mark will live in a separate teacher decision.
  suggested_score numeric(5, 2) not null check (suggested_score between 0 and 100),
  result          jsonb not null,   -- per-criterion assessments, requirements, concerns, feedback, confidence, review scope
  snapshot        jsonb not null,   -- the diff the AI was shown, kept as evidence for the teacher
  model           text not null,
  status          text not null default 'pending_review'
                  check (status in ('pending_review', 'approved', 'edited', 'rejected')),
  created_at      timestamptz not null default now()
);

-- The AI's output is evidence: only `status` may change after creation
-- (the teacher workflow in a later phase). Nothing else can be rewritten.
create or replace function public.protect_evaluation_output() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.checkpoint_id is distinct from old.checkpoint_id
     or new.week_number is distinct from old.week_number
     or new.suggested_score is distinct from old.suggested_score
     or new.result is distinct from old.result
     or new.snapshot is distinct from old.snapshot
     or new.model is distinct from old.model
     or new.created_at is distinct from old.created_at then
    raise exception 'evaluation output is immutable; only status may change' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists evaluations_protect_output on public.evaluations;
create trigger evaluations_protect_output
  before update on public.evaluations
  for each row execute function public.protect_evaluation_output();

-- Same lock-down as the other tables: only the server (secret key) may access this.
alter table public.evaluations enable row level security;
revoke all on public.evaluations from anon, authenticated;
