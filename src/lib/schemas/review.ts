import { z } from "zod";
import { EVALUATION_STATUSES, EvaluationSchema, SnapshotSchema } from "./evaluation";
import { ProjectSchema } from "./project";
import { TeacherDecisionSchema } from "./teacher-decision";

export const MAX_FEEDBACK_CHARS = 3000;
export const MAX_COMMENT_CHARS = 1000;

const score = z
  .number()
  .min(0)
  .max(100)
  .refine((n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9, "Use at most one decimal place.");
const feedback = z.string().trim().min(1, "Feedback is required.").max(MAX_FEEDBACK_CHARS);
const comment = z.string().trim().min(1, "A comment is required.").max(MAX_COMMENT_CHARS);

/**
 * What a teacher may send. Strict on purpose: an approval carries no score or
 * feedback (the server copies the AI's), and a rejection carries no score at all.
 */
export const DecisionRequestSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("approve"),
    comment: z.string().trim().max(MAX_COMMENT_CHARS).optional(),
  }),
  z.strictObject({
    decision: z.literal("edit"),
    approvedScore: score,
    approvedFeedback: feedback,
    comment,
  }),
  z.strictObject({
    decision: z.literal("reject"),
    comment,
  }),
]);

export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

/** One row of the faculty queue. Teachers only: it carries the AI's suggestion. */
export const QueueItemSchema = z.object({
  evaluationId: z.uuid(),
  projectId: z.uuid(),
  projectTitle: z.string(),
  weekNumber: z.number().int(),
  status: z.enum(EVALUATION_STATUSES),
  suggestedScore: z.number(),
  confidence: z.enum(["low", "medium", "high"]),
  createdAt: z.iso.datetime({ offset: true }),
});

/** Everything a teacher needs to review one evaluation, including the diff the AI saw. */
export const ReviewDetailSchema = z.object({
  evaluation: EvaluationSchema,
  snapshot: SnapshotSchema,
  project: ProjectSchema.pick({ id: true, title: true, repoUrl: true }),
  decision: TeacherDecisionSchema.nullable(),
});

/**
 * What a student may see once a teacher has decided. Deliberately has no AI score,
 * no AI feedback and no teacher comment. A rejection carries no score or feedback.
 */
export const StudentResultSchema = z.object({
  weekNumber: z.number().int(),
  outcome: z.enum(["approved", "edited", "rejected"]),
  officialScore: z.number().min(0).max(100).nullable(),
  feedback: z.string().nullable(),
  decidedAt: z.iso.datetime({ offset: true }),
});

export type QueueItem = z.infer<typeof QueueItemSchema>;
export type ReviewDetail = z.infer<typeof ReviewDetailSchema>;
export type StudentResult = z.infer<typeof StudentResultSchema>;
