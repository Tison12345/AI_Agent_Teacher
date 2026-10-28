import type { UploadType } from "./file";

/** A PDF page with fewer characters than this is treated as having no text layer (the pipeline's threshold). */
export const BLANK_PAGE_CHARS = 30;
/** Below this many characters in total there is nothing meaningful to grade. */
export const MIN_TOTAL_CHARS = 100;

export type Readability = { readable: true } | { readable: false; reason: string };

/**
 * Decides whether an extraction has enough real text to mark. A scanned or image-only document
 * gives (almost) no text; it must be reported as needing OCR, never graded as an empty answer.
 * A few blank pages in an otherwise typed document are allowed; the warnings tell faculty about them.
 */
export function assessExtraction(pages: { number: number; chars: number }[], type: UploadType): Readability {
  const total = pages.reduce((sum, p) => sum + p.chars, 0);
  const blank = pages.filter((p) => p.chars < BLANK_PAGE_CHARS).length;
  const mostlyBlank = pages.length === 0 || blank * 2 > pages.length;
  if (total >= MIN_TOTAL_CHARS && !mostlyBlank) return { readable: true };
  return {
    readable: false,
    reason:
      type === "pdf"
        ? "This looks like a scanned or image-only PDF. Scanned documents can't be read yet (OCR is not added), so please upload a PDF with typed text."
        : "This document has almost no typed text. If your answers are pictures or screenshots they can't be read yet; please type them into the document.",
  };
}
