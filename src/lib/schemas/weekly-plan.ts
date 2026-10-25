import { z } from "zod";
import { MAX_DURATION_WEEKS, MIN_DURATION_WEEKS } from "@/lib/validation/project";

const text = (max: number) => z.string().trim().min(1).max(max);

export const CRITERIA_TOTAL_POINTS = 100;

export const EvaluationCriterionSchema = z.object({
  name: text(120),
  description: text(500),
  maxPoints: z.number().int().positive().max(CRITERIA_TOTAL_POINTS),
});

export const WeeklyPlanItemSchema = z.object({
  weekNumber: z.number().int().min(1).max(MAX_DURATION_WEEKS),
  title: text(150),
  objectives: z.array(text(400)).min(1).max(8),
  tasks: z.array(text(400)).min(1).max(12),
  deliverables: z.array(text(400)).min(1).max(8),
  evaluationCriteria: z
    .array(EvaluationCriterionSchema)
    .min(2)
    .max(8)
    .refine(
      (criteria) =>
        criteria.reduce((sum, c) => sum + c.maxPoints, 0) ===
        CRITERIA_TOTAL_POINTS,
      `Criteria maxPoints must add up to ${CRITERIA_TOTAL_POINTS}.`,
    ),
});

const inOrder = (items: { weekNumber: number }[]) =>
  items.every((item, index) => item.weekNumber === index + 1);
const IN_ORDER_MESSAGE = "Weeks must be numbered 1, 2, 3 and so on, in order.";

/**
 * A full stored plan: one item per week, numbered 1..n in order. The length must
 * match the project's duration, which is checked where the plan is generated.
 * Deliberately lenient about list sizes so plans saved earlier keep loading.
 */
export const WeeklyPlanSchema = z
  .array(WeeklyPlanItemSchema)
  .min(MIN_DURATION_WEEKS)
  .max(MAX_DURATION_WEEKS)
  .refine(inOrder, IN_ORDER_MESSAGE);

/**
 * The simplified, student-friendly shape required of newly generated plans.
 * Same fields as the stored shape, with a stricter meaning:
 * - objectives: exactly one entry, the week's goal (1-2 sentences)
 * - tasks: 2-4 short tasks
 * - deliverables: exactly one entry, the expected result
 * - evaluationCriteria: 2-3 criteria totalling 100 points
 */
export const GeneratedWeekSchema = WeeklyPlanItemSchema.extend({
  title: text(80),
  objectives: z.array(text(300)).length(1),
  tasks: z.array(text(250)).min(2).max(4),
  deliverables: z.array(text(300)).length(1),
  evaluationCriteria: z
    .array(EvaluationCriterionSchema)
    .min(2)
    .max(3)
    .refine(
      (criteria) =>
        criteria.reduce((sum, c) => sum + c.maxPoints, 0) ===
        CRITERIA_TOTAL_POINTS,
      `Criteria maxPoints must add up to ${CRITERIA_TOTAL_POINTS}.`,
    ),
});

/** The plan Gemini must return for a project that lasts `weeks` weeks. */
export const generatedPlanSchema = (weeks: number) =>
  z.array(GeneratedWeekSchema).length(weeks).refine(inOrder, IN_ORDER_MESSAGE);

/** A plan as persisted: one per project, with the model that produced it. */
export const StoredPlanSchema = z.object({
  projectId: z.uuid(),
  plan: WeeklyPlanSchema,
  model: z.string().min(1),
  generatedAt: z.iso.datetime({ offset: true }),
});

export type StoredPlan = z.infer<typeof StoredPlanSchema>;
export type EvaluationCriterion = z.infer<typeof EvaluationCriterionSchema>;
export type WeeklyPlanItem = z.infer<typeof WeeklyPlanItemSchema>;
export type WeeklyPlan = z.infer<typeof WeeklyPlanSchema>;
