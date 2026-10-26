import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/db/supabase";
import { RepositoryError } from "@/lib/projects/repository";
import { QuizAttemptSchema, QuizSchema, type Quiz, type QuizAttempt } from "@/lib/schemas/quiz";
import { AttemptConflictError, QuizConflictError, type QuizStore } from "./service";

const QUIZ_COLUMNS = "id, project_id, checkpoint_id, week_number, questions, model, created_at";
const ATTEMPT_COLUMNS = "id, quiz_id, answers, correct_count, total, submitted_at";

const QuizRow = z.object({
  id: z.string(),
  project_id: z.string(),
  checkpoint_id: z.string(),
  week_number: z.number(),
  questions: z.unknown(),
  model: z.string(),
  created_at: z.string(),
});

const AttemptRow = z.object({
  id: z.string(),
  quiz_id: z.string(),
  answers: z.unknown(),
  correct_count: z.number(),
  total: z.number(),
  submitted_at: z.string(),
});

function toQuiz(raw: unknown): Quiz {
  const row = QuizRow.safeParse(raw);
  const quiz = row.success
    ? QuizSchema.safeParse({
        id: row.data.id,
        projectId: row.data.project_id,
        checkpointId: row.data.checkpoint_id,
        weekNumber: row.data.week_number,
        questions: row.data.questions,
        model: row.data.model,
        createdAt: row.data.created_at,
      })
    : null;
  if (!quiz?.success) throw new RepositoryError("invalid_data", "Stored quiz has an unexpected shape.");
  return quiz.data;
}

function toAttempt(raw: unknown): QuizAttempt {
  const row = AttemptRow.safeParse(raw);
  const attempt = row.success
    ? QuizAttemptSchema.safeParse({
        id: row.data.id,
        quizId: row.data.quiz_id,
        answers: row.data.answers,
        correctCount: row.data.correct_count,
        total: row.data.total,
        submittedAt: row.data.submitted_at,
      })
    : null;
  if (!attempt?.success) throw new RepositoryError("invalid_data", "Stored quiz attempt has an unexpected shape.");
  return attempt.data;
}

function fail(error: { code?: string; message: string }, onConflict?: () => Error): never {
  if (error.code === "23505" && onConflict) throw onConflict();
  if (error.code === "23503") throw new RepositoryError("not_found", "The checkpoint or quiz does not exist.");
  throw new RepositoryError("db_error", error.message);
}

/** Supabase-backed store. Quizzes and attempts are inserted once and never rewritten. */
export const quizStore: QuizStore = {
  async getByCheckpoint(checkpointId) {
    const db = getSupabase();
    const found = await db.from("quizzes").select(QUIZ_COLUMNS).eq("checkpoint_id", checkpointId).maybeSingle();
    if (found.error) fail(found.error);
    if (!found.data) return null;
    const quiz = toQuiz(found.data);

    const attempt = await db.from("quiz_attempts").select(ATTEMPT_COLUMNS).eq("quiz_id", quiz.id).maybeSingle();
    if (attempt.error) fail(attempt.error);
    return { quiz, attempt: attempt.data ? toAttempt(attempt.data) : null };
  },

  async insertQuiz(quiz) {
    const { data, error } = await getSupabase()
      .from("quizzes")
      .insert({
        project_id: quiz.projectId,
        checkpoint_id: quiz.checkpointId,
        week_number: quiz.weekNumber,
        questions: quiz.questions,
        model: quiz.model,
      })
      .select(QUIZ_COLUMNS)
      .single();
    if (error) fail(error, () => new QuizConflictError());
    return toQuiz(data);
  },

  async insertAttempt(attempt) {
    const { data, error } = await getSupabase()
      .from("quiz_attempts")
      .insert({
        quiz_id: attempt.quizId,
        answers: attempt.answers,
        correct_count: attempt.correctCount,
        total: attempt.total,
      })
      .select(ATTEMPT_COLUMNS)
      .single();
    if (error) fail(error, () => new AttemptConflictError());
    return toAttempt(data);
  },
};
