import { z } from "zod";

export const SUBMISSION_STATUSES = [
  "processing",
  "needs_ocr",
  "failed",
  "awaiting_review",
  "approved",
  "edited",
  "rejected",
] as const;
export const SubmissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

const FileTypeSchema = z.enum(["pdf", "docx"]);

/**
 * What a student may see about a submission. It comes from the `student_submissions` view, which has no
 * extracted text and no AI data; marks and feedback are filled only after faculty approve or edit.
 */
export const StudentSubmissionSchema = z.object({
  id: z.uuid(),
  assignmentId: z.uuid(),
  studentName: z.string(),
  fileName: z.string(),
  fileType: FileTypeSchema,
  fileSize: z.number().int(),
  status: SubmissionStatusSchema,
  /** A plain-language reason for needs_ocr and failed. */
  error: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  scores: z.array(z.object({ number: z.number().int(), marks: z.number() })).nullable(),
  finalTotal: z.number().nullable(),
  feedback: z.string().nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
});

/** How the text was read: one entry per PDF page (a Word file counts as one block), plus any warnings. */
export const ExtractionInfoSchema = z.object({
  pages: z.array(z.object({ number: z.number().int(), chars: z.number().int().min(0) })),
  warnings: z.array(z.string()),
});

/** Faculty list row. No extracted text. */
export const FacultySubmissionSummarySchema = z.object({
  id: z.uuid(),
  assignmentId: z.uuid(),
  studentName: z.string(),
  fileName: z.string(),
  fileType: FileTypeSchema,
  fileSize: z.number().int(),
  status: SubmissionStatusSchema,
  error: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  /** The AI's recommended total: faculty only, and empty until the AI step exists for this submission. */
  aiTotal: z.number().nullable(),
  hasText: z.boolean(),
});

const MarksSchema = z.array(z.object({ number: z.number().int(), marks: z.number() }));

/** The AI's recommendation for one question. Never official. Quotes are checked against the student's text. */
export const AiQuestionResultSchema = z.object({
  number: z.number().int(),
  marks: z.number(),
  maxMarks: z.number(),
  explanation: z.string(),
  quotes: z.array(z.string()),
});

/** The AI's whole recommendation, saved once and never changed. */
export const AiResultSchema = z.object({
  questions: z.array(AiQuestionResultSchema),
  /** Draft feedback for the student. Shown to them only if faculty approve it. */
  feedback: z.string(),
  /** Limits worth knowing, such as an answer that was too long to mark in full. */
  notes: z.array(z.string()).default([]),
});

export const DECISIONS = ["approve", "edit", "reject"] as const;

/** The official faculty decision. Final once saved. */
export const DecisionRecordSchema = z.object({
  decision: z.enum(DECISIONS),
  scores: MarksSchema.nullable(),
  finalTotal: z.number().nullable(),
  feedback: z.string().nullable(),
  /** Private to faculty. */
  comment: z.string().nullable(),
  decidedAt: z.iso.datetime({ offset: true }),
});

/** One submission for faculty: the original file link, the extracted text, the AI recommendation and the decision. */
export const FacultySubmissionSchema = FacultySubmissionSummarySchema.extend({
  extractedText: z.string().nullable(),
  extraction: ExtractionInfoSchema.nullable(),
  /** A link to the original file that stops working after a few minutes. */
  downloadUrl: z.string().nullable(),
  aiResult: AiResultSchema.nullable(),
  aiModel: z.string().nullable(),
  decision: DecisionRecordSchema.nullable(),
});

export type StudentSubmission = z.infer<typeof StudentSubmissionSchema>;
export type ExtractionInfo = z.infer<typeof ExtractionInfoSchema>;
export type FacultySubmissionSummary = z.infer<typeof FacultySubmissionSummarySchema>;
export type FacultySubmission = z.infer<typeof FacultySubmissionSchema>;
export type AiResult = z.infer<typeof AiResultSchema>;
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
