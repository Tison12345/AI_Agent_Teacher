"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchReview, sendDecision } from "@/lib/api/client";
import { aiFeedbackText } from "@/lib/review/service";
import { DecisionRequestSchema, type ReviewDetail } from "@/lib/schemas/review";
import type { TeacherDecision } from "@/lib/schemas/teacher-decision";
import { FacultyQuiz } from "./FacultyQuiz";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "missing" }
  | { status: "ready"; detail: ReviewDetail };

type Choice = "approve" | "edit" | "reject";

const REASON_LABEL: Record<string, string> = {
  deleted: "file was deleted",
  ignored: "generated or ignored file",
  binary: "binary file",
  unavailable: "too large or unavailable",
  budget: "over the size limit",
};

export function EvaluationReview({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchReview(id).then(
      (detail) => {
        if (!cancelled) setLoad(detail ? { status: "ready", detail } : { status: "missing" });
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the evaluation." });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  function onDecided(decision: TeacherDecision) {
    const status = decision.decision === "approve" ? "approved" : decision.decision === "edit" ? "edited" : "rejected";
    setLoad((prev) =>
      prev.status === "ready"
        ? { status: "ready", detail: { ...prev.detail, decision, evaluation: { ...prev.detail.evaluation, status } } }
        : prev,
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/faculty" className="inline-flex text-sm font-medium text-link hover:text-fg">
        ← Back to the review queue
      </Link>

      {load.status === "loading" && <p role="status">Loading evaluation…</p>}
      {load.status === "missing" && (
        <p role="alert" className="card p-5">
          This evaluation does not exist.
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="alert-danger">
          <p>Could not load the evaluation: {load.message}</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className="btn-secondary btn-sm mt-3"
          >
            Try again
          </button>
        </div>
      )}
      {load.status === "ready" && <Detail detail={load.detail} onDecided={onDecided} />}
    </div>
  );
}

function Detail({ detail, onDecided }: { detail: ReviewDetail; onDecided: (d: TeacherDecision) => void }) {
  const { evaluation: e, snapshot, project, decision } = detail;
  const scope = e.reviewScope;
  return (
    <>
      <header className="space-y-1.5">
        <p className="eyebrow">Evaluation review</p>
        <h1 className="text-3xl font-bold tracking-tight">
          {project.title} · Week {e.weekNumber}
        </h1>
        <p className="text-sm text-muted">
          Repository: {project.repoUrl} · evaluated {new Date(e.createdAt).toLocaleString()} by {e.model}
        </p>
      </header>

      <p className="alert-warning">
        The AI&apos;s score is only a <strong>recommendation</strong>. Your decision below is the official result. A Git
        diff shows what changed; it is evidence of changes, not proof of who wrote the code or that the student
        understands it. The code was never run.
      </p>

      <section aria-labelledby="ai-heading" className="card-hero space-y-4 p-6 sm:p-8">
        <h2 id="ai-heading" className="text-xl font-semibold">
          AI recommendation (not official)
        </h2>
        <p className="text-6xl font-bold tabular-nums tracking-tight sm:text-7xl" aria-label={`AI suggested score ${e.suggestedScore} out of 100`}>
          {e.suggestedScore}
          <span className="text-2xl font-medium text-muted"> / 100</span>
        </p>
        <p className="text-sm">
          Confidence: <strong>{e.confidence.level}</strong>
        </p>
        {e.confidence.uncertainties.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg">
            {e.confidence.uncertainties.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        )}

        <h3 className="eyebrow pt-2">Criteria</h3>
        <ul className="space-y-3">
          {e.criteriaAssessments.map((c) => (
            <li key={c.criterion} className="well p-4 text-sm">
              <p className="font-semibold">
                {c.criterion}: {c.score}/{c.maxScore}
              </p>
              <p className="text-fg">{c.rationale}</p>
              {c.evidence.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                  {c.evidence.map((ev, i) => (
                    <li key={i}>
                      {ev.filePath && <code className="rounded-md bg-canvas/70 px-1.5 py-0.5 font-mono text-xs">{ev.filePath}</code>} {ev.summary}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted">No evidence cited.</p>
              )}
            </li>
          ))}
        </ul>

        <TextList title="Completed requirements" items={e.completedRequirements} />
        <TextList title="Incomplete requirements" items={e.incompleteRequirements} />
        <TextList title="Technical concerns" items={e.technicalConcerns} />
        <TextList title="AI's feedback for next week" items={e.feedbackForNextWeek} />
      </section>

      <FacultyQuiz evaluationId={e.id} />

      <section aria-labelledby="scope-heading" className="card space-y-2 p-6 text-sm">
        <h2 id="scope-heading" className="text-xl font-semibold">
          What the AI could see
        </h2>
        <p>
          {scope.filesReviewed} of {scope.filesChanged} changed files reviewed
          {scope.patchesTruncated > 0 && `, ${scope.patchesTruncated} cut because of size`}
          {scope.filesBeyondLimit > 0 && `, ${scope.filesBeyondLimit} more beyond the file limit`}. Code executed: no.
        </p>
        {scope.notReviewed.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-fg">
            {scope.notReviewed.map((f) => (
              <li key={f.path}>
                <code className="rounded-md bg-canvas/70 px-1.5 py-0.5 font-mono text-xs">{f.path}</code> not reviewed ({REASON_LABEL[f.reason] ?? f.reason})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="diff-heading" className="space-y-2">
        <h2 id="diff-heading" className="text-xl font-semibold">
          Changes the AI was shown
        </h2>
        <p className="text-sm text-muted">
          {snapshot.totalFiles} {snapshot.totalFiles === 1 ? "file" : "files"} changed (+{snapshot.totalAdditions} −
          {snapshot.totalDeletions}) between the two recorded commits.
        </p>
        {snapshot.files.map((f) => (
          <details key={f.path} className="card p-4 text-sm open:border-primary/40">
            <summary className="cursor-pointer font-medium">
              <code>{f.path}</code> · {f.status} · +{f.additions} −{f.deletions}
            </summary>
            {f.patch !== undefined ? (
              <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-canvas p-4 font-mono text-xs leading-relaxed text-fg">
                {f.patch}
                {f.patchTruncated ? "\n… (cut because of size)" : ""}
              </pre>
            ) : (
              <p className="mt-2 text-muted">The AI was not shown the contents of this file.</p>
            )}
          </details>
        ))}
        {snapshot.filesOmitted > 0 && (
          <p className="text-sm text-muted">{snapshot.filesOmitted} more files were not stored.</p>
        )}
      </section>

      {decision ? <Decided decision={decision} suggested={e.suggestedScore} /> : <DecisionForm detail={detail} onDecided={onDecided} />}
    </>
  );
}

function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="text-sm">
      <h3 className="eyebrow mb-1">{title}</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-fg">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Decided({ decision, suggested }: { decision: TeacherDecision; suggested: number }) {
  const label = { approve: "Approved", edit: "Edited", reject: "Rejected" }[decision.decision];
  return (
    <section aria-labelledby="official-heading" className="alert-success space-y-3 p-6 text-sm">
      <h2 id="official-heading" className="text-xl font-semibold">
        Official decision: {label}
      </h2>
      {decision.approvedScore !== null ? (
        <p>
          Official score: <strong>{decision.approvedScore}/100</strong>
          {decision.approvedScore !== suggested && ` (the AI suggested ${suggested})`}
        </p>
      ) : (
        <p>No official score was given for this week.</p>
      )}
      {decision.approvedFeedback && (
        <div>
          <p className="font-semibold">Feedback shown to the student</p>
          <p className="whitespace-pre-line text-fg">{decision.approvedFeedback}</p>
        </div>
      )}
      {decision.comment && (
        <div>
          <p className="font-semibold">Your private comment</p>
          <p className="whitespace-pre-line text-fg">{decision.comment}</p>
        </div>
      )}
      <p className="text-xs text-muted">Decided {new Date(decision.decidedAt).toLocaleString()}. This is final.</p>
    </section>
  );
}

function DecisionForm({ detail, onDecided }: { detail: ReviewDetail; onDecided: (d: TeacherDecision) => void }) {
  const { evaluation: e } = detail;
  const aiFeedback = aiFeedbackText(e.feedbackForNextWeek);
  const [choice, setChoice] = useState<Choice>("approve");
  const [score, setScore] = useState(String(e.suggestedScore));
  const [feedback, setFeedback] = useState(aiFeedback);
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  function build() {
    if (choice === "approve") return { decision: "approve" as const, comment };
    if (choice === "reject") return { decision: "reject" as const, comment };
    return {
      decision: "edit" as const,
      approvedScore: score.trim() === "" ? Number.NaN : Number(score),
      approvedFeedback: feedback,
      comment,
    };
  }

  function review() {
    setFormError(null);
    const parsed = DecisionRequestSchema.safeParse(build());
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) found[String(issue.path[0] ?? "decision")] ??= issue.message;
      setErrors(found);
      return;
    }
    if (
      choice === "edit" &&
      Number(score) === e.suggestedScore &&
      feedback.trim() === aiFeedback
    ) {
      setErrors({ approvedScore: "Change the score or the feedback, or choose Approve." });
      return;
    }
    setErrors({});
    setConfirming(true);
  }

  async function submit() {
    const parsed = DecisionRequestSchema.safeParse(build());
    if (!parsed.success || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await sendDecision(e.id, parsed.data);
      if (result.ok) onDecided(result.decision);
      else {
        setFormError(result.message);
        if (result.fields) setErrors(result.fields);
        setConfirming(false);
      }
    } catch {
      setFormError("Could not reach the server. Please try again.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const summary =
    choice === "approve"
      ? `Approve the AI's score of ${e.suggestedScore}/100 and its feedback as the official result.`
      : choice === "edit"
        ? `Record ${score}/100 and your feedback as the official result.`
        : "Reject the AI's evaluation. The student gets no score for this week.";

  return (
    <section aria-labelledby="decision-heading" className="card space-y-5 border-primary/40 p-6">
      <h2 id="decision-heading" className="text-xl font-semibold">
        Your decision
      </h2>

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="mb-1 text-sm font-semibold">What do you want to do?</legend>
        {(
          [
            ["approve", "Approve", "Use the AI's score and feedback as they are."],
            ["edit", "Edit", "Set your own score and feedback."],
            ["reject", "Reject", "The evaluation is not reliable; the student gets no score."],
          ] as const
        ).map(([value, label, help]) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm transition duration-150 hover:border-primary/50 has-[:checked]:border-accent/60 has-[:checked]:bg-accent/10"
          >
            <input
              type="radio"
              name="decision"
              value={value}
              checked={choice === value}
              onChange={() => {
                setChoice(value);
                setErrors({});
                setConfirming(false);
              }}
              className="mt-1 accent-[var(--color-accent)]"
            />
            <span>
              <span className="font-semibold">{label}</span> – {help}
            </span>
          </label>
        ))}
      </fieldset>

      {choice === "edit" && (
        <div className="space-y-3">
          <div>
            <label htmlFor="score" className="block text-sm font-medium">
              Official score (0–100)
            </label>
            <input
              id="score"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.1}
              value={score}
              onChange={(ev) => {
                setScore(ev.target.value);
                setConfirming(false);
              }}
              aria-invalid={Boolean(errors.approvedScore)}
              aria-describedby={errors.approvedScore ? "score-error" : undefined}
              className="field mt-1 w-32"
            />
            {errors.approvedScore && (
              <p id="score-error" role="alert" className="mt-1 text-sm text-danger">
                {errors.approvedScore}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="feedback" className="block text-sm font-medium">
              Feedback shown to the student
            </label>
            <textarea
              id="feedback"
              rows={5}
              value={feedback}
              onChange={(ev) => {
                setFeedback(ev.target.value);
                setConfirming(false);
              }}
              aria-invalid={Boolean(errors.approvedFeedback)}
              aria-describedby={errors.approvedFeedback ? "feedback-error" : undefined}
              className="field mt-1"
            />
            {errors.approvedFeedback && (
              <p id="feedback-error" role="alert" className="mt-1 text-sm text-danger">
                {errors.approvedFeedback}
              </p>
            )}
          </div>
        </div>
      )}

      {choice === "approve" && (
        <div className="well p-4 text-sm">
          <p className="eyebrow mb-1">The student will see</p>
          <p>Official score: {e.suggestedScore}/100</p>
          <p className="whitespace-pre-line text-fg">{aiFeedback}</p>
        </div>
      )}

      <div>
        <label htmlFor="comment" className="block text-sm font-medium">
          {choice === "approve" ? "Private comment (optional)" : "Private comment (required)"}
        </label>
        <p className="text-xs text-muted">Only teachers see this. Students never do.</p>
        <textarea
          id="comment"
          rows={3}
          value={comment}
          onChange={(ev) => {
            setComment(ev.target.value);
            setConfirming(false);
          }}
          aria-invalid={Boolean(errors.comment)}
          aria-describedby={errors.comment ? "comment-error" : undefined}
          className="field mt-1"
        />
        {errors.comment && (
          <p id="comment-error" role="alert" className="mt-1 text-sm text-danger">
            {errors.comment}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="alert-danger">
          {formError}
        </p>
      )}

      {confirming ? (
        <div role="group" aria-label="Confirm decision" className="alert-warning">
          <p className="text-fg">{summary} A decision is final and cannot be changed.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="btn-primary btn-sm"
            >
              {busy ? "Saving…" : "Yes, record decision"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={review}
          className="btn-primary"
        >
          Review decision
        </button>
      )}
    </section>
  );
}
