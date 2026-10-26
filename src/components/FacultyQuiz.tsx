"use client";

import { useEffect, useState } from "react";
import { fetchReviewQuiz } from "@/lib/api/client";
import type { QuizView } from "@/lib/schemas/quiz";
import { QuizReview } from "./QuizPanel";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; quiz: QuizView | null };

/**
 * Faculty: the student's weekly quiz result, next to the AI recommendation. It is separate
 * evidence about understanding and is not part of the AI's score.
 */
export function FacultyQuiz({ evaluationId }: { evaluationId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchReviewQuiz(evaluationId).then(
      (quiz) => {
        if (!cancelled) setLoad({ status: "ready", quiz });
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the quiz." });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [evaluationId]);

  return (
    <section aria-labelledby="quiz-heading" className="card space-y-4 p-6">
      <h2 id="quiz-heading" className="text-xl font-semibold">
        Student quiz (separate evidence)
      </h2>
      {load.status === "loading" && <p role="status">Loading quiz result…</p>}
      {load.status === "error" && (
        <p role="alert" className="alert-danger">
          Could not load the quiz result: {load.message}
        </p>
      )}
      {load.status === "ready" && !load.quiz && (
        <p className="text-sm text-fg">No quiz has been created for this week. The student has not started it.</p>
      )}
      {load.status === "ready" && load.quiz?.state === "open" && (
        <p className="text-sm text-fg">
          A quiz exists for this week, but the student has not submitted an attempt yet.
        </p>
      )}
      {load.status === "ready" && load.quiz?.state === "taken" && (
        <>
          <p className="text-sm text-muted">
            The quiz is about the student&apos;s own code changes. It shows whether they can explain what they pushed; it
            does not change the AI&apos;s score.
          </p>
          <QuizReview quiz={load.quiz} />
        </>
      )}
    </section>
  );
}
