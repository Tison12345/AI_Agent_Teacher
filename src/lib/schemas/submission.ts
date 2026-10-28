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

/** One submission for faculty: the original file link and the extracted text. */
export const FacultySubmissionSchema = FacultySubmissionSummarySchema.extend({
  extractedText: z.string().nullable(),
  extraction: ExtractionInfoSchema.nullable(),
  /** A link to the original file that stops working after a few minutes. */
  downloadUrl: z.string().nullable(),
});

export type StudentSubmission = z.infer<typeof StudentSubmissionSchema>;
export type ExtractionInfo = z.infer<typeof ExtractionInfoSchema>;
export type FacultySubmissionSummary = z.infer<typeof FacultySubmissionSummarySchema>;
export type FacultySubmission = z.infer<typeof FacultySubmissionSchema>;
