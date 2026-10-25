"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchQueue, type QueueFilter } from "@/lib/api/client";
import type { QueueItem } from "@/lib/schemas/review";

const FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "pending_review", label: "Waiting for review" },
  { value: "approved", label: "Approved" },
  { value: "edited", label: "Edited" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const STATUS_LABEL: Record<QueueItem["status"], string> = {
  pending_review: "Waiting for review",
  approved: "Approved",
  edited: "Edited",
  rejected: "Rejected",
};

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
        <ul className="space-y-2">
          {load.items.map((item) => (
            <li
              key={item.evaluationId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm"
            >
              <div>
                <p className="font-medium">
                  {item.projectTitle} · Week {item.weekNumber}
                </p>
                <p className="text-xs text-slate-600">
                  AI suggestion (not official): {item.suggestedScore}/100 · confidence {item.confidence} · created{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                  {STATUS_LABEL[item.status]}
                </span>
                <Link
                  href={`/faculty/evaluations/${item.evaluationId}`}
                  className="rounded-md border border-indigo-700 px-3 py-1.5 font-medium text-indigo-700 hover:bg-indigo-50"
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
      )}
    </section>
  );
}
