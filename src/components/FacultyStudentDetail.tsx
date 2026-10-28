"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchStudent } from "@/lib/api/client";
import { average, repoName } from "@/lib/dashboard/summary";
import type { StudentDetail, StudentProject, StudentSubmissionRow } from "@/lib/students/types";
import { UNASSIGNED_ID } from "@/lib/students/types";
import { STATE_BADGE, STATE_LABEL } from "./labels";
import { PairBars, type PairRow } from "./PairBars";
import { FACULTY_STATUS } from "./submission-labels";
import { Icon, StatCard } from "./ui";

const pct = (value: number | null) => (value === null ? "–" : `${value}%`);
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "–");
const percentOf = (marks: number | null, max: number) => (marks === null || max <= 0 ? null : Math.round((marks / max) * 1000) / 10);

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "missing" } | { status: "ready"; student: StudentDetail };

/** Faculty: one student's performance across projects, weekly evaluations, quizzes and assignments. */
export function FacultyStudentDetail({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchStudent(id).then(
      (student) => {
        if (!cancelled) setLoad(student ? { status: "ready", student } : { status: "missing" });
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the student." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  return (
    <div className="space-y-8">
      <Link href="/faculty" className="inline-flex text-sm font-medium text-link hover:text-fg">
        ← Back to the dashboard
      </Link>
      {load.status === "loading" && <p role="status">Loading student…</p>}
      {load.status === "missing" && (
        <p role="alert" className="card p-5">
          This student does not exist.
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="alert-danger">
          <p>Could not load the student: {load.message}</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className="btn-secondary btn-sm mt-3"
          >
            Try again
          </button>
        </div>
      )}
      {load.status === "ready" && <Profile student={load.student} />}
    </div>
  );
}

function Profile({ student }: { student: StudentDetail }) {
  const { summary, projects, assignments } = student;
  const waiting = summary.weeklyPending + summary.assignmentPending;
  const submitted = assignments.filter((a) => a.submissionId !== null);

  return (
    <>
      <header className="space-y-2">
        <p className="eyebrow">Student</p>
        <h1 className="text-3xl font-bold tracking-tight">{summary.name}</h1>
        <p className="flex flex-wrap items-center gap-2">
          {summary.email && <span className="badge-neutral">{summary.email}</span>}
          {summary.joinedAt && <span className="badge-neutral">Joined {date(summary.joinedAt)}</span>}
          <span className="badge-neutral">
            {summary.projectCount} {summary.projectCount === 1 ? "project" : "projects"}
          </span>
        </p>
      </header>

      {summary.id === UNASSIGNED_ID && (
        <p role="note" className="alert-info text-sm">
          This is work that was created before accounts existed, so it could not be linked to a student. Nothing here was guessed.
        </p>
      )}

      <section aria-label="Score summary" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard icon="chart" label="Average official score" value={pct(summary.averageOfficial)} hint={summary.averageOfficial === null ? "no approved scores yet" : "approved results only"} />
        <StatCard icon="repo" label="Project average" value={pct(summary.projectAverage)} hint="weekly scores you approved" />
        <StatCard icon="doc" label="Assignment average" value={pct(summary.assignmentAverage)} hint="marks you approved, as a percentage" />
        <StatCard icon="clock" label="Pending reviews" value={waiting} hint={waiting === 0 ? "all caught up" : `${summary.weeklyPending} weekly, ${summary.assignmentPending} assignment`} />
        <StatCard icon="check" label="Weeks recorded" value={summary.weeksRecorded} hint={`${summary.assignmentsSubmitted} ${summary.assignmentsSubmitted === 1 ? "assignment" : "assignments"} submitted`} />
      </section>

      <PendingReviews projects={projects} assignments={assignments} />
      <Charts projects={projects} submitted={submitted} />
      <Projects projects={projects} />
      <Assignments assignments={assignments} />
    </>
  );
}

function PendingReviews({ projects, assignments }: { projects: StudentProject[]; assignments: StudentSubmissionRow[] }) {
  const weeks = projects.flatMap((p) => p.weeks.filter((w) => w.evaluation?.status === "pending_review").map((w) => ({ project: p, week: w })));
  const subs = assignments.filter((a) => a.status === "awaiting_review" && a.submissionId);
  if (weeks.length === 0 && subs.length === 0) return null;
  return (
    <section aria-labelledby="pending-heading" className="card space-y-3 p-6">
      <h2 id="pending-heading" className="text-lg font-semibold">
        Waiting for your review
      </h2>
      <ul className="divide-y divide-line text-sm">
        {weeks.map(({ project, week }) => (
          <li key={week.checkpointId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span>
              {project.title}, week {week.weekNumber}
              <span className="ml-2 text-muted">AI recommendation {week.evaluation?.aiScore}/100 (not official)</span>
            </span>
            <Link href={`/faculty/evaluations/${week.evaluation?.id}`} className="btn-primary btn-sm">
              Review
              <span className="sr-only">
                {" "}
                {project.title} week {week.weekNumber}
              </span>
            </Link>
          </li>
        ))}
        {subs.map((a) => (
          <li key={a.submissionId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span>
              {a.assignmentTitle}
              <span className="ml-2 text-muted">
                AI recommendation {a.aiTotal ?? "–"}/{a.maxMarks} (not official)
              </span>
            </span>
            <Link href={`/faculty/submissions/${a.submissionId}`} className="btn-primary btn-sm">
              Review
              <span className="sr-only"> {a.assignmentTitle}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Charts({ projects, submitted }: { projects: StudentProject[]; submitted: StudentSubmissionRow[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];

  const projectRows: PairRow[] = projects.map((p) => ({
    key: p.id,
    label: p.title,
    official: p.averageOfficial,
    ai: average(p.weeks.flatMap((w) => (w.evaluation ? [w.evaluation.aiScore] : []))),
    note: p.weeks.length === 0 ? "No weeks" : "Not official yet",
  }));
  const weekRows: PairRow[] = (selected?.weeks ?? []).map((w) => ({
    key: w.checkpointId,
    label: `Week ${w.weekNumber}`,
    official: w.evaluation?.officialScore ?? null,
    ai: w.evaluation?.aiScore ?? null,
    note: !w.evaluation ? "Not evaluated" : w.evaluation.status === "pending_review" ? "Awaiting review" : w.evaluation.status === "rejected" ? "Rejected" : "Not official",
  }));
  const assignmentRows: PairRow[] = submitted.map((a) => ({
    key: a.submissionId ?? a.assignmentId,
    label: a.assignmentTitle,
    official: percentOf(a.officialTotal, a.maxMarks),
    ai: percentOf(a.aiTotal, a.maxMarks),
    note: a.status === "awaiting_review" ? "Awaiting review" : (FACULTY_STATUS[a.status as keyof typeof FACULTY_STATUS]?.label ?? "No marks"),
  }));

  if (projectRows.length === 0 && assignmentRows.length === 0) return null;
  return (
    <section aria-labelledby="charts-heading" className="space-y-4">
      <h2 id="charts-heading" className="text-xl font-semibold">
        Performance
      </h2>
      <div className="grid gap-5 lg:grid-cols-2">
        {projectRows.length > 0 && (
          <div className="card space-y-4 p-6">
            <div>
              <h3 className="eyebrow mb-1">Project-wise average</h3>
              <p className="text-sm text-muted">Score out of 100, averaged over each project&apos;s weeks.</p>
            </div>
            <PairBars rows={projectRows} title="Project-wise average" />
          </div>
        )}
        {selected && weekRows.length > 0 && (
          <div className="card space-y-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="eyebrow mb-1">Week-wise scores</h3>
                <p className="text-sm text-muted">Score out of 100 for each recorded week.</p>
              </div>
              {projects.length > 1 && (
                <label className="text-sm text-muted">
                  <span className="sr-only">Project for the week-wise chart</span>
                  <select value={selected.id} onChange={(e) => setProjectId(e.target.value)} className="field">
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <PairBars rows={weekRows} title={`Week-wise scores for ${selected.title}`} />
          </div>
        )}
        {assignmentRows.length > 0 && (
          <div className="card space-y-4 p-6 lg:col-span-2">
            <div>
              <h3 className="eyebrow mb-1">Assignments</h3>
              <p className="text-sm text-muted">Marks as a percentage of each assignment&apos;s total.</p>
            </div>
            <PairBars rows={assignmentRows} title="Assignment marks" />
          </div>
        )}
      </div>
    </section>
  );
}

function Projects({ projects }: { projects: StudentProject[] }) {
  return (
    <section aria-labelledby="projects-heading" className="space-y-4">
      <h2 id="projects-heading" className="text-xl font-semibold">
        Projects and weekly checkpoints
      </h2>
      {projects.length === 0 ? (
        <p className="card border-dashed p-8 text-center text-muted">This student has not created a project yet.</p>
      ) : (
        <ul className="space-y-5">
          {projects.map((project) => (
            <li key={project.id} className="card space-y-4 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5">
                  <h3 className="text-lg font-semibold leading-snug">{project.title}</h3>
                  <p className="flex flex-wrap items-center gap-2">
                    <a href={project.repoUrl} target="_blank" rel="noopener noreferrer" className="badge-neutral hover:text-fg">
                      <Icon name="repo" className="h-3.5 w-3.5" />
                      <span className="max-w-[18rem] truncate">{repoName(project.repoUrl)}</span>
                      <span className="sr-only"> (opens GitHub in a new tab)</span>
                    </a>
                    <span className="badge-neutral">
                      {project.durationWeeks} {project.durationWeeks === 1 ? "week" : "weeks"}
                    </span>
                    <span className="badge-neutral">Average {pct(project.averageOfficial)}</span>
                  </p>
                </div>
                <Link href={`/faculty/projects/${project.id}`} className="btn-secondary btn-sm">
                  Project overview
                  <span className="sr-only"> for {project.title}</span>
                </Link>
              </div>

              {project.weeks.length === 0 ? (
                <p className="text-sm text-muted">No week has been recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[44rem] text-left text-sm">
                    <caption className="sr-only">Weekly checkpoints for {project.title}</caption>
                    <thead className="eyebrow">
                      <tr>
                        <th scope="col" className="py-2 pr-3">Week</th>
                        <th scope="col" className="py-2 pr-3">Recorded</th>
                        <th scope="col" className="py-2 pr-3">Changes</th>
                        <th scope="col" className="py-2 pr-3">AI recommendation</th>
                        <th scope="col" className="py-2 pr-3">Official score</th>
                        <th scope="col" className="py-2 pr-3">Status</th>
                        <th scope="col" className="py-2 pr-3">Quiz</th>
                        <th scope="col" className="py-2"><span className="sr-only">Action</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {project.weeks.map((week) => {
                        const evaluation = week.evaluation;
                        const state = evaluation ? evaluation.status : "not_evaluated";
                        return (
                          <tr key={week.checkpointId}>
                            <th scope="row" className="py-2.5 pr-3 font-semibold">{week.weekNumber}</th>
                            <td className="py-2.5 pr-3 text-muted">{date(week.recordedAt)}</td>
                            <td className="py-2.5 pr-3 text-muted">
                              {week.filesChanged} {week.filesChanged === 1 ? "file" : "files"} (+{week.additions} −{week.deletions})
                            </td>
                            <td className="py-2.5 pr-3 tabular-nums">
                              {evaluation ? (
                                <>
                                  {evaluation.aiScore}
                                  <span className="ml-1 text-xs text-muted">not official</span>
                                </>
                              ) : (
                                "–"
                              )}
                            </td>
                            <td className="py-2.5 pr-3 font-semibold tabular-nums">
                              {evaluation?.officialScore != null ? evaluation.officialScore : <span className="font-normal text-muted">–</span>}
                            </td>
                            <td className="py-2.5 pr-3">
                              <span className={STATE_BADGE[state]}>{STATE_LABEL[state]}</span>
                            </td>
                            <td className="py-2.5 pr-3 text-muted">
                              {week.quiz ? `${week.quiz.correctCount}/${week.quiz.total} correct` : week.quizCreated ? "Not taken" : "No quiz"}
                            </td>
                            <td className="py-2.5 text-right">
                              {evaluation && (
                                <Link href={`/faculty/evaluations/${evaluation.id}`} className={evaluation.status === "pending_review" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
                                  {evaluation.status === "pending_review" ? "Review" : "Open"}
                                  <span className="sr-only">
                                    {" "}
                                    {project.title} week {week.weekNumber}
                                  </span>
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Assignments({ assignments }: { assignments: StudentSubmissionRow[] }) {
  return (
    <section aria-labelledby="assignments-heading" className="space-y-4">
      <h2 id="assignments-heading" className="text-xl font-semibold">
        Assignment submissions
      </h2>
      {assignments.length === 0 ? (
        <p className="card border-dashed p-8 text-center text-muted">There are no assignments yet.</p>
      ) : (
        <div className="card overflow-x-auto p-6">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <caption className="sr-only">Assignment submissions</caption>
            <thead className="eyebrow">
              <tr>
                <th scope="col" className="py-2 pr-3">Assignment</th>
                <th scope="col" className="py-2 pr-3">Status</th>
                <th scope="col" className="py-2 pr-3">Submitted</th>
                <th scope="col" className="py-2 pr-3">AI recommendation</th>
                <th scope="col" className="py-2 pr-3">Official marks</th>
                <th scope="col" className="py-2 pr-3">Feedback</th>
                <th scope="col" className="py-2"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {assignments.map((a) => {
                const status = a.status === "not_submitted" ? null : FACULTY_STATUS[a.status];
                return (
                  <tr key={a.submissionId ?? `none-${a.assignmentId}`} className="align-top">
                    <th scope="row" className="py-2.5 pr-3 font-semibold">{a.assignmentTitle}</th>
                    <td className="py-2.5 pr-3">
                      <span className={status ? status.badge : "badge-neutral"}>{status ? status.label : "Not submitted"}</span>
                      {a.error && <p className="mt-1 max-w-[16rem] text-xs text-muted">{a.error}</p>}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">{date(a.submittedAt)}</td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {a.aiTotal === null ? "–" : (
                        <>
                          {a.aiTotal}/{a.maxMarks}
                          <span className="ml-1 text-xs text-muted">not official</span>
                        </>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold tabular-nums">
                      {a.officialTotal === null ? <span className="font-normal text-muted">–</span> : `${a.officialTotal}/${a.maxMarks}`}
                    </td>
                    <td className="max-w-[18rem] py-2.5 pr-3 text-muted">
                      <span className="line-clamp-3 whitespace-pre-line">{a.feedback ?? "–"}</span>
                    </td>
                    <td className="py-2.5 text-right">
                      {a.submissionId && (
                        <Link
                          href={`/faculty/submissions/${a.submissionId}`}
                          className={a.status === "awaiting_review" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                        >
                          {a.status === "awaiting_review" ? "Review" : "Open"}
                          <span className="sr-only"> {a.assignmentTitle}</span>
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

