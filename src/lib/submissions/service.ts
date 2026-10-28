import type { UploadType } from "./file";

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
  /** The student's account (app_users.id); null only for rows made without an account, such as in tests. */
  studentId: string | null;
  studentName: string;
  filePath: string;
  fileName: string;
  fileType: UploadType;
  fileSize: number;
};

/** What the service needs from the database. The Supabase version is in repository.ts; tests use a memory one. */
export type SubmissionStore = {
  insert(row: NewSubmission): Promise<void>;
  setFailed(id: string, reason: string): Promise<void>;
  /** Atomically moves a FAILED submission back to processing; false when it is not failed (or does not exist). */
  claimRetry(id: string): Promise<boolean>;
  exists(id: string): Promise<boolean>;
};

export type FileStorage = {
  upload(path: string, bytes: Uint8Array, fileType: UploadType): Promise<void>;
  download(path: string): Promise<Uint8Array>;
};

export type SubmissionDeps = {
  store: SubmissionStore;
  storage: FileStorage;
  newId?: () => string;
};

const SAVE_FAILED = "Your file could not be saved. Please upload it again.";

/**
 * Stores the original file and records the submission as "processing". Reading its text and marking it is the
 * assignment workflow's job (src/lib/workflow/submission), started by the caller. Returns the new id.
 */
export async function submitAnswers(
  input: { assignmentId: string; studentId?: string | null; studentName: string; fileName: string; bytes: Uint8Array; type: UploadType },
  deps: SubmissionDeps,
): Promise<string> {
  const id = (deps.newId ?? (() => crypto.randomUUID()))();
  const filePath = `${input.assignmentId}/${id}.${input.type}`;
  await deps.store.insert({
    id,
    assignmentId: input.assignmentId,
    studentId: input.studentId ?? null,
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
    await deps.store.setFailed(id, SAVE_FAILED);
    return id;
  }
  return id;
}

/**
 * Moves a FAILED submission back to processing so the workflow can run again from the stored file. Only a
 * failed submission can be retried, and only one request can claim it, so two clicks cannot start two runs.
 */
export async function retrySubmission(id: string, deps: SubmissionDeps): Promise<void> {
  if (await deps.store.claimRetry(id)) return;
  throw (await deps.store.exists(id))
    ? new SubmissionError("not_failed", "Only a failed submission can be tried again.")
    : new SubmissionError("not_found", "Submission not found.");
}
