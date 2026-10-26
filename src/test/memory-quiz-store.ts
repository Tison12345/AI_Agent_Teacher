import { QuizAttemptSchema, QuizSchema, type Quiz, type QuizAttempt } from "@/lib/schemas/quiz";
import { AttemptConflictError, QuizConflictError, type QuizStore } from "@/lib/quiz/service";

/** In-memory quiz store with the database's one-quiz-per-checkpoint and one-attempt-per-quiz rules. */
export function memoryQuizStore() {
  const quizzes: Quiz[] = [];
  const attempts: QuizAttempt[] = [];
  let n = 0;
  const id = () => `00000000-0000-4000-a000-${String(++n).padStart(12, "0")}`;
  const tick = () => Promise.resolve(); // lets concurrent calls interleave

  const store: QuizStore = {
    async getByCheckpoint(checkpointId) {
      await tick();
      const quiz = quizzes.find((q) => q.checkpointId === checkpointId);
      if (!quiz) return null;
      return { quiz, attempt: attempts.find((a) => a.quizId === quiz.id) ?? null };
    },
    async insertQuiz(q) {
      await tick();
      if (quizzes.some((x) => x.checkpointId === q.checkpointId)) throw new QuizConflictError();
      const quiz = QuizSchema.parse({ id: id(), ...q, createdAt: "2026-10-27T10:00:00+00:00" });
      quizzes.push(quiz);
      return quiz;
    },
    async insertAttempt(a) {
      await tick();
      if (attempts.some((x) => x.quizId === a.quizId)) throw new AttemptConflictError();
      const attempt = QuizAttemptSchema.parse({ id: id(), ...a, submittedAt: "2026-10-27T10:05:00+00:00" });
      attempts.push(attempt);
      return attempt;
    },
  };
  return { store, quizzes, attempts };
}
