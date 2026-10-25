import { z } from "zod";
import { PROJECT_DURATION_WEEKS } from "@/lib/validation/project";

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
  weekNumber: z.number().int().min(1).max(PROJECT_DURATION_WEEKS),
  suggestedScore: z.number().min(0).max(100),
  criteriaAssessments: z.array(CriterionAssessmentSchema),
  completedRequirements: z.array(nonEmpty),
  incompleteRequirements: z.array(nonEmpty),
  technicalConcerns: z.array(nonEmpty),
  feedbackForNextWeek: z.array(nonEmpty),
  confidence: ConfidenceSchema,
  status: z.enum(EVALUATION_STATUSES),
  createdAt: z.iso.datetime({ offset: true }),
});

export type Evaluation = z.infer<typeof EvaluationSchema>;
