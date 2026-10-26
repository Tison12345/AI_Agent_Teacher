import type { ReactNode } from "react";

/** The few icons the interface uses, drawn inline so no icon library is needed. */
const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5",
  student: "M12 3 2 8l10 5 10-5-10-5ZM6 10.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5",
  faculty: "M9 5h6M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1ZM6 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M9 14l2 2 4-4",
  arrow: "M5 12h14M13 6l6 6-6 6",
  check: "m5 12.5 4.5 4.5L19 7.5",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  repo: "M8 7 3 12l5 5M16 7l5 5-5 5M14 4l-4 16",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Page title, a line of context and optional actions. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** A compact statistic. Secondary to the large score cards. */
export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A horizontal bar for a real fraction. `percent` is clamped to 0-100. */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="progress">
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

/**
 * The large score card. `hero` makes it the visual focus of a page. When `score` is null
 * there is no number to show, and the card says why instead of inventing one.
 */
export function ScoreCard({
  label,
  score,
  max = 100,
  caption,
  empty,
  hero = false,
  children,
}: {
  label: string;
  score: number | null;
  max?: number;
  caption?: ReactNode;
  empty?: string;
  hero?: boolean;
  children?: ReactNode;
}) {
  const percent = score === null ? 0 : (score / max) * 100;
  return (
    <section
      aria-label={label}
      className={`${hero ? "card-hero p-7 sm:p-8" : "card p-6"} flex flex-col justify-between gap-5`}
    >
      <div>
        <p className="eyebrow">{label}</p>
        {score === null ? (
          <p className="mt-3 text-lg font-medium text-muted">{empty ?? "No score yet"}</p>
        ) : (
          <p className="mt-2 flex items-baseline gap-2" aria-label={`${label}: ${score} out of ${max}`}>
            <span className={`${hero ? "text-6xl sm:text-7xl" : "text-5xl"} font-bold tabular-nums tracking-tight`}>
              {score}
            </span>
            <span className="text-xl font-medium text-muted">/ {max}</span>
          </p>
        )}
        {caption && <p className="mt-2 text-sm text-muted">{caption}</p>}
      </div>
      {score !== null && <ProgressBar percent={percent} label={`${label} as a percentage`} />}
      {children}
    </section>
  );
}

/** Bars for the official result of each week. Weeks without one show a dash, not a made-up value. */
export function WeekScoreBars({
  weeks,
}: {
  weeks: { weekNumber: number; score: number | null; note?: string }[];
}) {
  return (
    <div role="group" className="flex items-end gap-2 sm:gap-3" aria-label="Official result by week">
      {weeks.map((w) => (
        <div key={w.weekNumber} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <span className="text-xs font-semibold tabular-nums">{w.score === null ? "–" : w.score}</span>
          <div className="flex h-24 w-full items-end overflow-hidden rounded-2xl bg-canvas/70">
            {w.score !== null && (
              <div
                className="w-full rounded-2xl"
                style={{
                  height: `${Math.max(4, Math.min(100, w.score))}%`,
                  backgroundImage: "linear-gradient(180deg, var(--color-accent), var(--color-primary))",
                }}
              />
            )}
          </div>
          <span className="text-xs text-muted">
            W{w.weekNumber}
            <span className="sr-only">
              {w.score === null ? ` has no official result${w.note ? ` (${w.note})` : ""}` : `: ${w.score} out of 100`}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
