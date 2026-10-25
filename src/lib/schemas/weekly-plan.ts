import { z } from "zod";
import { PROJECT_DURATION_WEEKS } from "@/lib/validation/project";

const nonEmpty = z.string().trim().min(1);

export const EvaluationCriterionSchema = z.object({
  name: nonEmpty.max(120),
  description: nonEmpty.max(500),
  maxPoints: z.number().int().positive().max(100),
});

export const WeeklyPlanItemSchema = z.object({
  weekNumber: z.number().int().min(1).max(PROJECT_DURATION_WEEKS),
  title: nonEmpty.max(150),
  objectives: z.array(nonEmpty).min(1),
  tasks: z.array(nonEmpty).min(1),
  deliverables: z.array(nonEmpty).min(1),
  evaluationCriteria: z.array(EvaluationCriterionSchema).min(1),
});

/** A full plan: exactly 12 items, one per week 1..12. */
export const WeeklyPlanSchema = z
  .array(WeeklyPlanItemSchema)
  .length(PROJECT_DURATION_WEEKS)
  .refine(
    (items) => items.every((item, index) => item.weekNumber === index + 1),
    "Weeks must be numbered 1 to 12 in order.",
  );

export type EvaluationCriterion = z.infer<typeof EvaluationCriterionSchema>;
export type WeeklyPlanItem = z.infer<typeof WeeklyPlanItemSchema>;
export type WeeklyPlan = z.infer<typeof WeeklyPlanSchema>;
