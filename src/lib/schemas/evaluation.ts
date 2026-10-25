import { z } from "zod";
import { MAX_DURATION_WEEKS } from "@/lib/validation/project";

const nonEmpty = z.string().trim().min(1);

export const EvidenceSchema = z.object({
  /** File the observation refers to, when applicable. */
  filePath: nonEmpty.optional(),
  summary: nonEmpty,
});

export const CriterionAssessmentSchema = z
  .object({
    criterion: nonEmpty,
    score: z.number().min(0),
    maxScore: z.number().positive(),
    rationale: nonEmpty,
    evidence: z.array(EvidenceSchema),
  })
  .refine((a) => a.score <= a.maxScore, "score must not exceed maxScore");

export const ConfidenceSchema = z.object({
  level: z.enum(["low", "medium", "high"]),
  uncertainties: z.array(nonEmpty),
});

/** Files the AI could not read, and why. Produced by our code, never by the model. */
export const NOT_REVIEWED_REASONS = [
  "deleted",
  "ignored",
  "binary",
  "unavailable",
  "budget",
] as const;

export const ReviewScopeSchema = z.object({
  filesChanged: z.number().int().min(0),
  filesReviewed: z.number().int().min(0),
  patchesTruncated: z.number().int().min(0),
  /** Files that changed but whose contents the AI did not see. */
  notReviewed: z.array(
    z.object({ path: nonEmpty, reason: z.enum(NOT_REVIEWED_REASONS) }),
  ),
  /** Files beyond the per-evaluation file cap (not listed individually). */
  filesBeyondLimit: z.number().int().min(0),
  /** The student's code is never run during evaluation. */
  codeExecuted: z.literal(false),
});

export const EVALUATION_STATUSES = [
  "pending_review",
  "approved",
  "edited",
  "rejected",
] as const;

/**
 * The AI-generated evaluation. `suggestedScore` is only a recommendation;
 * the official result lives in a TeacherDecision.
 */
export const EvaluationSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  checkpointId: z.uuid(),
  weekNumber: z.number().int().min(1).max(MAX_DURATION_WEEKS),
  suggestedScore: z.number().min(0).max(100),
  criteriaAssessments: z.array(CriterionAssessmentSchema),
  completedRequirements: z.array(nonEmpty),
  incompleteRequirements: z.array(nonEmpty),
  technicalConcerns: z.array(nonEmpty),
  feedbackForNextWeek: z.array(nonEmpty),
  confidence: ConfidenceSchema,
  reviewScope: ReviewScopeSchema,
  model: nonEmpty,
  status: z.enum(EVALUATION_STATUSES),
  createdAt: z.iso.datetime({ offset: true }),
});

/** What the AI was shown, kept so teachers can inspect the evidence later. */
export const SnapshotFileSchema = z.object({
  path: nonEmpty,
  previousPath: z.string().optional(),
  status: nonEmpty,
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  patch: z.string().optional(),
  patchTruncated: z.boolean(),
  patchOmittedReason: z.enum(NOT_REVIEWED_REASONS).optional(),
});

export const SnapshotSchema = z.object({
  baseSha: z.string(),
  headSha: z.string(),
  files: z.array(SnapshotFileSchema),
  totalFiles: z.number().int().min(0),
  totalAdditions: z.number().int().min(0),
  totalDeletions: z.number().int().min(0),
  filesOmitted: z.number().int().min(0),
  truncated: z.boolean(),
});

export type ReviewScope = z.infer<typeof ReviewScopeSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Evaluation = z.infer<typeof EvaluationSchema>;
