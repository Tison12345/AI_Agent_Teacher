-- Project duration is no longer fixed at 12 weeks: it is chosen per project (1 to 16).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Existing projects keep their 12 weeks. The old "exactly 12" / "week 1 to 12" checks are
-- found by what they check (not by name) and replaced.

do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass::text as table_name, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.connamespace = 'public'::regnamespace
      and (
        (c.conrelid = 'public.projects'::regclass and pg_get_constraintdef(c.oid) like '%duration_weeks%')
        or (c.conrelid = 'public.weekly_checkpoints'::regclass and pg_get_constraintdef(c.oid) like '%week_number%')
        or (c.conrelid = 'public.evaluations'::regclass and pg_get_constraintdef(c.oid) like '%week_number%')
      )
  loop
    execute format('alter table %s drop constraint %I', r.table_name, r.conname);
  end loop;
end $$;

alter table public.projects
  add constraint projects_duration_weeks_check check (duration_weeks between 1 and 16);
alter table public.weekly_checkpoints
  add constraint weekly_checkpoints_week_number_check check (week_number between 1 and 16);
alter table public.evaluations
  add constraint evaluations_week_number_check check (week_number between 1 and 16);
