"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchReview, sendDecision } from "@/lib/api/client";
import { aiFeedbackText } from "@/lib/review/service";
import { DecisionRequestSchema, type ReviewDetail } from "@/lib/schemas/review";
import type { TeacherDecision } from "@/lib/schemas/teacher-decision";

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
    <div className="space-y-5">
      <Link href="/faculty" className="text-sm text-indigo-700 hover:underline">
        ← Back to the review queue
      </Link>

      {load.status === "loading" && <p role="status">Loading evaluation…</p>}
      {load.status === "missing" && (
        <p role="alert" className="rounded-md border border-slate-300 bg-white p-4">
          This evaluation does not exist.
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p>Could not load the evaluation: {load.message}</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className="mt-2 rounded-md border border-red-400 px-3 py-1 font-medium hover:bg-red-100"
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
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {project.title} · Week {e.weekNumber}
        </h1>
        <p className="text-sm text-slate-600">
          Repository: {project.repoUrl} · evaluated {new Date(e.createdAt).toLocaleString()} by {e.model}
        </p>
      </header>

      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        The AI&apos;s score is only a <strong>recommendation</strong>. Your decision below is the official result. A Git
        diff shows what changed; it is evidence of changes, not proof of who wrote the code or that the student
        understands it. The code was never run.
      </p>

      <section aria-labelledby="ai-heading" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 id="ai-heading" className="text-lg font-semibold">
          AI recommendation (not official)
        </h2>
        <p className="text-3xl font-semibold" aria-label={`AI suggested score ${e.suggestedScore} out of 100`}>
          {e.suggestedScore}
          <span className="text-lg font-normal text-slate-600"> / 100</span>
        </p>
        <p className="text-sm">
          Confidence: <strong>{e.confidence.level}</strong>
        </p>
        {e.confidence.uncertainties.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {e.confidence.uncertainties.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        )}

        <h3 className="pt-2 font-medium">Criteria</h3>
        <ul className="space-y-3">
          {e.criteriaAssessments.map((c) => (
            <li key={c.criterion} className="rounded-md border border-slate-200 p-3 text-sm">
              <p className="font-medium">
                {c.criterion}: {c.score}/{c.maxScore}
              </p>
              <p className="text-slate-700">{c.rationale}</p>
              {c.evidence.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">
                  {c.evidence.map((ev, i) => (
                    <li key={i}>
                      {ev.filePath && <code className="rounded bg-slate-100 px-1">{ev.filePath}</code>} {ev.summary}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-slate-500">No evidence cited.</p>
              )}
            </li>
          ))}
        </ul>

        <TextList title="Completed requirements" items={e.completedRequirements} />
        <TextList title="Incomplete requirements" items={e.incompleteRequirements} />
        <TextList title="Technical concerns" items={e.technicalConcerns} />
        <TextList title="AI's feedback for next week" items={e.feedbackForNextWeek} />
      </section>

      <section aria-labelledby="scope-heading" className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 id="scope-heading" className="text-lg font-semibold">
          What the AI could see
        </h2>
        <p>
          {scope.filesReviewed} of {scope.filesChanged} changed files reviewed
          {scope.patchesTruncated > 0 && `, ${scope.patchesTruncated} cut because of size`}
          {scope.filesBeyondLimit > 0 && `, ${scope.filesBeyondLimit} more beyond the file limit`}. Code executed: no.
        </p>
        {scope.notReviewed.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
            {scope.notReviewed.map((f) => (
              <li key={f.path}>
                <code className="rounded bg-slate-100 px-1">{f.path}</code> not reviewed ({REASON_LABEL[f.reason] ?? f.reason})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="diff-heading" className="space-y-2">
        <h2 id="diff-heading" className="text-lg font-semibold">
          Changes the AI was shown
        </h2>
        <p className="text-sm text-slate-600">
          {snapshot.totalFiles} {snapshot.totalFiles === 1 ? "file" : "files"} changed (+{snapshot.totalAdditions} −
          {snapshot.totalDeletions}) between the two recorded commits.
        </p>
        {snapshot.files.map((f) => (
          <details key={f.path} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              <code>{f.path}</code> · {f.status} · +{f.additions} −{f.deletions}
            </summary>
            {f.patch !== undefined ? (
              <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
                {f.patch}
                {f.patchTruncated ? "\n… (cut because of size)" : ""}
              </pre>
            ) : (
              <p className="mt-2 text-slate-600">The AI was not shown the contents of this file.</p>
            )}
          </details>
        ))}
        {snapshot.filesOmitted > 0 && (
          <p className="text-sm text-slate-600">{snapshot.filesOmitted} more files were not stored.</p>
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
      <h3 className="font-medium">{title}</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
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
    <section aria-labelledby="official-heading" className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm">
      <h2 id="official-heading" className="text-lg font-semibold">
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
          <p className="font-medium">Feedback shown to the student</p>
          <p className="whitespace-pre-line text-slate-800">{decision.approvedFeedback}</p>
        </div>
      )}
      {decision.comment && (
        <div>
          <p className="font-medium">Your private comment</p>
          <p className="whitespace-pre-line text-slate-800">{decision.comment}</p>
        </div>
      )}
      <p className="text-xs text-slate-600">Decided {new Date(decision.decidedAt).toLocaleString()}. This is final.</p>
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
    <section aria-labelledby="decision-heading" className="space-y-4 rounded-lg border border-indigo-300 bg-white p-4">
      <h2 id="decision-heading" className="text-lg font-semibold">
        Your decision
      </h2>

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-medium">What do you want to do?</legend>
        {(
          [
            ["approve", "Approve", "Use the AI's score and feedback as they are."],
            ["edit", "Edit", "Set your own score and feedback."],
            ["reject", "Reject", "The evaluation is not reliable; the student gets no score."],
          ] as const
        ).map(([value, label, help]) => (
          <label key={value} className="flex items-start gap-2 text-sm">
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
              className="mt-1"
            />
            <span>
              <span className="font-medium">{label}</span> – {help}
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
              className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1"
            />
            {errors.approvedScore && (
              <p id="score-error" role="alert" className="mt-1 text-sm text-red-800">
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
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
            {errors.approvedFeedback && (
              <p id="feedback-error" role="alert" className="mt-1 text-sm text-red-800">
                {errors.approvedFeedback}
              </p>
            )}
          </div>
        </div>
      )}

      {choice === "approve" && (
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <p className="font-medium">The student will see</p>
          <p>Official score: {e.suggestedScore}/100</p>
          <p className="whitespace-pre-line text-slate-700">{aiFeedback}</p>
        </div>
      )}

      <div>
        <label htmlFor="comment" className="block text-sm font-medium">
          {choice === "approve" ? "Private comment (optional)" : "Private comment (required)"}
        </label>
        <p className="text-xs text-slate-500">Only teachers see this. Students never do.</p>
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
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
        />
        {errors.comment && (
          <p id="comment-error" role="alert" className="mt-1 text-sm text-red-800">
            {errors.comment}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {formError}
        </p>
      )}

      {confirming ? (
        <div role="group" aria-label="Confirm decision" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="text-amber-950">{summary} A decision is final and cannot be changed.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-md bg-indigo-700 px-3 py-1.5 font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Yes, record decision"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={review}
          className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800"
        >
          Review decision
        </button>
      )}
    </section>
  );
}
