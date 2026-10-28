"use client";

import { useId, type ReactNode } from "react";
import { Icon } from "./ui";

export type DecisionStatus = "approved" | "edited" | "rejected" | "pending_review";

const BADGE: Record<DecisionStatus, { label: string; className: string }> = {
  approved: { label: "Approved", className: "badge-official" },
  edited: { label: "Edited by faculty", className: "badge-official" },
  rejected: { label: "Rejected", className: "badge-danger" },
  pending_review: { label: "Waiting for review", className: "badge-warning" },
};

/**
 * The teacher's official decision. Blue/indigo on purpose: green and amber belong to quiz
 * correctness, so this card never looks like quiz feedback. The status shown is the real
 * one: a rejected or pending week is never presented as approved.
 */
export function OfficialDecision({
  status,
  score,
  feedback,
  decidedAt,
  note,
  children,
}: {
  status: DecisionStatus;
  score: number | null;
  feedback?: string | null;
  decidedAt?: string | null;
  /** A line under the score, such as what the AI suggested. */
  note?: ReactNode;
  /** Extra sections, such as the teacher's private comment. */
  children?: ReactNode;
}) {
  const headingId = useId();
  const badge = BADGE[status];
  const pending = status === "pending_review";
  return (
    <section aria-labelledby={headingId} className={`card-official space-y-4 p-6 text-sm ${pending ? "border-dashed" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold text-official-fg">
          <Icon name="faculty" className="h-5 w-5 text-official-ink" />
          Official faculty decision
        </h2>
        <span className={badge.className}>{badge.label}</span>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-official-ink">Official score</p>
        {score === null ? (
          <p className="mt-1 text-base text-official-fg">
            {pending ? "No official score yet." : "No official score was given for this week."}
          </p>
        ) : (
          <p className="mt-1 flex items-baseline gap-1.5" aria-label={`Official score ${score} out of 100`}>
            <span className="text-5xl font-bold tabular-nums tracking-tight text-official-fg">{score}</span>
            <span className="text-xl font-medium text-official-ink">/100</span>
          </p>
        )}
        {note && <p className="mt-1 text-official-ink">{note}</p>}
      </div>

      {feedback && (
        <div className="border-t border-official/40 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-official-ink">Faculty feedback</h3>
          <p className="mt-1 whitespace-pre-line text-official-fg">{feedback}</p>
        </div>
      )}
      {children}
      {decidedAt && (
        <p className="border-t border-official/40 pt-3 text-xs text-official-ink">
          Decided {new Date(decidedAt).toLocaleString()}
        </p>
      )}
    </section>
  );
}
