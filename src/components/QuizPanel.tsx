"use client";

import { useState } from "react";
import { createQuiz, fetchQuiz, submitQuiz } from "@/lib/api/client";
import { QUIZ_QUESTION_COUNT, type QuizView } from "@/lib/schemas/quiz";

type Phase =
  | { status: "idle" }
  | { status: "loading"; creating: boolean }
  | { status: "error"; message: string }
  | { status: "ready"; quiz: QuizView };

const LETTERS = ["A", "B", "C", "D"];

/** Student: the quiz for one recorded week. Nothing is requested until the student asks for it. */
export function QuizPanel({ projectId, week }: { projectId: string; week: number }) {
  const [phase, setPhase] = useState<Phase>({ status: "idle" });

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
    <div className="mt-3 border-t border-slate-100 pt-3">
      {phase.status === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={start}
            className="rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-800 hover:bg-indigo-50"
          >
            Week {week} quiz
          </button>
          <span className="text-xs text-slate-600">
            {QUIZ_QUESTION_COUNT} multiple-choice questions about your code. One attempt.
          </span>
        </div>
      )}

      {phase.status === "loading" && (
        <p role="status" className="text-xs text-indigo-800">
          {phase.creating
            ? "Writing your quiz from your code changes… this can take up to a minute."
            : "Loading your quiz…"}
        </p>
      )}

      {phase.status === "error" && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p>{phase.message}</p>
          <button
            type="button"
            onClick={start}
            className="mt-2 rounded-md border border-red-400 px-3 py-1 font-medium hover:bg-red-100"
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
      {phase.status === "ready" && phase.quiz.state === "taken" && <QuizReview quiz={phase.quiz} />}
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
      <p className="text-sm text-slate-700">
        Answer all {quiz.questions.length} questions. You can submit <strong>once</strong>; the correct answers appear
        afterwards. The quiz helps your teacher see whether you understand the code you pushed.
      </p>
      {quiz.questions.map((q, qi) => (
        <fieldset key={qi} className="space-y-1.5 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium">
            {qi + 1}. {q.question}
          </legend>
          {q.options.map((option, oi) => (
            <label key={oi} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name={`q${qi}`}
                checked={answers[qi] === oi}
                onChange={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)))}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{LETTERS[oi]}.</span> {option}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!complete || sending}
        className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {sending ? "Submitting…" : "Submit my answers"}
      </button>
      {!complete && <p className="text-xs text-slate-600">Choose one option for every question to submit.</p>}
    </form>
  );
}

/** The graded quiz: score, each answer, the correct one and the explanation. Shared with the faculty page. */
export function QuizReview({ quiz }: { quiz: Extract<QuizView, { state: "taken" }> }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium" aria-label={`Quiz result ${quiz.correctCount} out of ${quiz.total}`}>
        Quiz result: {quiz.correctCount}/{quiz.total} correct
        <span className="font-normal text-slate-600"> · submitted {new Date(quiz.submittedAt).toLocaleString()}</span>
      </p>
      <ol className="space-y-3">
        {quiz.questions.map((q, qi) => {
          const right = q.chosenIndex === q.correctIndex;
          return (
            <li
              key={qi}
              className={`rounded-md border p-3 text-sm ${right ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}
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
              <p className="mt-1 text-slate-700">{q.explanation}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
