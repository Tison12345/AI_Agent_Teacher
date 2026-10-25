import { z } from "zod";
import { MAX_DURATION_WEEKS } from "@/lib/validation/project";

export const CommitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "Must be a full 40-character lowercase commit SHA.");

const iso = z.iso.datetime({ offset: true });

/**
 * The project's starting point: the default branch's latest commit when the
 * student began. Week 1 is compared against it. Recorded once, never changed.
 */
export const BaselineSchema = z.object({
  projectId: z.uuid(),
  commitSha: CommitShaSchema,
  branch: z.string().min(1),
  recordedAt: iso,
});

/**
 * A recorded checkpoint is only the commit SHA captured when the student
 * completes a week. It is NOT an evaluation and NOT an approved result; those
 * live in separate records created in later phases.
 */
export const CheckpointSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  weekNumber: z.number().int().min(1).max(MAX_DURATION_WEEKS),
  /** Latest pushed commit on the default branch when the week was completed. */
  commitSha: CommitShaSchema,
  /** Week 1: the baseline commit. Later weeks: the previous week's checkpoint commit. */
  baseCommitSha: CommitShaSchema,
  branch: z.string().min(1),
  /** Size of the change since the base, captured at record time. */
  filesChanged: z.number().int().min(0),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  recordedAt: iso,
});

export type Baseline = z.infer<typeof BaselineSchema>;
export type Checkpoint = z.infer<typeof CheckpointSchema>;

/** What the UI loads in one call. */
export const ProgressSchema = z.object({
  baseline: BaselineSchema.nullable(),
  checkpoints: z.array(CheckpointSchema),
  /** Evaluation state per week. Status only: the AI's score is never sent to students. */
  evaluations: z
    .array(
      z.object({
        weekNumber: z.number().int().min(1).max(MAX_DURATION_WEEKS),
        status: z.enum(["pending_review", "approved", "edited", "rejected"]),
      }),
    )
    .default([]),
});
export type Progress = z.infer<typeof ProgressSchema>;
