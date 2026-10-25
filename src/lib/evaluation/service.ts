import type { GeminiClient } from "@/lib/gemini/client";
import type { DiffLimits } from "@/lib/github/diff";
import type { CompareResult } from "@/lib/github/client";
import type { Checkpoint } from "@/lib/schemas/checkpoint";
import type { Evaluation, Snapshot } from "@/lib/schemas/evaluation";
import type { StoredPlan } from "@/lib/schemas/weekly-plan";
import { generateEvaluation } from "./generator";
import type { AssembledEvaluation } from "./assemble";
import { EVALUATION_DIFF_LIMITS, type PreviousWeekContext } from "./prompt";

export type EvaluationErrorCode = "checkpoint_required" | "plan_required" | "evaluation_exists";

const MESSAGES: Record<EvaluationErrorCode, (week: number) => string> = {
  checkpoint_required: (week) => `Record Week ${week} first. An evaluation is made from the recorded checkpoint.`,
  plan_required: () => "This project has no 12-week plan yet. Generate the plan first, because the evaluation uses its tasks and criteria.",
  evaluation_exists: (week) => `Week ${week} already has an evaluation and it cannot be replaced.`,
};

export class EvaluationError extends Error {
  constructor(
    readonly code: EvaluationErrorCode,
    readonly week: number,
    /** For evaluation_exists: the status of the existing evaluation. */
    readonly existingStatus?: Evaluation["status"],
  ) {
    super(MESSAGES[code](week));
    this.name = "EvaluationError";
  }
}

export type StoredEvaluation = { evaluation: Evaluation; snapshot: Snapshot };
export type NewEvaluation = {
  projectId: string;
  checkpointId: string;
  weekNumber: number;
  result: AssembledEvaluation;
  snapshot: Snapshot;
  model: string;
};

export class EvaluationConflictError extends Error {
  constructor() {
    super("Evaluation already exists.");
    this.name = "EvaluationConflictError";
  }
}

export type EvaluationStore = {
  getByCheckpoint(checkpointId: string): Promise<StoredEvaluation | null>;
  /** Throws EvaluationConflictError if the checkpoint already has an evaluation. */
  insert(evaluation: NewEvaluation): Promise<StoredEvaluation>;
  listStatuses(projectId: string): Promise<{ weekNumber: number; status: Evaluation["status"] }[]>;
};

export type EvaluationDeps = {
  checkpoints: { getCheckpoint(projectId: string, weekNumber: number): Promise<Checkpoint | null> };
  evaluations: EvaluationStore;
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
  gemini: { client: GeminiClient; model: string };
};

function toSnapshot(diff: CompareResult): Snapshot {
  return {
    baseSha: diff.baseSha,
    headSha: diff.headSha,
    files: diff.files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
      patchTruncated: file.patchTruncated,
      patchOmittedReason: file.patchOmittedReason,
    })),
    totalFiles: diff.totalFiles,
    totalAdditions: diff.totalAdditions,
    totalDeletions: diff.totalDeletions,
    filesOmitted: diff.filesOmitted,
    truncated: diff.truncated,
  };
}

/**
 * Evaluates one recorded week: fetches that checkpoint's diff, asks Gemini for a
 * structured review, validates it, and stores it as pending teacher review.
 * One evaluation per checkpoint; an existing one is never replaced.
 */
export async function evaluateWeek(
  target: { projectId: string; owner: string; repo: string; weekNumber: number },
  deps: EvaluationDeps,
): Promise<StoredEvaluation> {
  const { projectId, owner, repo, weekNumber } = target;

  const checkpoint = await deps.checkpoints.getCheckpoint(projectId, weekNumber);
  if (!checkpoint) throw new EvaluationError("checkpoint_required", weekNumber);

  const existing = await deps.evaluations.getByCheckpoint(checkpoint.id);
  if (existing) throw new EvaluationError("evaluation_exists", weekNumber, existing.evaluation.status);

  const stored = await deps.getPlan(projectId);
  const week = stored?.plan[weekNumber - 1];
  if (!stored || !week) throw new EvaluationError("plan_required", weekNumber);

  // Context from the previous week: its title and what an earlier AI review found unfinished.
  let previous: PreviousWeekContext = null;
  if (weekNumber > 1) {
    const previousCheckpoint = await deps.checkpoints.getCheckpoint(projectId, weekNumber - 1);
    const previousEvaluation = previousCheckpoint
      ? await deps.evaluations.getByCheckpoint(previousCheckpoint.id)
      : null;
    previous = {
      weekNumber: weekNumber - 1,
      title: stored.plan[weekNumber - 2]?.title ?? `Week ${weekNumber - 1}`,
      openItemsFromEarlierAiReview: previousEvaluation?.evaluation.incompleteRequirements.slice(0, 6) ?? [],
    };
  }

  // The diff is always between the two recorded SHAs. Commit messages are never read.
  const diff = await deps.github.compareCommits(
    owner,
    repo,
    checkpoint.baseCommitSha,
    checkpoint.commitSha,
    { ...EVALUATION_DIFF_LIMITS },
    true,
  );
  const snapshot = toSnapshot(diff);

  const result = await generateEvaluation(
    { weekNumber, week, previous, snapshot },
    deps.gemini,
  );

  try {
    return await deps.evaluations.insert({
      projectId,
      checkpointId: checkpoint.id,
      weekNumber,
      result,
      snapshot,
      model: deps.gemini.model,
    });
  } catch (error) {
    if (error instanceof EvaluationConflictError) {
      // Another request finished first; report it and change nothing.
      const winner = await deps.evaluations.getByCheckpoint(checkpoint.id);
      throw new EvaluationError("evaluation_exists", weekNumber, winner?.evaluation.status);
    }
    throw error;
  }
}
