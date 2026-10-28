-- Phase A: AI assignment evaluation (demo scope).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- No login exists in this app: the server (secret key) is the only thing that can read or write.
-- Student screens read ONLY the two views at the bottom; faculty screens read the tables.

----------------------------------------------------------------------------------------
-- Assignments (questions are what students see; reference answers are faculty-only)
----------------------------------------------------------------------------------------
create table if not exists public.assignments (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(btrim(title)) between 3 and 120),
  instructions      text not null check (length(btrim(instructions)) > 0),
  -- [{ "number": 1, "text": "...", "maxMarks": 5, "rubric": "..." }, ...]
  questions         jsonb not null,
  -- optional { "1": "reference answer", ... }; never exposed to students
  reference_answers jsonb,
  max_marks         numeric(6, 2) not null,       -- set by the trigger below: the sum of the questions
  created_at        timestamptz not null default now()
);

create or replace function public.prepare_assignment() returns trigger
language plpgsql as $$
declare
  q     jsonb;
  n     integer := 0;
  total numeric := 0;
  k     text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'an assignment cannot be changed after it is created' using errcode = 'P0001';
  end if;
  if jsonb_typeof(new.questions) <> 'array' or jsonb_array_length(new.questions) not between 1 and 20 then
    raise exception 'an assignment needs 1 to 20 questions' using errcode = 'P0001';
  end if;
  for q in select * from jsonb_array_elements(new.questions) loop
    n := n + 1;
    if (q->>'number')::integer is distinct from n
       or length(btrim(coalesce(q->>'text', ''))) = 0
       or length(btrim(coalesce(q->>'rubric', ''))) = 0
       or (q->>'maxMarks')::numeric <= 0
       or (q->>'maxMarks')::numeric > 100
       or (q->>'maxMarks')::numeric <> round((q->>'maxMarks')::numeric, 2) then
      raise exception 'invalid question %', n using errcode = 'P0001';
    end if;
    total := total + (q->>'maxMarks')::numeric;
  end loop;
  if new.reference_answers is not null then
    if jsonb_typeof(new.reference_answers) <> 'object' then
      raise exception 'reference answers must be an object keyed by question number' using errcode = 'P0001';
    end if;
    for k in select jsonb_object_keys(new.reference_answers) loop
      if k !~ '^[0-9]+$' or k::integer not between 1 and n
         or jsonb_typeof(new.reference_answers->k) <> 'string' then
        raise exception 'invalid reference answer for question %', k using errcode = 'P0001';
      end if;
    end loop;
  end if;
  new.max_marks := total;                         -- never trust a caller-supplied total
  return new;
end;
$$;

drop trigger if exists assignments_prepare on public.assignments;
create trigger assignments_prepare
  before insert or update on public.assignments
  for each row execute function public.prepare_assignment();

----------------------------------------------------------------------------------------
-- Marks checking, shared by the AI-result trigger and the decision function.
-- items: [{ "number": 1, "marks": 3.5 }, ...]. Every question exactly once, 0..maxMarks, 2 decimals.
-- Returns the total. The total is always computed here, never supplied.
----------------------------------------------------------------------------------------
create or replace function public.checked_total(p_assignment_id uuid, p_items jsonb)
returns numeric
language plpgsql stable as $$
declare
  qs    jsonb;
  q     jsonb;
  item  jsonb;
  marks numeric;
  total numeric := 0;
begin
  select questions into qs from public.assignments where id = p_assignment_id;
  if qs is null then
    raise exception 'assignment_not_found' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) <> jsonb_array_length(qs) then
    raise exception 'marks must cover every question exactly once' using errcode = 'P0001';
  end if;
  for q in select * from jsonb_array_elements(qs) loop
    if (select count(*) from jsonb_array_elements(p_items) e
         where (e->>'number')::integer = (q->>'number')::integer) <> 1 then
      raise exception 'marks must cover every question exactly once' using errcode = 'P0001';
    end if;
    select e into item from jsonb_array_elements(p_items) e
     where (e->>'number')::integer = (q->>'number')::integer;
    marks := (item->>'marks')::numeric;
    if marks is null or marks < 0 or marks > (q->>'maxMarks')::numeric or marks <> round(marks, 2) then
      raise exception 'marks for question % are outside 0..%', q->>'number', q->>'maxMarks' using errcode = 'P0001';
    end if;
    total := total + marks;
  end loop;
  return total;
end;
$$;

-- [{number, marks}] sorted by number, with nothing else: comparable and safe to store.
create or replace function public.normalized_marks(p_items jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('number', (e->>'number')::integer,
                                               'marks',  (e->>'marks')::numeric)
                            order by (e->>'number')::integer), '[]'::jsonb)
  from jsonb_array_elements(p_items) e
$$;

