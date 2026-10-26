import type { GeminiClient } from "@/lib/gemini/client";
import type { CompareResult } from "@/lib/github/client";
import type { DiffLimits } from "@/lib/github/diff";
import { EVALUATION_DIFF_LIMITS } from "@/lib/evaluation/prompt";
import { toSnapshot } from "@/lib/evaluation/service";
import type { Checkpoint } from "@/lib/schemas/checkpoint";
import type { Quiz, QuizAttempt, QuizQuestion, QuizView } from "@/lib/schemas/quiz";
import type { StoredPlan } from "@/lib/schemas/weekly-plan";
import { generateQuizQuestions } from "./generator";
import type { RandomInt } from "./assemble";

export type QuizErrorCode =
  | "checkpoint_required"
  | "plan_required"
  | "nothing_to_ask"
  | "quiz_exists"
  | "quiz_not_found"
  | "already_attempted";

const MESSAGES: Record<QuizErrorCode, (week: number) => string> = {
  checkpoint_required: (week) => `Record Week ${week} first. The quiz is made from the code you recorded for that week.`,
  plan_required: () => "This project has no weekly plan yet. Generate the plan first, because the quiz uses the week's tasks.",
  nothing_to_ask: (week) =>
    `Week ${week} has no readable code changes to ask about (for example only images, generated files or deleted files).`,
  quiz_exists: (week) => `Week ${week} already has a quiz and it cannot be replaced.`,
  quiz_not_found: (week) => `Week ${week} has no quiz yet.`,
  already_attempted: (week) => `The Week ${week} quiz has already been taken. There is one attempt per quiz.`,
};

export class QuizError extends Error {
  constructor(
    readonly code: QuizErrorCode,
    readonly week: number,
  ) {
    super(MESSAGES[code](week));
    this.name = "QuizError";
  }
}

export class QuizConflictError extends Error {
  constructor() {
    super("Quiz already exists.");
    this.name = "QuizConflictError";
  }
}

export class AttemptConflictError extends Error {
  constructor() {
    super("Quiz attempt already exists.");
    this.name = "AttemptConflictError";
  }
}

export type StoredQuiz = { quiz: Quiz; attempt: QuizAttempt | null };

export type QuizStore = {
  getByCheckpoint(checkpointId: string): Promise<StoredQuiz | null>;
  /** Throws QuizConflictError if the checkpoint already has a quiz. */
  insertQuiz(quiz: {
    projectId: string;
    checkpointId: string;
    weekNumber: number;
    questions: QuizQuestion[];
    model: string;
  }): Promise<Quiz>;
  /** Throws AttemptConflictError if the quiz was already attempted. */
  insertAttempt(attempt: { quizId: string; answers: number[]; correctCount: number; total: number }): Promise<QuizAttempt>;
};

type CheckpointLookup = { getCheckpoint(projectId: string, weekNumber: number): Promise<Checkpoint | null> };

export type QuizDeps = {
  checkpoints: CheckpointLookup;
  quizzes: QuizStore;
};

export type GenerateQuizDeps = QuizDeps & {
  getPlan: (projectId: string) => Promise<StoredPlan | null>;
  github: {
    compareCommits(
      owner: string,
      repo: string,
      base: string,
      head: string,
      limits: DiffLimits,
      prioritize: boolean,
    ): Promise<CompareResult>;
  };
  gemini: { client: GeminiClient; model: string; random?: RandomInt };
};

/**
 * The browser's view of a quiz. Before the one attempt, correct answers and
 * explanations are not in the data at all; afterwards the full review is shown.
 */
export function toView({ quiz, attempt }: StoredQuiz): QuizView {
  if (!attempt) {
    return {
      state: "open",
      quizId: quiz.id,
      weekNumber: quiz.weekNumber,
      questions: quiz.questions.map((q) => ({ question: q.question, options: q.options })),
    };
  }
  return {
    state: "taken",
    quizId: quiz.id,
    weekNumber: quiz.weekNumber,
    questions: quiz.questions.map((q, i) => ({ ...q, chosenIndex: attempt.answers[i] })),
    correctCount: attempt.correctCount,
    total: attempt.total,
    submittedAt: attempt.submittedAt,
  };
}

/** The quiz for a week as the browser may see it, or null when there is none. */
export async function getQuizView(projectId: string, weekNumber: number, deps: QuizDeps): Promise<QuizView | null> {
  const checkpoint = await deps.checkpoints.getCheckpoint(projectId, weekNumber);
  if (!checkpoint) return null;
  const stored = await deps.quizzes.getByCheckpoint(checkpoint.id);
  return stored ? toView(stored) : null;
}

/**
 * Creates the quiz for one recorded week from that week's tasks and code changes.
 * One quiz per checkpoint; an existing quiz is never replaced, so a student cannot
 * keep asking until the questions suit them.
 */
export async function generateQuiz(
  target: { projectId: string; owner: string; repo: string; weekNumber: number },
  deps: GenerateQuizDeps,
): Promise<QuizView> {
  const { projectId, owner, repo, weekNumber } = target;

  const checkpoint = await deps.checkpoints.getCheckpoint(projectId, weekNumber);
  if (!checkpoint) throw new QuizError("checkpoint_required", weekNumber);
  if (await deps.quizzes.getByCheckpoint(checkpoint.id)) throw new QuizError("quiz_exists", weekNumber);

  const stored = await deps.getPlan(projectId);
  const week = stored?.plan[weekNumber - 1];
  if (!stored || !week) throw new QuizError("plan_required", weekNumber);

  const diff = await deps.github.compareCommits(
    owner,
    repo,
    checkpoint.baseCommitSha,
    checkpoint.commitSha,
    { ...EVALUATION_DIFF_LIMITS },
    true,
  );
  if (!diff.files.some((file) => file.patch && file.patch.trim())) {
    throw new QuizError("nothing_to_ask", weekNumber);
  }

  const questions = await generateQuizQuestions(
    { weekNumber, week, snapshot: toSnapshot(diff) },
    deps.gemini,
  );

  try {
    const quiz = await deps.quizzes.insertQuiz({
      projectId,
      checkpointId: checkpoint.id,
      weekNumber,
      questions,
      model: deps.gemini.model,
    });
    return toView({ quiz, attempt: null });
  } catch (error) {
    if (error instanceof QuizConflictError) throw new QuizError("quiz_exists", weekNumber);
    throw error;
  }
}

/** Grades and saves the student's one attempt. Grading happens here, never in the browser. */
export async function submitAttempt(
  target: { projectId: string; weekNumber: number },
  answers: number[],
  deps: QuizDeps,
): Promise<QuizView> {
  const { projectId, weekNumber } = target;
  const checkpoint = await deps.checkpoints.getCheckpoint(projectId, weekNumber);
  if (!checkpoint) throw new QuizError("checkpoint_required", weekNumber);
  const stored = await deps.quizzes.getByCheckpoint(checkpoint.id);
  if (!stored) throw new QuizError("quiz_not_found", weekNumber);
  if (stored.attempt) throw new QuizError("already_attempted", weekNumber);

  const { questions } = stored.quiz;
  const correctCount = questions.reduce((sum, q, i) => sum + (answers[i] === q.correctIndex ? 1 : 0), 0);
  try {
    const attempt = await deps.quizzes.insertAttempt({
      quizId: stored.quiz.id,
      answers,
      correctCount,
      total: questions.length,
    });
    return toView({ quiz: stored.quiz, attempt });
  } catch (error) {
    if (error instanceof AttemptConflictError) throw new QuizError("already_attempted", weekNumber);
    throw error;
  }
}
