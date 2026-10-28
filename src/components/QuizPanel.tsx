"use client";

import { useEffect, useState } from "react";
import { createQuiz, fetchQuiz, submitQuiz } from "@/lib/api/client";
import { QUIZ_QUESTION_COUNT, type QuizView } from "@/lib/schemas/quiz";
import { Disclosure } from "./ui";

type Phase =
  | { status: "idle" }
  | { status: "loading"; creating: boolean }
  | { status: "error"; message: string }
  | { status: "ready"; quiz: QuizView };

const LETTERS = ["A", "B", "C", "D"];

/** Student: the quiz for one recorded week. Nothing is requested until the student asks for it. */
export function QuizPanel({ projectId, week }: { projectId: string; week: number }) {
  const [phase, setPhase] = useState<Phase>({ status: "idle" });

  // A quiz that was already taken shows its result straight away (collapsed). This only reads:
  // nothing is created until the student asks for it.
  useEffect(() => {
    let cancelled = false;
    fetchQuiz(projectId, week).then(
      (quiz) => {
        if (!cancelled && quiz?.state === "taken") setPhase((p) => (p.status === "idle" ? { status: "ready", quiz } : p));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, week]);

  async function start() {
    setPhase({ status: "loading", creating: false });
    try {
      let quiz = await fetchQuiz(projectId, week);
      if (!quiz) {
        setPhase({ status: "loading", creating: true });
        const created = await createQuiz(projectId, week);
        if (created.ok) {
          quiz = created.quiz;
        } else if (created.code === "quiz_exists") {
          quiz = await fetchQuiz(projectId, week); // another request created it first
        } else {
          setPhase({ status: "error", message: created.message });
          return;
        }
      }
      if (quiz) setPhase({ status: "ready", quiz });
      else setPhase({ status: "error", message: "The quiz could not be loaded. Please try again." });
    } catch (error) {
      setPhase({
        status: "error",
        message: error instanceof Error ? error.message : "Could not reach the server. Please try again.",
      });
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      {phase.status === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={start}
            className="btn-secondary btn-sm border-primary/40 text-link"
          >
            Week {week} quiz
          </button>
          <span className="text-xs text-muted">
            {QUIZ_QUESTION_COUNT} multiple-choice questions about your code. One attempt.
          </span>
        </div>
      )}

      {phase.status === "loading" && (
        <p role="status" className="text-xs text-link">
          {phase.creating
            ? "Writing your quiz from your code changes… this can take up to a minute."
            : "Loading your quiz…"}
        </p>
      )}

      {phase.status === "error" && (
        <div role="alert" className="alert-danger">
          <p>{phase.message}</p>
          <button
            type="button"
            onClick={start}
            className="btn-secondary btn-sm mt-3"
          >
            Try again
          </button>
        </div>
      )}

      {phase.status === "ready" && phase.quiz.state === "open" && (
        <QuizForm
          quiz={phase.quiz}
          projectId={projectId}
          week={week}
          onSubmitted={(quiz) => setPhase({ status: "ready", quiz })}
        />
      )}
      {phase.status === "ready" && phase.quiz.state === "taken" && <QuizReview quiz={phase.quiz} week={week} />}
    </div>
  );
}

function QuizForm({
  quiz,
  projectId,
  week,
  onSubmitted,
}: {
  quiz: Extract<QuizView, { state: "open" }>;
  projectId: string;
  week: number;
  onSubmitted: (quiz: QuizView) => void;
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => quiz.questions.map(() => null));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = answers.every((a) => a !== null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await submitQuiz(projectId, week, answers as number[]);
      if (result.ok) onSubmitted(result.quiz);
      else if (result.code === "already_attempted") {
        // Taken elsewhere: show the saved result instead of the empty form.
        const saved = await fetchQuiz(projectId, week).catch(() => null);
        if (saved) onSubmitted(saved);
        else setError(result.message);
      } else setError(result.message);
    } catch {
      setError("Could not reach the server. Your answers were not lost; please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label={`Week ${week} quiz`}>
      <p className="text-sm text-fg">
        Answer all {quiz.questions.length} questions. You can submit <strong>once</strong>; the correct answers appear
        afterwards. The quiz helps your teacher see whether you understand the code you pushed.
      </p>
      {quiz.questions.map((q, qi) => (
        <fieldset key={qi} className="well space-y-2 p-4">
          <legend className="px-1 text-sm font-semibold">
            {qi + 1}. {q.question}
          </legend>
          {q.options.map((option, oi) => (
            <label
              key={oi}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm transition duration-150 hover:bg-card-hover has-[:checked]:bg-primary/15"
            >
              <input
                type="radio"
                name={`q${qi}`}
                checked={answers[qi] === oi}
                onChange={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)))}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <span>
                <span className="font-medium">{LETTERS[oi]}.</span> {option}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="alert-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!complete || sending}
        className="btn-primary"
      >
        {sending ? "Submitting…" : "Submit my answers"}
      </button>
      {!complete && <p className="text-xs text-muted">Choose one option for every question to submit.</p>}
    </form>
  );
}

/**
 * The graded quiz. Collapsed by default: the header always shows the week, the score and when it
 * was submitted; opening it shows each answer, the correct one and the explanation. Shared with
 * the faculty page.
 */
export function QuizReview({ quiz, week }: { quiz: Extract<QuizView, { state: "taken" }>; week?: number }) {
  const submitted = new Date(quiz.submittedAt).toLocaleString();
  return (
    <Disclosure
      className="well p-3"
      summary={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-1">
          <span className="text-sm font-semibold">{week ? `Week ${week} quiz` : "Quiz result"}</span>
          <span className="badge-primary">
            {quiz.correctCount}/{quiz.total} correct
          </span>
          <span className="badge-neutral">Submitted {submitted}</span>
        </span>
      }
    >
      <ol className="space-y-3">
        {quiz.questions.map((q, qi) => {
          const right = q.chosenIndex === q.correctIndex;
          return (
            <li
              key={qi}
              className={`rounded-xl border border-l-4 p-4 text-sm ${right ? "border-success/30 border-l-success bg-success/10" : "border-warning/30 border-l-warning bg-warning/10"}`}
            >
              <p className="font-medium">
                {qi + 1}. {q.question}
              </p>
              <p className="mt-1">
                <span className="font-medium">{right ? "Correct" : "Not correct"}.</span> Answered{" "}
                <strong>
                  {LETTERS[q.chosenIndex]}. {q.options[q.chosenIndex]}
                </strong>
              </p>
              {!right && (
                <p>
                  Right answer:{" "}
                  <strong>
                    {LETTERS[q.correctIndex]}. {q.options[q.correctIndex]}
                  </strong>
                </p>
              )}
              <p className="mt-1 text-fg">{q.explanation}</p>
            </li>
          );
        })}
      </ol>
    </Disclosure>
  );
}