----------------------------------------------------------------------------------------
-- Submissions (one row per upload; several per student are allowed)
----------------------------------------------------------------------------------------
create table if not exists public.submissions (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments (id) on delete cascade,
  student_name   text not null check (length(btrim(student_name)) between 2 and 80),
  file_path      text not null,                              -- object path in the private bucket
  file_name      text not null check (length(file_name) between 1 and 200),
  file_type      text not null check (file_type in ('pdf', 'docx')),
  file_size      integer not null check (file_size between 1 and 4194304),
  status         text not null default 'processing'
                 check (status in ('processing', 'needs_ocr', 'failed', 'awaiting_review',
                                   'approved', 'edited', 'rejected')),
  -- A short, plain-language reason written by our code (never a raw exception). Shown to students.
  error          text check (error is null or length(error) <= 300),
  extracted_text text,
  extraction     jsonb,                                      -- pages, characters per page, warnings
  -- The AI's RECOMMENDATION only. Written once; locked by the trigger below.
  -- { "questions": [{ number, marks, maxMarks, explanation, quotes: [] }], "feedback": "..." }
  ai_result      jsonb,
  ai_total       numeric(6, 2),                              -- computed by the trigger, not by the caller
  ai_model       text,
  created_at     timestamptz not null default now(),
  check ((status in ('needs_ocr', 'failed')) = (error is not null)),
  -- A week can only be waiting for, or past, review if it really has text and an AI result.
  check (status not in ('awaiting_review', 'approved', 'edited', 'rejected')
         or (extracted_text is not null and ai_result is not null))
);

create index if not exists submissions_assignment_idx on public.submissions (assignment_id, created_at desc);
create index if not exists submissions_student_idx
  on public.submissions (assignment_id, lower(btrim(student_name)));

create or replace function public.guard_submission() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'processing' or new.error is not null or new.extracted_text is not null
       or new.extraction is not null or new.ai_result is not null
       or new.ai_total is not null or new.ai_model is not null then
      raise exception 'a new submission must start as processing and empty' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- Who submitted what never changes.
  if new.id is distinct from old.id
     or new.assignment_id is distinct from old.assignment_id
     or new.student_name is distinct from old.student_name
     or new.file_path is distinct from old.file_path
     or new.file_name is distinct from old.file_name
     or new.file_type is distinct from old.file_type
     or new.file_size is distinct from old.file_size
     or new.created_at is distinct from old.created_at then
    raise exception 'a submission and its file cannot be changed' using errcode = 'P0001';
  end if;

  -- Extracted text and the AI recommendation are evidence: written once.
  if old.extracted_text is not null
     and (new.extracted_text is distinct from old.extracted_text or new.extraction is distinct from old.extraction) then
    raise exception 'extracted text cannot be changed once saved' using errcode = 'P0001';
  end if;
  if old.ai_result is not null
     and (new.ai_result is distinct from old.ai_result
          or new.ai_total is distinct from old.ai_total
          or new.ai_model is distinct from old.ai_model) then
    raise exception 'the AI recommendation cannot be changed once saved' using errcode = 'P0001';
  end if;

  -- First time the AI result is saved: validate it and compute its total here.
  if old.ai_result is null and new.ai_result is not null then
    if new.extracted_text is null then
      raise exception 'an AI result needs extracted text' using errcode = 'P0001';
    end if;
    if new.ai_model is null or length(btrim(coalesce(new.ai_result->>'feedback', ''))) = 0 then
      raise exception 'an AI result needs a model name and feedback' using errcode = 'P0001';
    end if;
    new.ai_total := public.checked_total(new.assignment_id, new.ai_result->'questions');
  elsif old.ai_result is null and (new.ai_total is not null or new.ai_model is not null) then
    raise exception 'ai_total and ai_model are set together with ai_result' using errcode = 'P0001';
  end if;

  -- Allowed status changes only. "approved/edited/rejected" also need the matching decision row,
  -- so a mark can never be "official" without a faculty decision behind it.
  if new.status is distinct from old.status then
    if not (   (old.status = 'processing'      and new.status in ('needs_ocr', 'failed', 'awaiting_review'))
            or (old.status = 'failed'          and new.status = 'processing')
            or (old.status = 'awaiting_review' and new.status in ('approved', 'edited', 'rejected'))) then
      raise exception 'invalid status change from % to %', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status in ('approved', 'edited', 'rejected')
       and not exists (
         select 1 from public.submission_decisions d
          where d.submission_id = new.id
            and d.decision = case new.status when 'approved' then 'approve'
                                             when 'edited'   then 'edit'
                                             else 'reject' end) then
      raise exception 'a decision is required before this status' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

----------------------------------------------------------------------------------------
-- Faculty decisions: the OFFICIAL result, kept apart from the AI's recommendation
----------------------------------------------------------------------------------------
create table if not exists public.submission_decisions (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  decision      text not null check (decision in ('approve', 'edit', 'reject')),
  scores        jsonb,                          -- [{ number, marks }] final marks per question
  final_total   numeric(6, 2),                  -- computed by decide_submission, never supplied
  feedback      text,                           -- the only text a student sees
  comment       text,                           -- private to faculty
  decided_at    timestamptz not null default now(),
  check (
    (decision = 'reject' and scores is null and final_total is null and feedback is null)
    or
    (decision <> 'reject' and scores is not null and final_total is not null
       and length(btrim(coalesce(feedback, ''))) > 0)
  ),
  check (decision <> 'edit' or length(btrim(coalesce(comment, ''))) > 0)
);

