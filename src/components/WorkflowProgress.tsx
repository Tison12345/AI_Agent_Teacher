"use client";

import { useEffect, useRef, useState } from "react";
import { fetchWorkflowProgress } from "@/lib/api/client";
import type { StepStatus, WorkflowProgress as Progress } from "@/lib/workflow/submission/progress";

/** Looked at again this often while the workflow is working. */
export const RUNNING_POLL_MS = 2_000;
/** And this often while it waits for faculty, which can take a long time. */
export const WAITING_POLL_MS = 10_000;

const MARK: Record<StepStatus, { symbol: string; label: string; tone: string }> = {
  done: { symbol: "✓", label: "done", tone: "text-success" },
  active: { symbol: "●", label: "in progress", tone: "text-link" },
  waiting: { symbol: "◔", label: "waiting", tone: "text-warning" },
  pending: { symbol: "○", label: "not yet", tone: "text-muted" },
  failed: { symbol: "✕", label: "failed", tone: "text-danger" },
  skipped: { symbol: "–", label: "skipped", tone: "text-muted" },
};

const SUMMARY: Record<Progress["state"], string> = {
  not_started: "Waiting to start.",
  running: "Working on it. This page updates by itself.",
  waiting_faculty: "The AI recommendation is ready. Waiting for faculty to review it.",
  complete: "Finished. Faculty have made their decision.",
  needs_ocr: "Stopped: this document has no typed text to read.",
  failed: "Stopped because of a problem.",
  skipped: "Nothing to do for this submission.",
};

const polls = (state: Progress["state"]) => state === "running" || state === "not_started" || state === "waiting_faculty";

/**
 * The steps of a submission's workflow, read from the real graph state (the allowlisted projection, which has
 * no text, AI output, marks or feedback). Polls every 2 seconds while the workflow works, and more slowly while
 * it waits for faculty. `onStateChange` lets the page above refresh when the workflow reaches a new state.
 */
export function WorkflowProgress({ submissionId, onStateChange }: { submissionId: string; onStateChange?: (state: Progress["state"]) => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const lastState = useRef<Progress["state"] | null>(null);
  const notify = useRef(onStateChange);
  useEffect(() => {
    notify.current = onStateChange;
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function look() {
      let next: number | null = RUNNING_POLL_MS;
      try {
        const value = await fetchWorkflowProgress(submissionId);
        if (cancelled) return;
        setProgress(value);
        setProblem(null);
        if (lastState.current !== null && lastState.current !== value.state) notify.current?.(value.state);
        lastState.current = value.state;
        next = polls(value.state) ? (value.state === "waiting_faculty" ? WAITING_POLL_MS : RUNNING_POLL_MS) : null;
      } catch (error) {
        if (cancelled) return;
        setProblem(error instanceof Error ? error.message : "Could not load the progress.");
      }
      if (next !== null && !cancelled) timer = setTimeout(look, next);
    }

    look();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [submissionId]);

  if (!progress) {
    return problem ? (
      <p role="alert" className="text-sm text-danger">
        Could not load the progress: {problem}
      </p>
    ) : (
      <p role="status" className="text-sm text-muted">
        Loading progress…
      </p>
    );
  }

  return (
    <div className="well space-y-2 p-3 text-sm" data-testid="workflow-progress">
      <p role="status" className="font-medium text-fg">
        {SUMMARY[progress.state]}
      </p>
      <ol className="space-y-1">
        {progress.steps.map((step) => {
          const mark = MARK[step.status];
          return (
            <li key={step.id} className="flex items-center gap-2" data-step={step.id} data-status={step.status}>
              <span aria-hidden="true" className={`w-4 text-center ${mark.tone}`}>
                {mark.symbol}
              </span>
              <span className={step.status === "pending" || step.status === "skipped" ? "text-muted" : "text-fg"}>
                {step.label}
                {step.attempt ? ` (attempt ${step.attempt})` : ""}
              </span>
              <span className="sr-only"> — {mark.label}</span>
            </li>
          );
        })}
      </ol>
      {progress.failure && (
        <p role="alert" className="text-danger">
          {progress.failure.message}
        </p>
      )}
      {problem && <p className="text-xs text-muted">Could not refresh just now; trying again.</p>}
    </div>
  );
}
