import { z } from "zod";

/**
 * The teacher's decision is the official result and is stored separately
 * from the AI's suggested score.
 */
export const TeacherDecisionSchema = z
  .object({
    id: z.uuid(),
    evaluationId: z.uuid(),
    decision: z.enum(["approve", "edit", "reject"]),
    /** Required for approve/edit, must be null for reject. */
    approvedScore: z.number().min(0).max(100).nullable(),
    approvedFeedback: z.string().trim().min(1).nullable(),
    comment: z.string().trim().nullable(),
    decidedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((d, ctx) => {
    if (d.decision === "reject") {
      if (d.approvedScore !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["approvedScore"],
          message: "A rejected evaluation has no approved score.",
        });
      }
    } else if (d.approvedScore === null) {
      ctx.addIssue({
        code: "custom",
        path: ["approvedScore"],
        message: "An approved score is required.",
      });
    }
  });

export type TeacherDecision = z.infer<typeof TeacherDecisionSchema>;
