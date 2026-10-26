-- Phase 9: weekly multiple-choice quizzes.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- One quiz per recorded checkpoint. The questions (with the correct answers) are
-- written once and never changed, so a student cannot ask for a new, easier quiz.
create table if not exists public.quizzes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  checkpoint_id uuid not null unique references public.weekly_checkpoints (id) on delete cascade,
  week_number   integer not null check (week_number between 1 and 16),
  -- [{ question, options: [4 texts], correctIndex, explanation }, ...]. Correct answers stay on the server
  -- until the student has submitted their attempt.
  questions     jsonb not null,
  model         text not null,
  created_at    timestamptz not null default now()
);

-- One attempt per quiz: the unique constraint stops a second submission, even a simultaneous one.
create table if not exists public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null unique references public.quizzes (id) on delete cascade,
  answers       jsonb not null,   -- the chosen option index for each question, in order
  correct_count integer not null check (correct_count >= 0),
  total         integer not null check (total > 0 and correct_count <= total),
  submitted_at  timestamptz not null default now()
);

-- Quizzes and attempts are evidence: neither can be rewritten after it is saved.
create or replace function public.quiz_is_immutable() returns trigger
language plpgsql as $$
begin
  raise exception '% rows cannot be changed once saved', tg_table_name using errcode = 'P0001';
end;
$$;

drop trigger if exists quizzes_immutable on public.quizzes;
create trigger quizzes_immutable
  before update on public.quizzes
  for each row execute function public.quiz_is_immutable();

drop trigger if exists quiz_attempts_immutable on public.quiz_attempts;
create trigger quiz_attempts_immutable
  before update on public.quiz_attempts
  for each row execute function public.quiz_is_immutable();

-- Same lock-down as the other tables: only the server (secret key) may access these.
alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
revoke all on public.quizzes from anon, authenticated;
revoke all on public.quiz_attempts from anon, authenticated;
