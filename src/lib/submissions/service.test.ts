import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadType } from "./file";
import {
  retrySubmission,
  submitAnswers,
  SubmissionError,
  type FileStorage,
  type NewSubmission,
  type SubmissionDeps,
  type SubmissionStore,
} from "./service";

type Row = NewSubmission & { status: "processing" | "needs_ocr" | "failed"; error: string | null };

function memory() {
  const rows = new Map<string, Row>();
  const store: SubmissionStore = {
    async insert(row) {
      rows.set(row.id, { ...row, status: "processing", error: null });
    },
    async setFailed(id, reason) {
      Object.assign(rows.get(id)!, { status: "failed", error: reason });
    },
    async claimRetry(id) {
      const row = rows.get(id);
      if (!row || row.status !== "failed") return false;
      Object.assign(row, { status: "processing", error: null });
      return true;
    },
    async exists(id) {
      return rows.has(id);
    },
  };
  const files = new Map<string, Uint8Array>();
  const storage: FileStorage = {
    async upload(path, bytes) {
      files.set(path, bytes);
    },
    async download(path) {
      const bytes = files.get(path);
      if (!bytes) throw new Error("missing");
      return bytes;
    },
  };
  return { rows, files, store, storage };
}

const ASSIGNMENT = "123e4567-e89b-42d3-a456-426614174000";
const ID = "11111111-1111-4111-8111-111111111111";
const input = { assignmentId: ASSIGNMENT, studentName: "Asha Fictional", fileName: "answers.pdf", bytes: new Uint8Array([1, 2, 3]), type: "pdf" as UploadType };

let m: ReturnType<typeof memory>;
const deps = (): SubmissionDeps => ({ store: m.store, storage: m.storage, newId: () => ID });

beforeEach(() => {
  m = memory();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// Reading the text and marking it are the workflow's job: see src/lib/workflow/submission/*.test.ts.
describe("submitAnswers", () => {
  it("stores the original file under the assignment and leaves the submission processing for the workflow", async () => {
    expect(await submitAnswers(input, deps())).toBe(ID);
    expect(m.files.get(`${ASSIGNMENT}/${ID}.pdf`)).toEqual(input.bytes);
    expect(m.rows.get(ID)).toMatchObject({ studentName: "Asha Fictional", fileName: "answers.pdf", fileType: "pdf", fileSize: 3, status: "processing", error: null });
  });

  it("if the file cannot be stored the submission is failed with a reason, not lost", async () => {
    m.storage.upload = vi.fn().mockRejectedValue(new Error("bucket not found"));
    await submitAnswers(input, deps());
    expect(m.rows.get(ID)).toMatchObject({ status: "failed", error: "Your file could not be saved. Please upload it again." });
  });

  it("each upload is its own submission", async () => {
    const ids = ["a", "b"];
    const d = { ...deps(), newId: () => ids.shift()! };
    await submitAnswers(input, d);
    await submitAnswers(input, d);
    expect([...m.rows.keys()]).toEqual(["a", "b"]);
  });

  it("works for a DOCX too", async () => {
    await submitAnswers({ ...input, fileName: "answers.docx", type: "docx" }, deps());
    expect(m.files.has(`${ASSIGNMENT}/${ID}.docx`)).toBe(true);
  });
});

describe("retrySubmission", () => {
  it("moves a failed submission back to processing", async () => {
    await submitAnswers(input, deps());
    m.rows.get(ID)!.status = "failed";
    await retrySubmission(ID, deps());
    expect(m.rows.get(ID)).toMatchObject({ status: "processing", error: null });
  });

  it("only a failed submission can be retried: processing, needs_ocr and unknown ids are refused", async () => {
    await submitAnswers(input, deps());
    await expect(retrySubmission(ID, deps())).rejects.toMatchObject({ code: "not_failed" });
    m.rows.get(ID)!.status = "needs_ocr";
    await expect(retrySubmission(ID, deps())).rejects.toBeInstanceOf(SubmissionError);
    await expect(retrySubmission("nope", deps())).rejects.toMatchObject({ code: "not_found" });
  });

  it("two simultaneous retries claim the submission only once", async () => {
    await submitAnswers(input, deps());
    m.rows.get(ID)!.status = "failed";
    const results = await Promise.allSettled([retrySubmission(ID, deps()), retrySubmission(ID, deps())]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  });
});
