"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchQueue, type QueueFilter } from "@/lib/api/client";
import type { QueueItem } from "@/lib/schemas/review";
import { quizTag, STATE_LABEL } from "./labels";

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
    <section aria-labelledby="queue-heading" className="space-y-4">
      <h2 id="queue-heading" className="text-lg font-semibold">
        Evaluations
      </h2>
      <p className="text-sm text-slate-600">
        The AI&apos;s score is only a recommendation. Your decision is the official result, and students see only
        what you approve.
      </p>

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => choose(f.value)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              filter === f.value
                ? "border-indigo-700 bg-indigo-700 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {load.status === "loading" && (
        <p role="status" className="text-slate-600">
          Loading evaluations…
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p>Could not load evaluations: {load.message}</p>
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
      {load.status === "ready" && load.items.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-slate-600">
          {filter === "pending_review" ? "Nothing is waiting for review." : "No evaluations match this filter."}
        </p>
      )}
      {load.status === "ready" && load.items.length > 0 && (
        <ul className="space-y-3">
          {groupByProject(load.items).map((group) => (
            <li key={group.projectId}>
              <details className="group rounded-lg border border-slate-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-medium [&::-webkit-details-marker]:hidden">
                  <span>{group.projectTitle}</span>
                  <span className="flex items-center gap-2 text-xs font-normal text-slate-600">
                    {group.weeks.length} {group.weeks.length === 1 ? "week" : "weeks"}
                    <span aria-hidden="true" className="text-base transition-transform group-open:rotate-180">
                      ▾
                    </span>
                  </span>
                </summary>

                <div className="space-y-2 border-t border-slate-100 p-3">
                  <ul className="space-y-2">
                    {group.weeks.map((item) => (
                      <li
                        key={item.evaluationId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-3 text-sm"
                      >
                        <div className="space-y-1">
                          <p className="font-medium">Week {item.weekNumber}</p>
                          <p className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-slate-800">{scoreText(item)}</span>
                            <span className="rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-900">
                              Quiz {quizTag(item.quiz)}
                            </span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                            {STATE_LABEL[item.status]}
                          </span>
                          <Link
                            href={`/faculty/evaluations/${item.evaluationId}`}
                            className="rounded-md border border-indigo-700 px-3 py-1 font-medium text-indigo-700 hover:bg-indigo-50"
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
                      className="rounded-md border border-slate-300 px-3 py-1 text-lg leading-none text-indigo-700 hover:bg-indigo-50"
                    >
                      <span aria-hidden="true">→</span>
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
