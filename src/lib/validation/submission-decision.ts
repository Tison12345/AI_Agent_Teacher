import { z } from "zod";

const marks = z.array(z.object({ number: z.number().int().min(1).max(20), marks: z.number().min(0).max(100) })).min(1).max(20);

/**
 * What faculty may send. Approve and reject carry nothing else: an approval always uses the AI's stored marks
 * and feedback (the database copies them), so anything extra sent with them is ignored, not trusted.
 * Totals are never accepted from the browser.
 */
export const submissionDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({ decision: z.literal("reject") }),
  z.object({
    decision: z.literal("edit"),
    scores: marks,
    feedback: z.string().trim().min(1, "Write the feedback the student will see.").max(2000),
    comment: z.string().trim().min(1, "Explain why you changed the AI's recommendation.").max(1000),
  }),
]);

export type SubmissionDecisionInput = z.infer<typeof submissionDecisionSchema>;
