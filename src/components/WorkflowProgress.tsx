"use client";

import { useEffect, useRef, useState } from "react";
import { fetchEvaluationProgress, fetchWorkflowProgress } from "@/lib/api/client";
import type { StepStatus } from "@/lib/workflow/progress-core";

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

/** What both workflows' progress looks like to the browser (see submission/progress.ts and evaluation/progress.ts). */
export type ProgressView = {
  state: string;
  steps: { id: string; label: string; status: StepStatus; attempt?: number }[];
  failure: { code: string; message: string } | null;
  /** Which run this describes, for workflows that report it. */
  run?: number;
};

const SUMMARY: Record<string, string> = {
  not_started: "Waiting to start.",
  running: "Working on it. This page updates by itself.",
  waiting_faculty: "The AI review is ready. Waiting for a teacher to review it.",
  complete: "Finished. A teacher has made the decision.",
  needs_ocr: "Stopped: this document has no typed text to read.",
  failed: "Stopped because of a problem.",
  skipped: "Nothing to do for this submission.",
};

const polls = (state: string) => state === "running" || state === "not_started" || state === "waiting_faculty";

/**
 * The steps of a workflow, read from the real graph state (an allowlisted projection, which has no text, AI
 * output, marks or feedback). Polls every 2 seconds while the workflow works, and more slowly while it waits for
 * a teacher. `onStateChange` lets the page above refresh when the workflow reaches a new state.
 */
const STARTING: ProgressView = { state: "running", steps: [], failure: null };

export function ProgressPanel({
  load,
  onStateChange,
  stale,
}: {
  load: () => Promise<ProgressView>;
  /** True for a progress that still describes the previous run (a run was just started): shown as "starting". */
  stale?: (progress: ProgressView) => boolean;
  onStateChange?: (state: string, progress: ProgressView) => void;
}) {
  const [progress, setProgress] = useState<ProgressView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const lastState = useRef<string | null>(null);
  const loadRef = useRef(load);
  const notify = useRef(onStateChange);
  const staleRef = useRef(stale);
  useEffect(() => {
    loadRef.current = load;
    notify.current = onStateChange;
    staleRef.current = stale;
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function look() {
      let next: number | null = RUNNING_POLL_MS;
      try {
        const loaded = await loadRef.current();
        if (cancelled) return;
        const value = staleRef.current?.(loaded) ? STARTING : loaded;
        setProgress(value);
        setProblem(null);
        if (lastState.current !== value.state) notify.current?.(value.state, value);
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
  }, []);

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
        {SUMMARY[progress.state] ?? ""}
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

/** The progress of one submission's marking workflow. */
/** A run is expected (the submission is "processing"), so an ending left over from an earlier run is not shown. */
const LEFTOVER = ["failed", "needs_ocr", "complete", "skipped"];

export function WorkflowProgress({
  submissionId,
  status,
  onStateChange,
}: {
  submissionId: string;
  /** The submission's own status. While it is "processing", a run is expected. */
  status?: string;
  onStateChange?: (state: string) => void;
}) {
  // The first look only reports the state found on arrival; the page above refreshes on a change after that.
  const first = useRef<string | null>(null);
  return (
    <ProgressPanel
      key={submissionId}
      load={() => fetchWorkflowProgress(submissionId)}
      stale={(progress) => status === "processing" && LEFTOVER.includes(progress.state)}
      onStateChange={(state) => {
        if (first.current !== null && first.current !== state) onStateChange?.(state);
        first.current = state;
      }}
    />
  );
}

/** The progress of one week's evaluation workflow. */
export function EvaluationWorkflowProgress({
  projectId,
  weekNumber,
  afterRun,
  onStateChange,
}: {
  projectId: string;
  weekNumber: number;
  /** The run the workflow was on when this one was started; anything that ended that run or an older one is stale. */
  afterRun: number;
  onStateChange?: (state: string, progress: ProgressView) => void;
}) {
  return (
    <ProgressPanel
      key={`${projectId}:${weekNumber}`}
      load={() => fetchEvaluationProgress(projectId, weekNumber)}
      stale={(progress) => progress.run !== undefined && progress.run <= afterRun && progress.state !== "running" && progress.state !== "not_started"}
      onStateChange={onStateChange}
    />
  );
}
