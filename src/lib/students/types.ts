import { z } from "zod";
import { EVALUATION_STATUSES } from "@/lib/schemas/evaluation";
import { SubmissionStatusSchema } from "@/lib/schemas/submission";

/*
 * What the faculty student pages show. Plain shapes with no server-only imports, so the API routes, the loader and
 * the components agree on them. Faculty only: it carries the AI's recommendations next to the official scores.
 */

/** The id used for projects and submissions that were made before accounts existed (no owner is recorded). */
export const UNASSIGNED_ID = "unassigned";

export const StudentSummarySchema = z.object({
  /** The student's account id, or UNASSIGNED_ID for work made before accounts existed. */
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  joinedAt: z.string().nullable(),
  projectCount: z.number().int(),
  weeksRecorded: z.number().int(),
  assignmentsSubmitted: z.number().int(),
  /** Weekly evaluations waiting for a decision. */
  weeklyPending: z.number().int(),
  /** Assignment submissions waiting for a decision. */
  assignmentPending: z.number().int(),
  /** Faculty-approved results only (approved or edited), as percentages. Null when there are none. */
  averageOfficial: z.number().nullable(),
  projectAverage: z.number().nullable(),
  assignmentAverage: z.number().nullable(),
});
export type StudentSummary = z.infer<typeof StudentSummarySchema>;

export const ClassOverviewSchema = z.object({
  totalStudents: z.number().int(),
  totalProjects: z.number().int(),
  assignmentsSubmitted: z.number().int(),
  assignmentsAwaitingReview: z.number().int(),
  weeklyAwaitingReview: z.number().int(),
  /** The mean of each student's own average official score; students with no official score are left out. */
  overallAverage: z.number().nullable(),
  studentsWithScores: z.number().int(),
});
export type ClassOverview = z.infer<typeof ClassOverviewSchema>;

export const StudentListSchema = z.object({ overview: ClassOverviewSchema, students: z.array(StudentSummarySchema) });
export type StudentList = z.infer<typeof StudentListSchema>;

const WeekEvaluationSchema = z.object({
  id: z.string(),
  status: z.enum(EVALUATION_STATUSES),
  /** The AI's recommendation. Not official. */
  aiScore: z.number(),
  /** The faculty-approved score; null while pending, and for a rejection. */
  officialScore: z.number().nullable(),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  decidedAt: z.string().nullable(),
});

export const StudentWeekSchema = z.object({
  weekNumber: z.number().int(),
  checkpointId: z.string(),
  recordedAt: z.string(),
  filesChanged: z.number().int(),
  additions: z.number().int(),
  deletions: z.number().int(),
  evaluation: WeekEvaluationSchema.nullable(),
  quiz: z.object({ correctCount: z.number().int(), total: z.number().int() }).nullable(),
  quizCreated: z.boolean(),
});
export type StudentWeek = z.infer<typeof StudentWeekSchema>;

export const StudentProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  repoUrl: z.string(),
  durationWeeks: z.number().int(),
  createdAt: z.string(),
  weeks: z.array(StudentWeekSchema),
  /** Mean official score of this project's decided weeks, or null. */
  averageOfficial: z.number().nullable(),
  pending: z.number().int(),
});
export type StudentProject = z.infer<typeof StudentProjectSchema>;

export const AssignmentRowStatusSchema = z.union([z.literal("not_submitted"), SubmissionStatusSchema]);
export type AssignmentRowStatus = z.infer<typeof AssignmentRowStatusSchema>;

export const StudentSubmissionRowSchema = z.object({
  /** Null for an assignment the student has not submitted. */
  submissionId: z.string().nullable(),
  assignmentId: z.string(),
  assignmentTitle: z.string(),
  maxMarks: z.number(),
  status: AssignmentRowStatusSchema,
  fileName: z.string().nullable(),
  submittedAt: z.string().nullable(),
  /** The AI's recommended total. Not official. */
  aiTotal: z.number().nullable(),
  /** The faculty-approved total; null while pending, and for a rejection. */
  officialTotal: z.number().nullable(),
  /** The feedback the student sees (approved or edited only). */
  feedback: z.string().nullable(),
  decidedAt: z.string().nullable(),
  /** The reason for needs_ocr and failed. */
  error: z.string().nullable(),
});
export type StudentSubmissionRow = z.infer<typeof StudentSubmissionRowSchema>;

export const StudentDetailSchema = z.object({
  summary: StudentSummarySchema,
  projects: z.array(StudentProjectSchema),
  assignments: z.array(StudentSubmissionRowSchema),
});
export type StudentDetail = z.infer<typeof StudentDetailSchema>;
