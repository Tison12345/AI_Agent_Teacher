"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { fetchStudent } from "@/lib/api/client";
import { repoName } from "@/lib/dashboard/summary";
import type { ClassOverview, StudentDetail, StudentSummary } from "@/lib/students/types";
import { FACULTY_STATUS } from "./submission-labels";
import { Icon, StatCard } from "./ui";

const pct = (value: number | null) => (value === null ? "–" : `${value}%`);
const pending = (s: StudentSummary) => s.weeklyPending + s.assignmentPending;

/** The class at a glance: six numbers, all worked out from the real records. */
export function StudentOverviewCards({ overview }: { overview: ClassOverview }) {
  return (
    <section aria-label="Class overview" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <StatCard icon="student" label="Total students" value={overview.totalStudents} hint={overview.totalStudents === 0 ? "no student has signed up yet" : "with an account"} />
      <StatCard icon="folder" label="Projects submitted" value={overview.totalProjects} hint="created by students" />
      <StatCard icon="doc" label="Assignments submitted" value={overview.assignmentsSubmitted} hint="uploaded answers" />
      <StatCard
        icon="clock"
        label="Assignments to review"
        value={overview.assignmentsAwaitingReview}
        hint={overview.assignmentsAwaitingReview === 0 ? "all caught up" : "waiting for your decision"}
      />
      <StatCard
        icon="repo"
        label="Weekly evaluations to review"
        value={overview.weeklyAwaitingReview}
        hint={overview.weeklyAwaitingReview === 0 ? "all caught up" : "waiting for your decision"}
      />
      <StatCard
        icon="chart"
        label="Average official score"
        value={pct(overview.overallAverage)}
        hint={
          overview.overallAverage === null
            ? "no approved scores yet"
            : `across ${overview.studentsWithScores} ${overview.studentsWithScores === 1 ? "student" : "students"}, approved results only`
        }
      />
    </section>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

type Detail = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; student: StudentDetail };

/** What opens under a student: their projects and repositories and where their assignments stand. */
function StudentPreview({ student }: { student: StudentSummary }) {
  const [detail, setDetail] = useState<Detail>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchStudent(student.id).then(
      (found) => {
        if (cancelled) return;
        setDetail(found ? { status: "ready", student: found } : { status: "error", message: "This student could not be found." });
      },
      (error: unknown) => {
        if (!cancelled) setDetail({ status: "error", message: error instanceof Error ? error.message : "Could not load the details." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [student.id, attempt]);

  if (detail.status === "loading") {
    return (
      <p role="status" className="text-sm text-muted">
        Loading details…
      </p>
    );
  }
  if (detail.status === "error") {
    return (
      <div role="alert" className="alert-danger text-sm">
        <p>{detail.message}</p>
        <button
          type="button"
          onClick={() => {
            setDetail({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
          className="btn-secondary btn-sm mt-2"
        >
          Try again
        </button>
      </div>
    );
  }

  const { projects, assignments } = detail.student;
  const counts = assignments.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }), {});
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-2">
        <h4 className="eyebrow">Projects</h4>
        {projects.length === 0 ? (
          <p className="text-sm text-muted">No projects yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {projects.map((project) => (
              <li key={project.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{project.title}</span>
                  <span className="block truncate text-xs text-muted">{repoName(project.repoUrl)}</span>
                </span>
                <span className="text-xs text-muted">
                  {project.weeks.length} {project.weeks.length === 1 ? "week" : "weeks"} · avg {pct(project.averageOfficial)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <h4 className="eyebrow">Assignments</h4>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted">There are no assignments yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {Object.entries(counts).map(([status, count]) => (
              <li key={status} className={status === "not_submitted" ? "badge-neutral" : FACULTY_STATUS[status as keyof typeof FACULTY_STATUS].badge}>
                {status === "not_submitted" ? "Not submitted" : FACULTY_STATUS[status as keyof typeof FACULTY_STATUS].label}: {count}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StudentRow({ student }: { student: StudentSummary }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const waiting = pending(student);
  return (
    <li className="card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-4 rounded-2xl p-4 text-left transition duration-150 hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-nowrap"
      >
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/20 text-sm font-bold text-accent">
          {student.id === "unassigned" ? "?" : initials(student.name)}
        </span>
        <span className="min-w-0 flex-1 basis-40">
          <span className="block truncate font-semibold">{student.name}</span>
          <span className="block truncate text-xs text-muted">{student.email ?? "Created before accounts existed"}</span>
        </span>
        <dl className="grid shrink-0 grid-cols-4 gap-x-5 text-center text-sm">
          <div>
            <dt className="eyebrow">Projects</dt>
            <dd className="font-semibold tabular-nums">{student.projectCount}</dd>
          </div>
          <div>
            <dt className="eyebrow">Assignments</dt>
            <dd className="font-semibold tabular-nums">{student.assignmentsSubmitted}</dd>
          </div>
          <div>
            <dt className="eyebrow">Pending</dt>
            <dd className={`font-semibold tabular-nums ${waiting > 0 ? "text-warning" : ""}`}>{waiting}</dd>
          </div>
          <div>
            <dt className="eyebrow">Avg score</dt>
            <dd className="font-semibold tabular-nums">{pct(student.averageOfficial)}</dd>
          </div>
        </dl>
        <Icon name="chevron" className={`h-5 w-5 shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div id={panelId} className="space-y-4 border-t border-line p-4">
          <StudentPreview student={student} />
          <Link href={`/faculty/students/${student.id}`} className="btn-primary btn-sm">
            Open full profile
            <span className="sr-only"> for {student.name}</span>
            <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      )}
    </li>
  );
}

/** A searchable list of students. Each row opens to a short preview, with a link to the full profile. */
export function StudentList({ students }: { students: StudentSummary[] }) {
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return students.filter((s) => (!needle || s.name.toLowerCase().includes(needle) || (s.email ?? "").toLowerCase().includes(needle)) && (!onlyPending || pending(s) > 0));
  }, [students, query, onlyPending]);

  return (
    <section aria-labelledby="students-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="students-heading" className="text-xl font-semibold">
            Students
          </h2>
          <p className="text-sm text-muted">Open a student to see their projects, weekly scores, quizzes and assignments.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
            Pending reviews only
          </label>
          <input
            type="search"
            aria-label="Search students"
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="field w-64 max-w-full"
          />
        </div>
      </div>

      {students.length === 0 ? (
        <p className="card border-dashed p-8 text-center text-muted">No student has signed up yet. Students appear here once they create an account.</p>
      ) : shown.length === 0 ? (
        <p role="status" className="card border-dashed p-8 text-center text-muted">
          No student matches that search.
        </p>
      ) : (
        <>
          <p role="status" className="text-xs text-muted">
            Showing {shown.length} of {students.length}
          </p>
          <ul className="space-y-3">
            {shown.map((student) => (
              <StudentRow key={student.id} student={student} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
