"use client";

import { useState, type FormEvent } from "react";
import { decideSubmission } from "@/lib/api/client";
import type { Question } from "@/lib/schemas/assignment";
import type { FacultySubmission } from "@/lib/schemas/submission";
import { OfficialDecision } from "./OfficialDecision";
import { Disclosure } from "./ui";

/** The AI's recommendation. Labelled as not official everywhere it appears. */
export function AiRecommendation({ submission: s, questions, maxMarks }: { submission: FacultySubmission; questions: Question[]; maxMarks: number }) {
  const ai = s.aiResult;
  if (!ai) return null;
  return (
    <section aria-labelledby="ai-heading" className="card space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ai-heading" className="text-lg font-semibold">
          AI recommendation
        </h2>
        <span className="badge-neutral">Not official</span>
      </div>
      <p className="text-sm text-muted">
        A suggestion to help you review{s.aiModel ? ` (${s.aiModel})` : ""}. Nothing is shown to the student until you decide. The AI cannot run
        code, and a quote below is only evidence that the words are in the answer, not that they are right.
      </p>
      <p className="flex items-baseline gap-1.5" aria-label={`The AI recommends ${s.aiTotal ?? 0} out of ${maxMarks}`}>
        <span className="text-4xl font-bold tabular-nums tracking-tight">{s.aiTotal ?? 0}</span>
        <span className="text-lg font-medium text-muted">/ {maxMarks} recommended</span>
      </p>
      {ai.notes.length > 0 && (
        <ul className="alert-warning list-disc space-y-0.5 pl-5 text-sm">
          {ai.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <ol className="space-y-3">
        {ai.questions.map((q) => {
          const question = questions.find((x) => x.number === q.number);
          return (
            <li key={q.number} className="well p-3 text-sm">
              <Disclosure
                summary={
                  <span className="flex flex-wrap items-start justify-between gap-2 p-1">
                    <span className="min-w-0 flex-1 font-semibold">
                      {q.number}. {question?.text ?? `Question ${q.number}`}
                    </span>
                    <span className="badge-primary shrink-0">
                      {q.marks} / {q.maxMarks}
                    </span>
                  </span>
                }
              >
                <div className="space-y-2 px-1 pb-1">
                  <p className="whitespace-pre-line text-fg">{q.explanation}</p>
                  {q.quotes.length > 0 && (
                    <div>
                      <p className="eyebrow">Quoted from the answer</p>
                      <ul className="mt-1 space-y-1">
                        {q.quotes.map((quote) => (
                          <li key={quote}>
                            <blockquote className="border-l-2 border-line pl-3 text-muted">{quote}</blockquote>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </Disclosure>
            </li>
          );
        })}
      </ol>
      <div>
        <p className="eyebrow">Draft feedback for the student</p>
        <p className="mt-1 whitespace-pre-line text-sm text-fg">{ai.feedback}</p>
      </div>
    </section>
  );
}

type Mode = "idle" | "edit";

/** Approve, edit or reject. A decision is final, so the page says so before anything is sent. */
export function DecisionPanel({
  submission: s,
  questions,
  maxMarks,
  onDecided,
}: {
  submission: FacultySubmission;
  questions: Question[];
  maxMarks: number;
  onDecided: (submission: FacultySubmission) => void;
}) {
  const ai = s.aiResult;
  const [mode, setMode] = useState<Mode>("idle");
  const [marks, setMarks] = useState<Record<number, string>>(() => Object.fromEntries((ai?.questions ?? []).map((q) => [q.number, String(q.marks)])));
  const [feedback, setFeedback] = useState(ai?.feedback ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  if (!ai) return null;

  async function send(decision: Parameters<typeof decideSubmission>[1]) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setFields({});
    try {
      const result = await decideSubmission(s.id, decision);
      if (result.ok) onDecided(result.submission);
      else {
        setMessage(result.message);
        setFields(result.fields ?? {});
      }
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    const scores = questions.map((q) => {
      const raw = marks[q.number] ?? "";
      const value = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(value) || value < 0 || value > q.maxMarks) {
        problems[`marks-${q.number}`] = `Enter 0 to ${q.maxMarks}.`;
      } else if (Math.round(value * 100) / 100 !== value) {
        problems[`marks-${q.number}`] = "Use at most 2 decimal places.";
      }
      return { number: q.number, marks: value };
    });
    if (!feedback.trim()) problems.feedback = "Write the feedback the student will see.";
    if (!comment.trim()) problems.comment = "Explain why you changed the AI's recommendation.";
    setFields(problems);
    if (Object.keys(problems).length > 0) return;
    void send({ decision: "edit", scores, feedback: feedback.trim(), comment: comment.trim() });
  }

  const editedTotal = questions.reduce((sum, q) => sum + (Number.isFinite(Number(marks[q.number])) ? Number(marks[q.number] || 0) : 0), 0);

  return (
    <section aria-labelledby="decision-heading" className="card-official space-y-4 p-6 text-sm">
      <h2 id="decision-heading" className="text-lg font-semibold text-official-fg">
        Your decision
      </h2>
      <p className="text-official-ink">
        The marks the student sees are the ones you decide here, not the AI&apos;s. <strong>A decision is final and cannot be changed.</strong>
      </p>

      {mode === "idle" && (
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => send({ decision: "approve" })} className="btn-primary">
            Approve the AI&apos;s {s.aiTotal} / {maxMarks}
          </button>
          <button type="button" disabled={busy} onClick={() => setMode("edit")} className="btn-secondary">
            Edit marks and feedback
          </button>
          <button type="button" disabled={busy} onClick={() => send({ decision: "reject" })} className="btn-secondary">
            Reject (no marks)
          </button>
        </div>
      )}

      {mode === "edit" && (
        <form onSubmit={handleEdit} noValidate aria-label="Edit marks" className="space-y-4">
          <ul className="space-y-3">
            {questions.map((q) => (
              <li key={q.number}>
                <label htmlFor={`marks-${q.number}`} className="block font-medium text-fg">
                  Question {q.number} marks (0 to {q.maxMarks})
                </label>
                <input
                  id={`marks-${q.number}`}
                  inputMode="decimal"
                  className="field mt-1 block w-32 aria-[invalid=true]:border-danger"
                  value={marks[q.number] ?? ""}
                  aria-invalid={Boolean(fields[`marks-${q.number}`])}
                  onChange={(e) => setMarks((m) => ({ ...m, [q.number]: e.target.value }))}
                />
                {fields[`marks-${q.number}`] && (
                  <p role="alert" className="mt-1 text-danger">
                    {fields[`marks-${q.number}`]}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-official-ink">
            Total: <strong>{Math.round(editedTotal * 100) / 100}</strong> / {maxMarks}
          </p>
          <div>
            <label htmlFor="decision-feedback" className="block font-medium text-fg">
              Feedback the student will see
            </label>
            <textarea
              id="decision-feedback"
              rows={4}
              className="field mt-1 block w-full aria-[invalid=true]:border-danger"
              value={feedback}
              aria-invalid={Boolean(fields.feedback)}
              onChange={(e) => setFeedback(e.target.value)}
            />
            {fields.feedback && (
              <p role="alert" className="mt-1 text-danger">
                {fields.feedback}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="decision-comment" className="block font-medium text-fg">
              Private comment (why you changed it; the student never sees this)
            </label>
            <textarea
              id="decision-comment"
              rows={3}
              className="field mt-1 block w-full aria-[invalid=true]:border-danger"
              value={comment}
              aria-invalid={Boolean(fields.comment)}
              onChange={(e) => setComment(e.target.value)}
            />
            {fields.comment && (
              <p role="alert" className="mt-1 text-danger">
                {fields.comment}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Saving…" : "Save the edited decision"}
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("idle")} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      {message && (
        <p role="alert" className="alert-danger">
          {message}
        </p>
      )}
    </section>
  );
}

/** The official result once faculty have decided. The status shown is the real one. */
export function OfficialResult({ submission: s, questions, maxMarks }: { submission: FacultySubmission; questions: Question[]; maxMarks: number }) {
  const d = s.decision;
  if (!d) return null;
  const status = d.decision === "approve" ? "approved" : d.decision === "edit" ? "edited" : "rejected";
  return (
    <OfficialDecision
      status={status}
      score={d.finalTotal}
      max={maxMarks}
      feedback={d.feedback}
      decidedAt={d.decidedAt}
      note={s.aiTotal !== null && d.decision !== "approve" ? `The AI had recommended ${s.aiTotal} / ${maxMarks}.` : undefined}
    >
      {d.scores && (
        <ul className="space-y-1 border-t border-official/40 pt-4 text-official-fg">
          {d.scores.map((score) => {
            const q = questions.find((x) => x.number === score.number);
            return (
              <li key={score.number} className="flex justify-between gap-3">
                <span>Question {score.number}</span>
                <span className="tabular-nums">
                  {score.marks} / {q?.maxMarks ?? "?"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {d.comment && (
        <div className="border-t border-official/40 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-official-ink">Private comment (faculty only)</h3>
          <p className="mt-1 whitespace-pre-line text-official-fg">{d.comment}</p>
        </div>
      )}
    </OfficialDecision>
  );
}
