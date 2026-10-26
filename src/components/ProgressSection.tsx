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
import { Icon, ProgressBar, ScoreCard, WeekScoreBars } from "./ui";

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
    <section aria-labelledby="progress-heading" className="space-y-5">
      <h2 id="progress-heading" className="text-xl font-semibold">
        Weekly progress
      </h2>

      {load.status === "loading" && (
        <p role="status" className="text-muted">
          Loading progress…
        </p>
      )}

      {load.status === "error" && (
        <div role="alert" className="alert-danger">
          <p>Could not load progress: {load.message}</p>
          <button type="button" onClick={reload} className="btn-secondary btn-sm mt-3">
            Try again
          </button>
        </div>
      )}

      {actionError && (
        <p role="alert" className="alert-danger">
          {actionError}
        </p>
      )}

      {load.status === "ready" && (
        <>
          <ProgressSummary
            durationWeeks={durationWeeks}
            checkpoints={load.progress.checkpoints.length}
            evaluations={load.progress.evaluations}
            results={results}
          />
          <Baseline
            baseline={load.progress.baseline}
            busy={busy === "baseline"}
            disabled={busy !== null || evaluating !== null}
            onRecord={handleBaseline}
          />
          <ol className="space-y-4">
            {weeks.map((week) => {
              const checkpoint = load.progress.checkpoints.find((c) => c.weekNumber === week);
              const evaluation = load.progress.evaluations.find((e) => e.weekNumber === week);
              const previousDone =
                week === 1 ? load.progress.baseline !== null : load.progress.checkpoints.some((c) => c.weekNumber === week - 1);
              return (
                <li key={week} className="card p-5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-3">
                      <WeekMarker
                        state={!checkpoint ? "open" : !evaluation || evaluation.status === "pending_review" ? "waiting" : "done"}
                        week={week}
                      />
                      <span className="text-base font-semibold">Week {week}</span>
                    </span>
                    {checkpoint ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={evaluation && evaluation.status !== "pending_review" ? "badge-success" : "badge-info"}>
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
                            className="btn-secondary btn-sm"
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
                          className="btn-primary btn-sm"
                        >
                          {busy === week ? "Recording…" : `Complete Week ${week}`}
                        </button>
                      )
                    ) : (
                      <span className="badge-neutral">
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
                    <p role="status" className="mt-2 text-xs text-link">
                      Evaluating your code changes… this can take up to a minute.
                    </p>
                  )}

                  {confirmWeek === week && !checkpoint && (
                    <div className="alert-warning mt-3" role="group" aria-label={`Confirm Week ${week}`}>
                      <p className="text-fg">
                        Record Week {week} now? We will save the latest commit you have pushed to GitHub. Push all your
                        work first. This cannot be undone.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleComplete(week)}
                          className="btn-primary btn-sm"
                        >
                          Yes, record Week {week}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmWeek(null)}
                          className="btn-secondary btn-sm"
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
          <p className="text-xs text-muted">
            A recorded checkpoint only saves the commit you finished the week on. After recording, your code changes are
            reviewed by an AI and sent to your teacher. The AI&apos;s suggestion is not a mark, and you will not see it:
            marks appear only after your teacher reviews and approves them.
          </p>
        </>
      )}
    </section>
  );
}

