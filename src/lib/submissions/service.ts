import type { ExtractionInfo } from "@/lib/schemas/submission";
import type { Extraction } from "./extractor";
import type { UploadType } from "./file";
import { assessExtraction } from "./readable";

export type SubmissionErrorCode = "not_found" | "not_failed";

export class SubmissionError extends Error {
  constructor(
    readonly code: SubmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SubmissionError";
  }
}

export type NewSubmission = {
  id: string;
  assignmentId: string;
  studentName: string;
  filePath: string;
  fileName: string;
  fileType: UploadType;
  fileSize: number;
};

/** What the service needs from the database. The Supabase version is in repository.ts; tests use a memory one. */
export type SubmissionStore = {
  insert(row: NewSubmission): Promise<void>;
  /** Saves the text once. The database refuses to overwrite text that is already saved. */
  saveExtraction(id: string, text: string, info: ExtractionInfo): Promise<void>;
  setStatus(id: string, status: "needs_ocr" | "failed", reason: string): Promise<void>;
  /** Atomically moves a FAILED submission back to processing; null when it is not failed (or does not exist). */
  claimRetry(id: string): Promise<{ filePath: string; fileType: UploadType; hasText: boolean } | null>;
  exists(id: string): Promise<boolean>;
};

export type FileStorage = {
  upload(path: string, bytes: Uint8Array, fileType: UploadType): Promise<void>;
  download(path: string): Promise<Uint8Array>;
};

export type SubmissionDeps = {
  store: SubmissionStore;
  storage: FileStorage;
  extract: (bytes: Uint8Array, type: UploadType) => Promise<Extraction>;
  newId?: () => string;
};

const SAVE_FAILED = "Your file could not be saved. Please upload it again.";
const READ_FAILED = "Your file could not be found. Please upload it again.";
const GENERIC_FAILED = "Something went wrong while reading your file. Please try again.";

/** The sentence a student sees. Only our own messages are ever stored; raw errors are logged, not shown. */
function studentMessage(error: unknown): string {
  if (error && typeof error === "object" && "userMessage" in error && typeof error.userMessage === "string") {
    return error.userMessage;
  }
  console.error("[submissions] unexpected error:", error instanceof Error ? error.name : "unknown");
  return GENERIC_FAILED;
}

/**
 * Reads the file's text and records the outcome. Never throws for a problem with the file or the
 * reading service: the submission is kept with a status and a reason instead of being lost.
 */
async function readFile(id: string, bytes: Uint8Array, type: UploadType, deps: SubmissionDeps): Promise<void> {
  let extraction: Extraction;
  try {
    extraction = await deps.extract(bytes, type);
  } catch (error) {
    await deps.store.setStatus(id, "failed", studentMessage(error));
    return;
  }

  try {
    const { text, ...info } = extraction;
    await deps.store.saveExtraction(id, text, info);
    const verdict = assessExtraction(info.pages, type);
    if (!verdict.readable) await deps.store.setStatus(id, "needs_ocr", verdict.reason);
    // Otherwise the submission stays "processing": the AI marking step (next phase) continues from here.
  } catch (error) {
    // The text was read but could not be saved: keep the submission, with a reason and a retry.
    await deps.store.setStatus(id, "failed", studentMessage(error));
  }
}

/** Stores the original file, then reads it. Returns the new submission's id whatever the outcome. */
export async function submitAnswers(
  input: { assignmentId: string; studentName: string; fileName: string; bytes: Uint8Array; type: UploadType },
  deps: SubmissionDeps,
): Promise<string> {
  const id = (deps.newId ?? (() => crypto.randomUUID()))();
  const filePath = `${input.assignmentId}/${id}.${input.type}`;
  await deps.store.insert({
    id,
    assignmentId: input.assignmentId,
    studentName: input.studentName,
    filePath,
    fileName: input.fileName,
    fileType: input.type,
    fileSize: input.bytes.byteLength,
  });

  try {
    await deps.storage.upload(filePath, input.bytes, input.type);
  } catch (error) {
    console.error("[submissions] upload failed:", error instanceof Error ? error.name : "unknown");
    await deps.store.setStatus(id, "failed", SAVE_FAILED);
    return id;
  }

  await readFile(id, input.bytes, input.type, deps);
  return id;
}

/**
 * Tries a FAILED submission again from the stored file. Only a failed submission can be retried, and only
 * one request can claim it, so two clicks cannot start the work twice.
 */
export async function retrySubmission(id: string, deps: SubmissionDeps): Promise<void> {
  const claim = await deps.store.claimRetry(id);
  if (!claim) {
    throw (await deps.store.exists(id))
      ? new SubmissionError("not_failed", "Only a failed submission can be tried again.")
      : new SubmissionError("not_found", "Submission not found.");
  }
  // The text was already read before the failure: nothing to read again (the AI step continues from here).
  if (claim.hasText) return;

  let bytes: Uint8Array;
  try {
    bytes = await deps.storage.download(claim.filePath);
  } catch {
    await deps.store.setStatus(id, "failed", READ_FAILED);
    return;
  }
  await readFile(id, bytes, claim.fileType, deps);
}
