import { z } from "zod";

/** A question as students see it: with its marks and rubric, never a reference answer. */
export const QuestionSchema = z.object({
  number: z.number().int().min(1),
  text: z.string(),
  maxMarks: z.number().positive(),
  rubric: z.string(),
});

/** What a student may read about an assignment. */
export const StudentAssignmentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  instructions: z.string(),
  questions: z.array(QuestionSchema),
  maxMarks: z.number().positive(),
  createdAt: z.iso.datetime({ offset: true }),
});

/** Faculty list entry: the student view plus how many files have been submitted. No reference answers. */
export const FacultyAssignmentSummarySchema = StudentAssignmentSchema.extend({
  submissionCount: z.number().int().min(0),
  hasReferenceAnswers: z.boolean(),
});

/** One assignment for its faculty page, including the optional reference answers (keyed by question number). */
export const FacultyAssignmentSchema = FacultyAssignmentSummarySchema.extend({
  referenceAnswers: z.record(z.string(), z.string()).nullable(),
});

export type Question = z.infer<typeof QuestionSchema>;
export type StudentAssignment = z.infer<typeof StudentAssignmentSchema>;
export type FacultyAssignmentSummary = z.infer<typeof FacultyAssignmentSummarySchema>;
export type FacultyAssignment = z.infer<typeof FacultyAssignmentSchema>;
