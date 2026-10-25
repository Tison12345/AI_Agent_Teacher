-- Phase 7: the teacher's official decision on an AI evaluation.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Requires 0004_evaluations.sql.

create table if not exists public.teacher_decisions (
  id                uuid primary key default gen_random_uuid(),
  -- One decision per evaluation: simultaneous or repeated requests cannot create a second.
  evaluation_id     uuid not null unique references public.evaluations (id) on delete cascade,
  decision          text not null check (decision in ('approve', 'edit', 'reject')),
  -- The official mark. Separate from evaluations.suggested_score, which is only the AI's recommendation.
  approved_score    numeric(5, 2) check (approved_score between 0 and 100),
  -- The only text students see. The comment below stays with the teacher.
  approved_feedback text,
  comment           text,
  decided_at        timestamptz not null default now(),
  check (
    (decision = 'reject' and approved_score is null and approved_feedback is null)
    or
    (decision <> 'reject' and approved_score is not null and length(btrim(coalesce(approved_feedback, ''))) > 0)
  )
);

-- A decision is a record: it can be deleted only along with its evaluation, never edited.
create or replace function public.protect_teacher_decision() returns trigger
language plpgsql as $$
begin
  raise exception 'a teacher decision cannot be changed' using errcode = 'P0001';
end;
$$;

drop trigger if exists teacher_decisions_no_update on public.teacher_decisions;
create trigger teacher_decisions_no_update
  before update on public.teacher_decisions
  for each row execute function public.protect_teacher_decision();

-- Once decided, an evaluation's status is final (it still may not change anything else).
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
  if old.status <> 'pending_review' and new.status is distinct from old.status then
    raise exception 'evaluation already decided' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Records the decision and moves the evaluation out of pending_review in one transaction,
-- so a decision without a status change (or the reverse) cannot exist.
create or replace function public.decide_evaluation(
  p_evaluation_id uuid,
  p_decision      text,
  p_score         numeric,
  p_feedback      text,
  p_comment       text
) returns public.teacher_decisions
language plpgsql as $$
declare
  current_status text;
  saved public.teacher_decisions;
begin
  select status into current_status from public.evaluations where id = p_evaluation_id for update;
  if not found then
    raise exception 'evaluation_not_found' using errcode = 'P0001';
  end if;
  if current_status <> 'pending_review' then
    raise exception 'already_decided' using errcode = 'P0001';
  end if;

  insert into public.teacher_decisions (evaluation_id, decision, approved_score, approved_feedback, comment)
  values (p_evaluation_id, p_decision, p_score, p_feedback, p_comment)
  returning * into saved;

  update public.evaluations
     set status = case p_decision when 'approve' then 'approved' when 'edit' then 'edited' else 'rejected' end
   where id = p_evaluation_id;

  return saved;
end;
$$;

-- Same lock-down as the other tables: only the server (secret key) may access this.
alter table public.teacher_decisions enable row level security;
revoke all on public.teacher_decisions from anon, authenticated;
revoke all on function public.decide_evaluation(uuid, text, numeric, text, text) from public, anon, authenticated;
