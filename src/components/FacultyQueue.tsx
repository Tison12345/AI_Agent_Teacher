"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchQueue, type QueueFilter } from "@/lib/api/client";
import type { QueueItem } from "@/lib/schemas/review";
import { quizTag, STATE_BADGE, STATE_LABEL } from "./labels";
import { Icon } from "./ui";

const FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "pending_review", label: "Waiting for review" },
  { value: "approved", label: "Approved" },
  { value: "edited", label: "Edited" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

/** One project with the weeks that match the filter, in week order. Projects keep the queue's order. */
type ProjectGroup = { projectId: string; projectTitle: string; weeks: QueueItem[] };

function groupByProject(items: QueueItem[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const item of items) {
    const group = groups.get(item.projectId) ?? { projectId: item.projectId, projectTitle: item.projectTitle, weeks: [] };
    group.weeks.push(item);
    groups.set(item.projectId, group);
  }
  return [...groups.values()].map((g) => ({ ...g, weeks: [...g.weeks].sort((a, b) => a.weekNumber - b.weekNumber) }));
}

/** The score a week's card shows: the teacher's official score once decided, otherwise the AI's, labelled. */
function scoreText(item: QueueItem): string {
  if (item.status === "pending_review") return `AI suggestion ${item.suggestedScore}/100 (not official)`;
  return item.officialScore === null ? "No official score" : `Score ${item.officialScore}/100`;
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: QueueItem[] };

export function FacultyQueue() {
  const [filter, setFilter] = useState<QueueFilter>("pending_review");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchQueue(filter).then(
      (items) => {
        if (!cancelled) setLoad({ status: "ready", items });
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the queue." });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [filter, attempt]);

  function choose(next: QueueFilter) {
    if (next === filter) return;
    setLoad({ status: "loading" });
    setFilter(next);
  }

  return (
    <section aria-labelledby="queue-heading" className="space-y-5">
      <div className="space-y-1">
        <h2 id="queue-heading" className="text-xl font-semibold">
          Evaluations
        </h2>
        <p className="text-sm text-muted">
          The AI&apos;s score is only a recommendation. Your decision is the official result, and students see only
          what you approve.
        </p>
      </div>

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => choose(f.value)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition duration-150 ${
              filter === f.value
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-line bg-card text-muted hover:border-primary/50 hover:text-fg"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {load.status === "loading" && (
        <p role="status" className="text-muted">
          Loading evaluations…
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="alert-danger">
          <p>Could not load evaluations: {load.message}</p>
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
      {load.status === "ready" && load.items.length === 0 && (
        <p className="card border-dashed p-8 text-center text-muted">
          {filter === "pending_review" ? "Nothing is waiting for review." : "No evaluations match this filter."}
        </p>
      )}
      {load.status === "ready" && load.items.length > 0 && (
        <ul className="space-y-4">
          {groupByProject(load.items).map((group) => (
            <li key={group.projectId}>
              <details className="card group transition duration-150 open:border-primary/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-5 text-lg font-semibold transition duration-150 hover:bg-card-hover [&::-webkit-details-marker]:hidden">
                  <span>{group.projectTitle}</span>
                  <span className="flex items-center gap-3 text-xs font-normal text-muted">
                    <span className="badge-neutral">
                      {group.weeks.length} {group.weeks.length === 1 ? "week" : "weeks"}
                    </span>
                    <span aria-hidden="true" className="text-base transition-transform group-open:rotate-180">
                      ▾
                    </span>
                  </span>
                </summary>

                <div className="space-y-3 border-t border-line p-4">
                  <ul className="space-y-3">
                    {group.weeks.map((item) => (
                      <li
                        key={item.evaluationId}
                        className="well flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
                      >
                        <div className="space-y-1.5">
                          <p className="text-base font-semibold">Week {item.weekNumber}</p>
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-medium text-fg">{scoreText(item)}</span>
                            <span className="badge-primary">Quiz {quizTag(item.quiz)}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={STATE_BADGE[item.status]}>{STATE_LABEL[item.status]}</span>
                          <Link
                            href={`/faculty/evaluations/${item.evaluationId}`}
                            className={item.status === "pending_review" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                          >
                            {item.status === "pending_review" ? "Review" : "View"}
                            <span className="sr-only">
                              {" "}
                              {item.projectTitle} week {item.weekNumber}
                            </span>
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-end">
                    <Link
                      href={`/faculty/projects/${group.projectId}`}
                      className="btn-secondary btn-sm text-link"
                    >
                      <Icon name="arrow" className="h-4 w-4" />
                      <span className="sr-only">Open the overview of {group.projectTitle}</span>
                    </Link>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
