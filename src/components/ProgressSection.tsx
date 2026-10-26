"use client";

import { useEffect, useState } from "react";
import {
  completeWeek,
  fetchProgress,
  fetchResults,
  recordBaseline,
  requestEvaluation,
  type EvaluationStatus,
} from "@/lib/api/client";
import type { Checkpoint, Progress } from "@/lib/schemas/checkpoint";
import type { StudentResult } from "@/lib/schemas/review";
import { QuizPanel } from "./QuizPanel";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; progress: Progress };

const short = (sha: string) => sha.slice(0, 7);

export function ProgressSection({ projectId, durationWeeks }: { projectId: string; durationWeeks: number }) {
  const weeks = Array.from({ length: durationWeeks }, (_, i) => i + 1);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<"baseline" | number | null>(null);
  const [confirmWeek, setConfirmWeek] = useState<number | null>(null);
  const [evaluating, setEvaluating] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [results, setResults] = useState<StudentResult[]>([]);
  const [resultsState, setResultsState] = useState<"loading" | "loaded" | "failed">("loading");

  // Weeks a teacher has decided. Only then is there an official result to fetch.
  const decidedWeeks =
    load.status === "ready"
      ? load.progress.evaluations
          .filter((e) => e.status !== "pending_review")
          .map((e) => e.weekNumber)
          .sort((a, b) => a - b)
          .join(",")
      : "";

  useEffect(() => {
    if (!decidedWeeks) return;
    let cancelled = false;
    fetchResults(projectId).then(
      (list) => {
        if (cancelled) return;
        setResults(list);
        setResultsState("loaded");
      },
      () => {
        if (!cancelled) setResultsState("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, decidedWeeks]);

  useEffect(() => {
    let cancelled = false;
    fetchProgress(projectId).then(
      (progress) => {
        if (!cancelled) setLoad({ status: "ready", progress });
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoad({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load progress.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, attempt]);

  function reload() {
    setLoad({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  function setEvaluationStatus(week: number, status: EvaluationStatus) {
    setLoad((prev) =>
      prev.status === "ready"
        ? {
            status: "ready",
            progress: {
              ...prev.progress,
              evaluations: [
                ...prev.progress.evaluations.filter((e) => e.weekNumber !== week),
                { weekNumber: week, status },
              ],
            },
          }
        : prev,
    );
  }

  /** Evaluates a recorded week. Runs right after recording, and again on "Generate evaluation" if it failed. */
  async function runEvaluation(week: number) {
    setEvaluating(week);
    setActionError(null);
    try {
      const result = await requestEvaluation(projectId, week);
      if (result.ok) setEvaluationStatus(week, result.status);
      else if (result.status) setEvaluationStatus(week, result.status);
      else setActionError(result.message);
    } catch {
      setActionError("Could not reach the server for the evaluation. Please try again.");
    } finally {
      setEvaluating(null);
    }
  }

  async function handleBaseline() {
    if (busy !== null || evaluating !== null) return;
    setBusy("baseline");
    setActionError(null);
    try {
      const result = await recordBaseline(projectId);
      if (result.ok) {
        setLoad((prev) =>
          prev.status === "ready"
            ? { status: "ready", progress: { ...prev.progress, baseline: result.value } }
            : prev,
        );
      } else {
        setActionError(result.message);
        reload(); // the state may have changed elsewhere (e.g. already recorded)
      }
    } catch {
      setActionError("Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleComplete(week: number) {
    if (busy !== null || evaluating !== null) return;
    setBusy(week);
    setActionError(null);
    setConfirmWeek(null);
    try {
      const result = await completeWeek(projectId, week);
      if (result.ok || result.existing) {
        const checkpoint = result.ok ? result.value : result.existing!;
        if (!result.ok) setActionError(result.message);
        setLoad((prev) =>
          prev.status === "ready"
            ? {
                status: "ready",
                progress: {
                  ...prev.progress,
                  checkpoints: [
                    ...prev.progress.checkpoints.filter((c) => c.weekNumber !== week),
                    checkpoint,
                  ].sort((a, b) => a.weekNumber - b.weekNumber),
                },
              }
            : prev,
        );
      } else {
        setActionError(result.message);
      }
      if (result.ok) {
        setBusy(null);
        await runEvaluation(week);
      }
    } catch {
      setActionError("Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="progress-heading" className="space-y-3">
      <h2 id="progress-heading" className="text-lg font-semibold">
        Weekly progress
      </h2>

      {load.status === "loading" && (
        <p role="status" className="text-slate-600">
          Loading progress…
        </p>
      )}

      {load.status === "error" && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p>Could not load progress: {load.message}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-2 rounded-md border border-red-400 px-3 py-1 font-medium hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      )}

      {actionError && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {actionError}
        </p>
      )}

      {load.status === "ready" && (
        <>
          <Baseline
            baseline={load.progress.baseline}
            busy={busy === "baseline"}
            disabled={busy !== null || evaluating !== null}
            onRecord={handleBaseline}
          />
          <ol className="space-y-2">
            {weeks.map((week) => {
              const checkpoint = load.progress.checkpoints.find((c) => c.weekNumber === week);
              const evaluation = load.progress.evaluations.find((e) => e.weekNumber === week);
              const previousDone =
                week === 1 ? load.progress.baseline !== null : load.progress.checkpoints.some((c) => c.weekNumber === week - 1);
              return (
                <li key={week} className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Week {week}</span>
                    {checkpoint ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                          {evaluation
                            ? evaluation.status === "pending_review"
                              ? "Recorded · submitted for teacher review"
                              : "Recorded · reviewed by your teacher"
                            : "Recorded · not yet evaluated"}
                        </span>
                        {!evaluation && evaluating !== week && (
                          <button
                            type="button"
                            onClick={() => runEvaluation(week)}
                            disabled={busy !== null || evaluating !== null}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Generate evaluation
                          </button>
                        )}
                      </span>
                    ) : previousDone ? (
                      confirmWeek === week ? null : (
                        <button
                          type="button"
                          onClick={() => setConfirmWeek(week)}
                          disabled={busy !== null || evaluating !== null}
                          className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {busy === week ? "Recording…" : `Complete Week ${week}`}
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-slate-500">
                        {week === 1 ? "Record your starting point first" : `Complete Week ${week - 1} first`}
                      </span>
                    )}
                  </div>

                  {checkpoint && <CheckpointDetails checkpoint={checkpoint} />}
                  {checkpoint && <QuizPanel projectId={projectId} week={week} />}
                  {evaluation && evaluation.status !== "pending_review" && (
                    <OfficialResult result={results.find((r) => r.weekNumber === week)} state={resultsState} />
                  )}
                  {evaluating === week && (
                    <p role="status" className="mt-2 text-xs text-indigo-800">
                      Evaluating your code changes… this can take up to a minute.
                    </p>
                  )}

                  {confirmWeek === week && !checkpoint && (
                    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3" role="group" aria-label={`Confirm Week ${week}`}>
                      <p className="text-amber-950">
                        Record Week {week} now? We will save the latest commit you have pushed to GitHub. Push all your
                        work first. This cannot be undone.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleComplete(week)}
                          className="rounded-md bg-indigo-700 px-3 py-1.5 font-medium text-white hover:bg-indigo-800"
                        >
                          Yes, record Week {week}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmWeek(null)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-slate-500">
            A recorded checkpoint only saves the commit you finished the week on. After recording, your code changes are
            reviewed by an AI and sent to your teacher. The AI&apos;s suggestion is not a mark, and you will not see it:
            marks appear only after your teacher reviews and approves them.
          </p>
        </>
      )}
    </section>
  );
}

function Baseline({
  baseline,
  busy,
  disabled,
  onRecord,
}: {
  baseline: Progress["baseline"];
  busy: boolean;
  disabled: boolean;
  onRecord: () => void;
}) {
  if (baseline) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <span className="font-medium">Starting point:</span> commit{" "}
        <code className="rounded bg-slate-100 px-1">{short(baseline.commitSha)}</code> on {baseline.branch}, recorded{" "}
        {new Date(baseline.recordedAt).toLocaleString()}.
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm">
      <p className="text-slate-700">
        Before Week 1, record your starting point. We save the latest commit on your repository&apos;s default branch.
        Week 1 is compared against it, so do this before you start your project work. It cannot be changed later.
      </p>
      <button
        type="button"
        onClick={onRecord}
        disabled={disabled}
        className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Recording…" : "Record starting point"}
      </button>
    </div>
  );
}

function CheckpointDetails({ checkpoint }: { checkpoint: Checkpoint }) {
  return (
    <p className="mt-2 text-xs text-slate-600">
      Recorded {new Date(checkpoint.recordedAt).toLocaleString()} · commit{" "}
      <code className="rounded bg-slate-100 px-1">{short(checkpoint.commitSha)}</code> · {checkpoint.filesChanged}{" "}
      {checkpoint.filesChanged === 1 ? "file" : "files"} changed (+{checkpoint.additions} −{checkpoint.deletions}) since{" "}
      <code className="rounded bg-slate-100 px-1">{short(checkpoint.baseCommitSha)}</code>
    </p>
  );
}

/** The teacher's official outcome for a week. Never the AI's own score or feedback. */
function OfficialResult({
  result,
  state,
}: {
  result: StudentResult | undefined;
  state: "loading" | "loaded" | "failed";
}) {
  if (!result) {
    return state !== "loading" ? (
      <p role="alert" className="mt-2 text-xs text-red-800">
        Your teacher has reviewed this week, but the result could not be loaded. Please refresh the page.
      </p>
    ) : (
      <p role="status" className="mt-2 text-xs text-slate-600">
        Loading your teacher&apos;s result…
      </p>
    );
  }
  if (result.outcome === "rejected") {
    return (
      <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
        Your teacher reviewed this week and did not give an official mark for it.
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-1 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm">
      <p className="font-medium text-emerald-950">
        Official result: {result.officialScore}/100
        <span className="font-normal text-emerald-900"> · set by your teacher</span>
      </p>
      {result.feedback && (
        <div>
          <p className="font-medium text-emerald-950">Teacher feedback</p>
          <p className="whitespace-pre-line text-slate-800">{result.feedback}</p>
        </div>
      )}
    </div>
  );
}
