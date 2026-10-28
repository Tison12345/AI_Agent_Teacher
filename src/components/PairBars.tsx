/**
 * Two bars per row on one 0-100 scale: the faculty-approved (official) score and the AI's recommendation, always
 * labelled so the AI's number is never mistaken for the official one. A missing score is an empty dashed track and a
 * word, never a zero.
 */
export type PairRow = { key: string; label: string; official: number | null; ai: number | null; note?: string };

function Track({ value, kind, label }: { value: number | null; kind: "official" | "ai"; label: string }) {
  const percent = value === null ? 0 : Math.max(0, Math.min(100, value));
  const filled = kind === "official" ? "" : "opacity-60";
  return (
    <div
      role="img"
      aria-label={value === null ? `${label}: none` : `${label}: ${value}`}
      className={`relative h-2.5 overflow-hidden rounded-full ${value === null ? "border border-dashed border-line" : "bg-canvas/80"}`}
    >
      {value !== null && percent > 0 && (
        <div
          className={`h-full rounded-full ${filled}`}
          style={{
            width: `${percent}%`,
            backgroundImage:
              kind === "official"
                ? "linear-gradient(90deg, var(--color-primary), var(--color-accent))"
                : "repeating-linear-gradient(45deg, var(--color-violet), var(--color-violet) 4px, transparent 4px, transparent 7px)",
          }}
        />
      )}
      {value === 0 && <div className="absolute inset-y-0 left-0 w-1 rounded-full bg-accent" />}
    </div>
  );
}

export function PairBars({ rows, title }: { rows: PairRow[]; title: string }) {
  return (
    <div role="group" aria-label={title} className="space-y-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legend">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-5 rounded-full" style={{ backgroundImage: "linear-gradient(90deg, var(--color-primary), var(--color-accent))" }} />
          Official (faculty-approved)
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-5 rounded-full opacity-60"
            style={{ backgroundImage: "repeating-linear-gradient(45deg, var(--color-violet), var(--color-violet) 4px, transparent 4px, transparent 7px)" }}
          />
          AI recommendation (not official)
        </li>
      </ul>
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[minmax(3rem,7rem)_minmax(0,1fr)_6.5rem] items-center gap-3">
          <span className="truncate text-xs font-semibold text-muted" title={row.label}>
            {row.label}
          </span>
          <div className="space-y-1">
            <Track value={row.official} kind="official" label={`${row.label} official`} />
            <Track value={row.ai} kind="ai" label={`${row.label} AI recommendation`} />
          </div>
          <span aria-hidden="true" className="text-right text-xs tabular-nums">
            {row.official === null && row.ai === null ? (
              <span className="text-muted">{row.note ?? "No scores"}</span>
            ) : (
              <>
                <span className={row.official === null ? "text-muted" : "block text-sm font-semibold text-fg"}>{row.official === null ? (row.note ?? "Not official") : row.official}</span>
                <span className="block text-muted">AI {row.ai === null ? "–" : row.ai}</span>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