/** The marker beside a week: done, waiting for the teacher, or not started. The state is also text. */
function WeekMarker({ state, week }: { state: "done" | "waiting" | "open"; week: number }) {
  if (state === "done") {
    return (
      <span className="grid h-9 w-9 place-items-center rounded-full bg-success/15 text-success ring-1 ring-success/40">
        <Icon name="check" className="h-5 w-5" />
        <span className="sr-only">Week {week} reviewed</span>
      </span>
    );
  }
  if (state === "waiting") {
    return (
      <span className="grid h-9 w-9 place-items-center rounded-full bg-accent/10 text-accent ring-1 ring-accent/40">
        <Icon name="clock" className="h-5 w-5" />
        <span className="sr-only">Week {week} waiting for review</span>
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-canvas text-sm font-semibold text-muted ring-1 ring-line">
      {week}
    </span>
  );
}

/**
 * The big picture: the average of the teacher-approved scores so far (a plain average of
 * real official scores, not a final grade), how far the project has got, and each week's score.
 */
function ProgressSummary({
  durationWeeks,
  checkpoints,
  evaluations,
  results,
}: {
  durationWeeks: number;
  checkpoints: number;
  evaluations: { weekNumber: number; status: EvaluationStatus }[];
  results: StudentResult[];
}) {
  const scored = results.filter((r) => r.officialScore !== null);
  const average =
    scored.length === 0
      ? null
      : Math.round((scored.reduce((sum, r) => sum + (r.officialScore ?? 0), 0) / scored.length) * 10) / 10;
  const reviewed = evaluations.filter((e) => e.status !== "pending_review").length;
  const waiting = evaluations.length - reviewed;
  const bars = Array.from({ length: durationWeeks }, (_, i) => ({
    weekNumber: i + 1,
    score: results.find((r) => r.weekNumber === i + 1)?.officialScore ?? null,
  }));

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <ScoreCard
          hero
          label="Average official result"
          score={average}
          empty="No reviewed weeks yet"
          caption={
            average === null
              ? "Results appear here after your teacher reviews a week."
              : `Average of ${scored.length} teacher-approved ${scored.length === 1 ? "week" : "weeks"} out of ${durationWeeks}. This is not a final grade.`
          }
        >
          <WeekScoreBars weeks={bars} />
        </ScoreCard>
      </div>
      <section aria-label="Project progress" className="card flex flex-col justify-between gap-5 p-6">
        <div>
          <p className="eyebrow">Weeks recorded</p>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-5xl font-bold tabular-nums tracking-tight">{checkpoints}</span>
            <span className="text-xl font-medium text-muted">of {durationWeeks}</span>
          </p>
        </div>
        <ProgressBar percent={(checkpoints / durationWeeks) * 100} label="Weeks recorded as a percentage of the project" />
        <p className="flex flex-wrap gap-2">
          <span className="badge-success">{reviewed} reviewed</span>
          <span className="badge-info">{waiting} waiting for review</span>
          <span className="badge-neutral">{durationWeeks - checkpoints} not recorded</span>
        </p>
      </section>
    </div>
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
      <p className="card flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-4 text-sm">
        <span className="font-semibold">Starting point:</span> commit{" "}
        <code className="rounded-lg bg-canvas/70 px-1">{short(baseline.commitSha)}</code> on {baseline.branch}, recorded{" "}
        {new Date(baseline.recordedAt).toLocaleString()}.
      </p>
    );
  }
  return (
    <div className="card space-y-3 border-dashed p-5 text-sm">
      <p className="text-fg">
        Before Week 1, record your starting point. We save the latest commit on your repository&apos;s default branch.
        Week 1 is compared against it, so do this before you start your project work. It cannot be changed later.
      </p>
      <button
        type="button"
        onClick={onRecord}
        disabled={disabled}
        className="btn-primary"
      >
        {busy ? "Recording…" : "Record starting point"}
      </button>
    </div>
  );
}

function CheckpointDetails({ checkpoint }: { checkpoint: Checkpoint }) {
  return (
    <p className="mt-2 text-xs text-muted">
      Recorded {new Date(checkpoint.recordedAt).toLocaleString()} · commit{" "}
      <code className="rounded-lg bg-canvas/70 px-1">{short(checkpoint.commitSha)}</code> · {checkpoint.filesChanged}{" "}
      {checkpoint.filesChanged === 1 ? "file" : "files"} changed (+{checkpoint.additions} −{checkpoint.deletions}) since{" "}
      <code className="rounded-lg bg-canvas/70 px-1">{short(checkpoint.baseCommitSha)}</code>
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
      <p role="alert" className="mt-2 text-xs text-danger">
        Your teacher has reviewed this week, but the result could not be loaded. Please refresh the page.
      </p>
    ) : (
      <p role="status" className="mt-2 text-xs text-muted">
        Loading your teacher&apos;s result…
      </p>
    );
  }
  if (result.outcome === "rejected") {
    return (
      <p className="well mt-3 p-4 text-sm text-fg">
        Your teacher reviewed this week and did not give an official mark for it.
      </p>
    );
  }
  return (
    <div className="alert-success mt-3 space-y-2">
      <p className="text-xl font-bold text-fg">
        Official result: {result.officialScore}/100
        <span className="text-sm font-medium text-success"> · set by your teacher</span>
      </p>
      {result.feedback && (
        <div>
          <p className="font-semibold text-fg">Teacher feedback</p>
          <p className="whitespace-pre-line text-fg">{result.feedback}</p>
        </div>
      )}
    </div>
  );
}
