import { average } from "@/lib/dashboard/summary";
import type { QueueItem } from "@/lib/schemas/review";
import { WeekScoreBars } from "./ui";

const STATUSES = [
  { status: "pending_review", label: "Waiting for review", bar: "bg-warning" },
  { status: "approved", label: "Approved", bar: "bg-official" },
  { status: "edited", label: "Edited", bar: "bg-violet" },
  { status: "rejected", label: "Rejected", bar: "bg-danger" },
] as const;

/** Charts from the real evaluations: the average official score of each week number, and where every evaluation stands. */
export function FacultyAnalytics({ items }: { items: QueueItem[] }) {
  const decided = items.filter((i) => i.status !== "pending_review");
  const lastWeek = Math.max(0, ...items.map((i) => i.weekNumber));
  const byWeek = Array.from({ length: lastWeek }, (_, i) => {
    const weekNumber = i + 1;
    const scores = decided.flatMap((d) => (d.weekNumber === weekNumber && d.officialScore !== null ? [d.officialScore] : []));
    const waiting = items.some((x) => x.weekNumber === weekNumber && x.status === "pending_review");
    return { weekNumber, score: average(scores), note: waiting ? "Awaiting review" : "No scores" };
  });
  const counts = STATUSES.map((s) => ({ ...s, count: items.filter((i) => i.status === s.status).length }));

  return (
    <section aria-labelledby="analytics-heading" className="space-y-4">
      <h2 id="analytics-heading" className="text-xl font-semibold">
        Analytics
      </h2>
      {items.length === 0 ? (
        <p className="card border-dashed p-8 text-center text-muted">
          Charts appear here once a student has recorded a week and it has been evaluated.
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="card p-6 lg:col-span-3">
            <h3 className="eyebrow mb-1">Average official score by week</h3>
            <p className="mb-4 text-sm text-muted">Across all projects. Only your official scores are counted, never the AI&apos;s.</p>
            <WeekScoreBars weeks={byWeek} />
          </div>
          <div className="card p-6 lg:col-span-2">
            <h3 className="eyebrow mb-1">Review status</h3>
            <p className="mb-4 text-sm text-muted">
              {items.length} {items.length === 1 ? "evaluation" : "evaluations"} in total.
            </p>
            <div
              role="img"
              aria-label={counts.map((c) => `${c.label}: ${c.count}`).join(", ")}
              className="flex h-4 w-full overflow-hidden rounded-full bg-canvas/80"
            >
              {counts
                .filter((c) => c.count > 0)
                .map((c) => (
                  <span key={c.status} className={c.bar} style={{ width: `${(c.count / items.length) * 100}%` }} />
                ))}
            </div>
            <dl className="mt-5 space-y-2.5 text-sm">
              {counts.map((c) => (
                <div key={c.status} className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2">
                    <span aria-hidden="true" className={`h-3 w-3 rounded-sm ${c.bar}`} />
                    {c.label}
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {c.count}
                    <span className="ml-1.5 text-xs font-normal text-muted">
                      {Math.round((c.count / items.length) * 100)}%
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}
