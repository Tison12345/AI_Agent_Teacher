"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchProjectOverview } from "@/lib/api/client";
import type { ProjectOverview as Overview, WeekOverview } from "@/lib/schemas/overview";
import { quizText, STATE_BADGE, STATE_LABEL } from "./labels";
import { ProgressBar, ScoreCard, WeekScoreBars } from "./ui";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "missing" }
  | { status: "ready"; overview: Overview };

/** Faculty: one project, every week, with scores, feedback and quiz results. */
export function ProjectOverview({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchProjectOverview(id).then(
      (overview) => {
        if (!cancelled) setLoad(overview ? { status: "ready", overview } : { status: "missing" });
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the project." });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  return (
    <div className="space-y-5">
      <Link href="/faculty" className="inline-flex text-sm font-medium text-link hover:text-fg">
        ← Back to the faculty dashboard
      </Link>

      {load.status === "loading" && <p role="status">Loading project…</p>}
      {load.status === "missing" && (
        <p role="alert" className="card p-5">
          This project does not exist.
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="alert-danger">
          <p>Could not load the project: {load.message}</p>
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
      {load.status === "ready" && <Detail overview={load.overview} />}
    </div>
  );
}

function Detail({ overview }: { overview: Overview }) {
  const { project, weeks } = overview;
  const recorded = weeks.filter((w) => w.state !== "not_recorded").length;
  const scored = weeks.flatMap((w) => (w.officialScore === null ? [] : [w.officialScore]));
  const average = scored.length === 0 ? null : Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10;
  const reviewed = weeks.filter((w) => ["approved", "edited", "rejected"].includes(w.state)).length;
  const waiting = weeks.filter((w) => w.state === "pending_review").length;
  const quizzes = weeks.filter((w) => w.quiz.status === "taken");
  return (
    <>
      <header className="space-y-1.5">
        <p className="eyebrow">Project overview</p>
        <h1 className="text-3xl font-bold tracking-tight">{project.title}</h1>
        <p className="max-w-3xl text-muted">{project.description}</p>
        <p className="text-sm text-muted">
          Repository: {project.repoUrl} · {recorded} of {project.durationWeeks}{" "}
          {project.durationWeeks === 1 ? "week" : "weeks"} recorded
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ScoreCard
            hero
            label="Average official score"
            score={average}
            empty="No reviewed weeks yet"
            caption={
              average === null
                ? "Your official scores appear here after you review a week."
                : `Average of ${scored.length} official ${scored.length === 1 ? "score" : "scores"} out of ${project.durationWeeks} ${project.durationWeeks === 1 ? "week" : "weeks"}. Not a final grade.`
            }
          >
            <WeekScoreBars
              weeks={weeks.map((w) => ({ weekNumber: w.weekNumber, score: w.officialScore, note: STATE_LABEL[w.state] }))}
            />
          </ScoreCard>
        </div>
        <section aria-label="Review progress" className="card flex flex-col justify-between gap-5 p-6">
          <div>
            <p className="eyebrow">Weeks reviewed</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-5xl font-bold tabular-nums tracking-tight">{reviewed}</span>
              <span className="text-xl font-medium text-muted">of {project.durationWeeks}</span>
            </p>
          </div>
          <ProgressBar percent={(reviewed / project.durationWeeks) * 100} label="Weeks reviewed as a percentage of the project" />
          <p className="flex flex-wrap gap-2">
            {waiting > 0 && <span className="badge-warning">{waiting} waiting for review</span>}
            <span className="badge-primary">
              {quizzes.length} {quizzes.length === 1 ? "quiz" : "quizzes"} taken
            </span>
          </p>
        </section>
      </div>

      <p className="alert-warning">
        The AI&apos;s score is only a <strong>recommendation</strong>. The official score is the one you set. The student
        quiz is separate evidence of understanding and is not part of either score.
      </p>

      <ol className="space-y-4">
        {weeks.map((week) => (
          <WeekCard key={week.weekNumber} week={week} />
        ))}
      </ol>
    </>
  );
}

function WeekCard({ week }: { week: WeekOverview }) {
  const recorded = week.state !== "not_recorded";
  return (
    <li className="card space-y-4 p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Week {week.weekNumber}
          {week.title ? ` · ${week.title}` : ""}
        </h2>
        <span className={STATE_BADGE[week.state]}>{STATE_LABEL[week.state]}</span>
      </div>

      {!recorded && <p className="text-muted">The student has not recorded this week yet.</p>}

      {recorded && (
        <>
          {week.recordedAt && (
            <p className="text-xs text-muted">Recorded {new Date(week.recordedAt).toLocaleString()}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Score label="Official score" value={officialText(week)} strong />
            <Score
              label="AI recommendation (not official)"
              value={week.suggestedScore === null ? "Not evaluated yet" : `${week.suggestedScore}/100${week.ai ? ` · confidence ${week.ai.confidence}` : ""}`}
            />
            <Score label="Student quiz" value={quizText(week.quiz)} />
          </div>

          {week.teacherFeedback && (
            <div>
              <h3 className="eyebrow mb-1">Feedback shown to the student</h3>
              <p className="whitespace-pre-line text-fg">{week.teacherFeedback}</p>
            </div>
          )}
          {week.teacherComment && (
            <div>
              <h3 className="eyebrow mb-1">Your private comment</h3>
              <p className="whitespace-pre-line text-fg">{week.teacherComment}</p>
            </div>
          )}

          {week.ai && (
            <div className="well space-y-3 p-4">
              <h3 className="font-semibold">AI findings</h3>
              <TextList title="Completed" items={week.ai.completed} />
              <TextList title="Incomplete" items={week.ai.incomplete} />
              <TextList title="Technical concerns" items={week.ai.concerns} />
              <TextList title="AI's feedback for next week" items={week.ai.feedback} />
            </div>
          )}

          {week.evaluationId && (
            <Link
              href={`/faculty/evaluations/${week.evaluationId}`}
              className={week.state === "pending_review" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
            >
              {week.state === "pending_review" ? "Review this week" : "Open full review"}
              <span className="sr-only"> for week {week.weekNumber}</span>
            </Link>
          )}
        </>
      )}
    </li>
  );
}

function officialText(week: WeekOverview): string {
  if (week.state === "approved" || week.state === "edited") {
    return week.officialScore === null ? "No official score" : `${week.officialScore}/100`;
  }
  if (week.state === "rejected") return "None (rejected)";
  return week.state === "pending_review" ? "Waiting for your review" : "Not evaluated yet";
}

function Score({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`well p-4 ${strong ? "border-primary/40" : ""}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className={strong ? "mt-0.5 text-xl font-bold" : "mt-0.5 text-sm font-semibold"}>{value}</p>
    </div>
  );
}

function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="eyebrow">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-fg">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
