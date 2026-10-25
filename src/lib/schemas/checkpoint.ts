import { z } from "zod";
import { PROJECT_DURATION_WEEKS } from "@/lib/validation/project";

export const CommitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "Must be a full 40-character lowercase commit SHA.");

/**
 * A recorded checkpoint is only the commit SHA captured when the student
 * completes a week. It is NOT an approved evaluation.
 */
export const CheckpointSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  weekNumber: z.number().int().min(1).max(PROJECT_DURATION_WEEKS),
  commitSha: CommitShaSchema,
  /** Commit the diff is computed against. The baseline policy is defined in Phase 5. */
  baseCommitSha: CommitShaSchema.nullable(),
  recordedAt: z.iso.datetime({ offset: true }),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;
