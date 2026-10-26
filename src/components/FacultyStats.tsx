"use client";

import { useEffect, useState } from "react";
import { fetchQueue } from "@/lib/api/client";
import type { QueueItem } from "@/lib/schemas/review";
import { Icon, ScoreCard, StatCard, WeekScoreBars } from "./ui";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; items: QueueItem[] };

const average = (numbers: number[]) =>
  numbers.length === 0 ? null : Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 10) / 10;

/**
 * Numbers for the top of the faculty dashboard, all worked out from the real queue:
 * nothing is estimated and nothing is shown for data that does not exist yet.
 */
export function FacultyStats() {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchQueue("all").then(
      (items) => {
        if (!cancelled) setLoad({ status: "ready", items });
      },
      () => {
        if (!cancelled) setLoad({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (load.status === "loading") {
    return (
      <p role="status" className="text-muted">
        Loading summary…
      </p>
    );
  }
  if (load.status === "error") {
    return <p className="text-sm text-muted">The summary could not be loaded. The review list below still works.</p>;
  }

  const { items } = load;
  const waiting = items.filter((i) => i.status === "pending_review").length;
  const decided = items.filter((i) => i.status !== "pending_review");
  const scores = decided.flatMap((i) => (i.officialScore === null ? [] : [i.officialScore]));
  const projects = new Set(items.map((i) => i.projectId)).size;
  const taken = items.flatMap((i) => (i.quiz.status === "taken" && i.quiz.total ? [(i.quiz.correctCount ?? 0) / i.quiz.total] : []));
  const quizAverage = average(taken.map((fraction) => fraction * 100));

  // The average official score of each week number across all projects.
  const lastWeek = Math.max(0, ...decided.map((i) => i.weekNumber));
  const byWeek = Array.from({ length: lastWeek }, (_, i) => ({
    weekNumber: i + 1,
    score: average(decided.filter((d) => d.weekNumber === i + 1).flatMap((d) => (d.officialScore === null ? [] : [d.officialScore]))),
  }));

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ScoreCard
            hero
            label="Average official score"
            score={average(scores)}
            empty="No reviewed weeks yet"
            caption={
              scores.length === 0
                ? "Scores appear here once you have reviewed a week."
                : `Across ${scores.length} reviewed ${scores.length === 1 ? "week" : "weeks"} in ${projects} ${projects === 1 ? "project" : "projects"}. Only your official scores are counted, never the AI's.`
            }
          >
            {byWeek.length > 0 && (
              <div>
                <p className="eyebrow mb-2">Average official score by week</p>
                <WeekScoreBars weeks={byWeek} />
              </div>
            )}
          </ScoreCard>
        </div>
        <section aria-label="Pending reviews" className="card flex flex-col justify-between gap-5 p-6">
          <div>
            <p className="eyebrow">Pending reviews</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-5xl font-bold tabular-nums tracking-tight">{waiting}</span>
              <span className="text-xl font-medium text-muted">{waiting === 1 ? "week" : "weeks"}</span>
            </p>
            <p className="mt-2 text-sm text-muted">
              {waiting === 0 ? "Nothing is waiting for your review." : "Waiting for your decision. Open a project below to review."}
            </p>
          </div>
          <p>
            {waiting === 0 ? (
              <span className="badge-success">
                <Icon name="check" className="h-3.5 w-3.5" />
                All caught up
              </span>
            ) : (
              <span className="badge-warning">
                <Icon name="clock" className="h-3.5 w-3.5" />
                {waiting} to review
              </span>
            )}
          </p>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Projects" value={projects} hint="with an evaluation" />
        <StatCard label="Reviewed weeks" value={decided.length} hint="approved, edited or rejected" />
        <StatCard label="Quizzes taken" value={taken.length} hint={`of ${items.filter((i) => i.quiz.status !== "not_created").length} created`} />
        <StatCard label="Quiz average" value={quizAverage === null ? "–" : `${quizAverage}%`} hint="share of questions answered correctly" />
      </div>
    </div>
  );
}
