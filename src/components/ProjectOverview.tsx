"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchProjectOverview } from "@/lib/api/client";
import type { ProjectOverview as Overview, WeekOverview } from "@/lib/schemas/overview";
import { quizText, STATE_LABEL } from "./labels";

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
      <Link href="/faculty" className="text-sm text-indigo-700 hover:underline">
        ← Back to the faculty dashboard
      </Link>

      {load.status === "loading" && <p role="status">Loading project…</p>}
      {load.status === "missing" && (
        <p role="alert" className="rounded-md border border-slate-300 bg-white p-4">
          This project does not exist.
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p>Could not load the project: {load.message}</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className="mt-2 rounded-md border border-red-400 px-3 py-1 font-medium hover:bg-red-100"
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
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{project.title}</h1>
        <p className="text-sm text-slate-700">{project.description}</p>
        <p className="text-sm text-slate-600">
          Repository: {project.repoUrl} · {recorded} of {project.durationWeeks}{" "}
          {project.durationWeeks === 1 ? "week" : "weeks"} recorded
        </p>
      </header>

      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
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
    <li className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          Week {week.weekNumber}
          {week.title ? ` · ${week.title}` : ""}
        </h2>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">{STATE_LABEL[week.state]}</span>
      </div>

      {!recorded && <p className="text-slate-600">The student has not recorded this week yet.</p>}

      {recorded && (
        <>
          {week.recordedAt && (
            <p className="text-xs text-slate-600">Recorded {new Date(week.recordedAt).toLocaleString()}</p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Score label="Official score" value={officialText(week)} strong />
            <Score
              label="AI recommendation (not official)"
              value={week.suggestedScore === null ? "Not evaluated yet" : `${week.suggestedScore}/100${week.ai ? ` · confidence ${week.ai.confidence}` : ""}`}
            />
            <Score label="Student quiz" value={quizText(week.quiz)} />
          </div>

          {week.teacherFeedback && (
            <div>
              <h3 className="font-medium">Feedback shown to the student</h3>
              <p className="whitespace-pre-line text-slate-800">{week.teacherFeedback}</p>
            </div>
          )}
          {week.teacherComment && (
            <div>
              <h3 className="font-medium">Your private comment</h3>
              <p className="whitespace-pre-line text-slate-800">{week.teacherComment}</p>
            </div>
          )}

          {week.ai && (
            <div className="space-y-2 rounded-md bg-slate-50 p-3">
              <h3 className="font-medium">AI findings</h3>
              <TextList title="Completed" items={week.ai.completed} />
              <TextList title="Incomplete" items={week.ai.incomplete} />
              <TextList title="Technical concerns" items={week.ai.concerns} />
              <TextList title="AI's feedback for next week" items={week.ai.feedback} />
            </div>
          )}

          {week.evaluationId && (
            <Link
              href={`/faculty/evaluations/${week.evaluationId}`}
              className="inline-block rounded-md border border-indigo-700 px-3 py-1.5 font-medium text-indigo-700 hover:bg-indigo-50"
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
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-xs text-slate-600">{label}</p>
      <p className={strong ? "text-base font-semibold" : "text-sm font-medium"}>{value}</p>
    </div>
  );
}

function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-medium uppercase tracking-wide text-slate-600">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
