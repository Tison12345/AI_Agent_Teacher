-- Link projects and assignment submissions to the student who made them (for the student-centric faculty dashboard).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run. Requires 0010_app_users.sql.
--
-- Two optional columns, both pointing at the student's account (app_users.id). Weekly checkpoints, evaluations,
-- quizzes and teacher decisions already belong to a project, so they are linked to the student through it.
-- Nothing else changes: no existing rows are removed or rewritten, except that rows created before accounts existed
-- are assigned to ONE account (see the last statements).

alter table public.projects    add column if not exists owner_id   uuid references public.app_users (id);
alter table public.submissions add column if not exists student_id uuid references public.app_users (id);

create index if not exists projects_owner_idx        on public.projects (owner_id);
create index if not exists submissions_student_id_idx on public.submissions (student_id);

-- Rows created before accounts existed have no owner. Put them under one student so the dashboard has real data
-- to show. This account is the test student; change the email below to use another student account.
-- If that account does not exist, nothing is changed (the rows simply stay unassigned).
do $$
declare
  owner uuid;
begin
  select id into owner from public.app_users where email = 'student@gmail.com' and role = 'student';
  if owner is not null then
    update public.projects    set owner_id   = owner where owner_id   is null;
    update public.submissions set student_id = owner where student_id is null;
  end if;
end $$;

-- Check the result, and undo everything if anything is off.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'projects' and column_name = 'owner_id') then
    raise exception 'projects.owner_id is missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'submissions' and column_name = 'student_id') then
    raise exception 'submissions.student_id is missing';
  end if;
  if exists (select 1 from public.projects p join public.app_users u on u.id = p.owner_id where u.role <> 'student') then
    raise exception 'a project is owned by a non-student account';
  end if;
end $$;
