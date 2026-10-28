import type { SubmissionStatus } from "@/lib/schemas/submission";

type Label = { label: string; badge: string };

/** How a student sees each status. Approved and edited both mean the teacher gave an official mark. */
export const STUDENT_STATUS: Record<SubmissionStatus, Label> = {
  processing: { label: "Processing", badge: "badge-info" },
  needs_ocr: { label: "Needs OCR", badge: "badge-warning" },
  failed: { label: "Failed", badge: "badge-danger" },
  awaiting_review: { label: "Awaiting faculty review", badge: "badge-warning" },
  approved: { label: "Approved", badge: "badge-official" },
  edited: { label: "Approved", badge: "badge-official" },
  rejected: { label: "Reviewed, no mark", badge: "badge-neutral" },
};

/** Faculty see the real distinction. The blue/indigo badge is reserved for official faculty decisions. */
export const FACULTY_STATUS: Record<SubmissionStatus, Label> = {
  ...STUDENT_STATUS,
  edited: { label: "Edited", badge: "badge-official" },
  rejected: { label: "Rejected", badge: "badge-danger" },
};
