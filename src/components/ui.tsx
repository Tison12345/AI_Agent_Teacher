"use client";

import { useId, useState, type ReactNode } from "react";

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
  chevron: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
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

/** A dashboard statistic: a large number, a short label, an optional icon and a line of context. */
export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: IconName;
}) {
  return (
    <div className="card flex h-full flex-col gap-1 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">{label}</p>
        {icon && (
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-accent">
            <Icon name={icon} className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-auto pt-1 text-sm text-muted">{hint}</p>}
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


export type WeekBar = {
  weekNumber: number;
  /** The official score, or null when the week has none. A score of 0 is a real score. */
  score: number | null;
  /** Why there is no score ("Not recorded", "Awaiting review"). Shown in place of a number. */
  note?: string;
};

const AXIS_TICKS = [0, 25, 50, 75, 100];

/**
 * Horizontal bars for the official result of each week, all on one 0-100 scale. A week with
 * no result gets an empty dashed track and the reason in words, so it can never be mistaken
 * for a real score of 0, which gets a marker on the zero line and the number 0.
 */
export function WeekScoreBars({ weeks }: { weeks: WeekBar[] }) {
  const row = "grid grid-cols-[2.25rem_minmax(0,1fr)_6.5rem] items-center gap-3";
  return (
    <div role="group" aria-label="Official result by week" className="space-y-2.5">
      {weeks.map((w) => {
        const scored = w.score !== null;
        const percent = scored ? Math.max(0, Math.min(100, w.score as number)) : 0;
        return (
          <div key={w.weekNumber} className={row}>
            <span className="text-xs font-semibold text-muted">
              W{w.weekNumber}
              <span className="sr-only">
                {scored ? `: ${w.score} out of 100` : ` has no official result${w.note ? ` (${w.note})` : ""}`}
              </span>
            </span>
            <div
              aria-hidden="true"
              className={`relative h-3 overflow-hidden rounded-full ${
                scored ? "bg-canvas/80" : "border border-dashed border-line bg-transparent"
              }`}
            >
              {scored && percent > 0 && (
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${percent}%`,
                    backgroundImage: "linear-gradient(90deg, var(--color-primary), var(--color-accent))",
                  }}
                />
              )}
              {scored && percent === 0 && <div className="absolute inset-y-0 left-0 w-1 rounded-full bg-accent" />}
            </div>
            <span
              aria-hidden="true"
              className={`text-right text-sm tabular-nums ${scored ? "font-semibold text-fg" : "text-xs text-muted"}`}
            >
              {scored ? w.score : (w.note ?? "No result")}
            </span>
          </div>
        );
      })}
      <div aria-hidden="true" className={row}>
        <span />
        <div className="flex justify-between text-[11px] tabular-nums text-muted">
          {AXIS_TICKS.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <span />
      </div>
    </div>
  );
}

/** A section whose summary is always visible and whose details open and close. */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className = "",
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-xl text-left transition duration-150 hover:bg-card-hover focus-visible:outline-offset-2"
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <Icon
          name="chevron"
          className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div id={id} hidden={!open} className="mt-3">
        {children}
      </div>
    </div>
  );
}