-- The submissions trigger is created after the decisions table exists (it looks decisions up).
drop trigger if exists submissions_guard on public.submissions;
create trigger submissions_guard
  before insert or update on public.submissions
  for each row execute function public.guard_submission();

create or replace function public.protect_submission_decision() returns trigger
language plpgsql as $$
begin
  raise exception 'a decision cannot be changed' using errcode = 'P0001';
end;
$$;

drop trigger if exists submission_decisions_no_update on public.submission_decisions;
create trigger submission_decisions_no_update
  before update on public.submission_decisions
  for each row execute function public.protect_submission_decision();

-- Records the decision and moves the submission out of awaiting_review in one transaction.
--   approve: the AI's marks and feedback are copied from the stored recommendation; the caller's
--            marks and feedback are ignored.
--   edit:    marks, feedback and a private comment are required and must differ from the AI's.
--   reject:  no marks, no feedback.
create or replace function public.decide_submission(
  p_submission_id uuid,
  p_decision      text,
  p_scores        jsonb,
  p_feedback      text,
  p_comment       text
) returns public.submission_decisions
language plpgsql as $$
declare
  sub        public.submissions;
  v_scores   jsonb;
  v_total    numeric;
  v_feedback text;
  saved      public.submission_decisions;
begin
  select * into sub from public.submissions where id = p_submission_id for update;
  if not found then
    raise exception 'submission_not_found' using errcode = 'P0001';
  end if;
  if sub.status in ('approved', 'edited', 'rejected') then
    raise exception 'already_decided' using errcode = 'P0001';
  end if;
  if sub.status <> 'awaiting_review' then
    raise exception 'not_awaiting_review' using errcode = 'P0001';
  end if;
  if p_decision not in ('approve', 'edit', 'reject') then
    raise exception 'invalid_decision' using errcode = 'P0001';
  end if;

  if p_decision = 'approve' then
    v_scores   := public.normalized_marks(sub.ai_result->'questions');
    v_total    := sub.ai_total;
    v_feedback := sub.ai_result->>'feedback';
  elsif p_decision = 'edit' then
    v_total    := public.checked_total(sub.assignment_id, p_scores);      -- validates every mark
    v_scores   := public.normalized_marks(p_scores);
    v_feedback := btrim(coalesce(p_feedback, ''));
    if length(v_feedback) = 0 or length(btrim(coalesce(p_comment, ''))) = 0 then
      raise exception 'edit_needs_feedback_and_comment' using errcode = 'P0001';
    end if;
    if v_scores = public.normalized_marks(sub.ai_result->'questions')
       and v_feedback = btrim(sub.ai_result->>'feedback') then
      raise exception 'unchanged_edit' using errcode = 'P0001';
    end if;
  end if;                                                                 -- reject: all stay null

  insert into public.submission_decisions (submission_id, decision, scores, final_total, feedback, comment)
  values (p_submission_id, p_decision, v_scores, v_total, v_feedback, nullif(btrim(coalesce(p_comment, '')), ''))
  returning * into saved;

  update public.submissions
     set status = case p_decision when 'approve' then 'approved' when 'edit' then 'edited' else 'rejected' end
   where id = p_submission_id;

  return saved;
end;
$$;

----------------------------------------------------------------------------------------
-- What students may read. The student screens query ONLY these views.
-- Not here, by construction: reference answers, extracted text, any AI column, the private comment.
-- Marks and feedback appear only once faculty have approved or edited the submission.
----------------------------------------------------------------------------------------
create or replace view public.student_assignments as
  select id, title, instructions, questions, max_marks, created_at
  from public.assignments;

create or replace view public.student_submissions as
  select s.id, s.assignment_id, s.student_name, s.file_name, s.file_type, s.file_size,
         s.status, s.error, s.created_at,
         case when s.status in ('approved', 'edited') then d.scores      end as scores,
         case when s.status in ('approved', 'edited') then d.final_total end as final_total,
         case when s.status in ('approved', 'edited') then d.feedback    end as feedback,
         case when s.status in ('approved', 'edited') then d.decided_at  end as decided_at
  from public.submissions s
  left join public.submission_decisions d on d.submission_id = s.id;

----------------------------------------------------------------------------------------
-- Storage: a private bucket, no policies. Only the server's secret key can use it.
----------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 4194304,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

----------------------------------------------------------------------------------------
-- Same lock-down as the other tables: only the server (secret key) may access these.
----------------------------------------------------------------------------------------
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_decisions enable row level security;
revoke all on public.assignments, public.submissions, public.submission_decisions from anon, authenticated;
revoke all on public.student_assignments, public.student_submissions from anon, authenticated;
revoke all on function public.checked_total(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.normalized_marks(jsonb) from public, anon, authenticated;
revoke all on function public.decide_submission(uuid, text, jsonb, text, text) from public, anon, authenticated;
