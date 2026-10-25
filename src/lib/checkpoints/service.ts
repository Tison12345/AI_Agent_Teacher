import { PROJECT_DURATION_WEEKS } from "@/lib/validation/project";
import type { Baseline, Checkpoint } from "@/lib/schemas/checkpoint";

/*
 * Checkpoint policy (Phase 5)
 * - Baseline: the default branch's latest commit when the student clicks
 *   "Record starting point". Recorded once, immutable. Week 1 compares against it.
 * - Week N (N > 1) compares against the checkpoint recorded for week N-1. It is the
 *   RECORDED checkpoint, not an approved one, so a slow teacher never blocks a student.
 * - Weeks are completed in order. Each week is recorded exactly once.
 * - The checkpoint is the latest commit on the default branch at the moment of
 *   confirmation. Commit messages are never used, and any number of commits may
 *   be pushed during the week.
 * - Nothing is recorded if there is nothing to evaluate (no new commits, an empty
 *   diff) or the history no longer contains the base (e.g. a force push).
 */

export type CheckpointErrorCode =
  | "invalid_week"
  | "baseline_required"
  | "baseline_exists"
  | "previous_week_required"
  | "already_recorded"
  | "no_new_commits"
  | "empty_diff"
  | "history_changed";

const baseLabel = (week: number) => (week === 1 ? "your starting point" : `Week ${week - 1}'s checkpoint`);

function message(code: CheckpointErrorCode, week?: number): string {
  switch (code) {
    case "invalid_week":
      return `Week must be a whole number from 1 to ${PROJECT_DURATION_WEEKS}.`;
    case "baseline_required":
      return "Record your starting point before completing Week 1.";
    case "baseline_exists":
      return "Your starting point is already recorded and cannot be changed.";
    case "previous_week_required":
      return `Complete Week ${(week ?? 2) - 1} first. Weeks must be completed in order.`;
    case "already_recorded":
      return `Week ${week} is already recorded and cannot be changed.`;
    case "no_new_commits":
      return `No new commits since ${baseLabel(week ?? 1)}. Push your work to GitHub, then try again.`;
    case "empty_diff":
      return `Your new commits since ${baseLabel(week ?? 1)} do not change any files. Push your work, then try again.`;
    case "history_changed":
      return `Your branch no longer contains ${baseLabel(week ?? 1)}, for example after a force push. Please ask your teacher for help.`;
  }
}

export class CheckpointError extends Error {
  constructor(
    readonly code: CheckpointErrorCode,
    readonly week?: number,
    /** For already_recorded: the checkpoint that already exists. */
    readonly existing?: Checkpoint,
  ) {
    super(message(code, week));
    this.name = "CheckpointError";
  }
}

/** Thrown by a store when a uniqueness rule is violated. */
export class StoreConflictError extends Error {
  constructor() {
    super("Record already exists.");
    this.name = "StoreConflictError";
  }
}

export type NewBaseline = Pick<Baseline, "projectId" | "commitSha" | "branch">;
export type NewCheckpoint = Omit<Checkpoint, "id" | "recordedAt">;

export type CheckpointStore = {
  getBaseline(projectId: string): Promise<Baseline | null>;
  insertBaseline(baseline: NewBaseline): Promise<Baseline>;
  getCheckpoint(projectId: string, weekNumber: number): Promise<Checkpoint | null>;
  listCheckpoints(projectId: string): Promise<Checkpoint[]>;
  insertCheckpoint(checkpoint: NewCheckpoint): Promise<Checkpoint>;
};

/** The slice of the GitHub client the service needs. */
export type GitHubReader = {
  getRepository(owner: string, repo: string): Promise<{ default_branch: string }>;
  getHeadCommit(owner: string, repo: string, branch: string): Promise<{ sha: string }>;
  compareCommits(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<{
    status: string;
    isEmpty: boolean;
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  }>;
};

export type Deps = { store: CheckpointStore; github: GitHubReader };
type Target = { projectId: string; owner: string; repo: string };

async function currentHead(github: GitHubReader, { owner, repo }: Target) {
  const repository = await github.getRepository(owner, repo);
  const head = await github.getHeadCommit(owner, repo, repository.default_branch);
  return { sha: head.sha, branch: repository.default_branch };
}

/** Records the starting point once. Never replaces an existing one. */
export async function recordBaseline(target: Target, { store, github }: Deps): Promise<Baseline> {
  if (await store.getBaseline(target.projectId)) throw new CheckpointError("baseline_exists");

  // An empty repository fails here with GitHub's empty_repository error.
  const head = await currentHead(github, target);
  try {
    return await store.insertBaseline({
      projectId: target.projectId,
      commitSha: head.sha,
      branch: head.branch,
    });
  } catch (error) {
    if (error instanceof StoreConflictError) throw new CheckpointError("baseline_exists");
    throw error;
  }
}

/**
 * Records the student's latest pushed commit as the checkpoint for `weekNumber`.
 * Safe to call repeatedly or concurrently: at most one checkpoint per week is stored.
 */
export async function completeWeek(
  target: Target & { weekNumber: number },
  { store, github }: Deps,
): Promise<Checkpoint> {
  const { projectId, owner, repo, weekNumber } = target;
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > PROJECT_DURATION_WEEKS) {
    throw new CheckpointError("invalid_week");
  }

  // Never overwrite: an existing checkpoint is returned inside the error.
  const existing = await store.getCheckpoint(projectId, weekNumber);
  if (existing) throw new CheckpointError("already_recorded", weekNumber, existing);

  let baseSha: string;
  if (weekNumber === 1) {
    const baseline = await store.getBaseline(projectId);
    if (!baseline) throw new CheckpointError("baseline_required");
    baseSha = baseline.commitSha;
  } else {
    const previous = await store.getCheckpoint(projectId, weekNumber - 1);
    if (!previous) throw new CheckpointError("previous_week_required", weekNumber);
    baseSha = previous.commitSha;
  }

  const head = await currentHead(github, target);
  if (head.sha === baseSha) throw new CheckpointError("no_new_commits", weekNumber);

  const comparison = await github.compareCommits(owner, repo, baseSha, head.sha);
  if (comparison.status === "identical") throw new CheckpointError("no_new_commits", weekNumber);
  if (comparison.status !== "ahead") throw new CheckpointError("history_changed", weekNumber);
  if (comparison.isEmpty) throw new CheckpointError("empty_diff", weekNumber);

  try {
    return await store.insertCheckpoint({
      projectId,
      weekNumber,
      commitSha: head.sha,
      baseCommitSha: baseSha,
      branch: head.branch,
      filesChanged: comparison.totalFiles,
      additions: comparison.totalAdditions,
      deletions: comparison.totalDeletions,
    });
  } catch (error) {
    if (error instanceof StoreConflictError) {
      // Lost a race with another click: report the winner, change nothing.
      const winner = await store.getCheckpoint(projectId, weekNumber);
      throw new CheckpointError("already_recorded", weekNumber, winner ?? undefined);
    }
    throw error;
  }
}

export async function getProgress(projectId: string, store: CheckpointStore) {
  const [baseline, checkpoints] = await Promise.all([
    store.getBaseline(projectId),
    store.listCheckpoints(projectId),
  ]);
  return { baseline, checkpoints };
}
