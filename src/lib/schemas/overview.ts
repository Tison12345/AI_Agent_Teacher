import { z } from "zod";
import { ProjectSchema } from "./project";
import { QuizSummarySchema } from "./review";

/** Where a week stands, from "nothing recorded" to a teacher's final decision. */
export const WEEK_STATES = [
  "not_recorded",
  "not_evaluated",
  "pending_review",
  "approved",
  "edited",
  "rejected",
] as const;

/** The AI's findings for a week. A recommendation for the teacher, never shown to students. */
const AiSummarySchema = z.object({
  confidence: z.enum(["low", "medium", "high"]),
  completed: z.array(z.string()),
  incomplete: z.array(z.string()),
  concerns: z.array(z.string()),
  feedback: z.array(z.string()),
});

export const WeekOverviewSchema = z.object({
  weekNumber: z.number().int(),
  /** The week's title from the plan, or null when the project has no plan. */
  title: z.string().nullable(),
  state: z.enum(WEEK_STATES),
  recordedAt: z.iso.datetime({ offset: true }).nullable(),
  evaluationId: z.uuid().nullable(),
  /** The AI's recommended score: not official. */
  suggestedScore: z.number().nullable(),
  /** The teacher's official score; null until decided, and for a rejection. */
  officialScore: z.number().nullable(),
  /** The feedback the student sees, and the teacher's private comment. */
  teacherFeedback: z.string().nullable(),
  teacherComment: z.string().nullable(),
  ai: AiSummarySchema.nullable(),
  quiz: QuizSummarySchema,
});

/** Everything a teacher sees on one project's overview page: every week, with scores and feedback. */
export const ProjectOverviewSchema = z.object({
  project: ProjectSchema.pick({ id: true, title: true, description: true, repoUrl: true, durationWeeks: true }),
  weeks: z.array(WeekOverviewSchema),
});

export type WeekState = (typeof WEEK_STATES)[number];
export type WeekOverview = z.infer<typeof WeekOverviewSchema>;
export type ProjectOverview = z.infer<typeof ProjectOverviewSchema>;
