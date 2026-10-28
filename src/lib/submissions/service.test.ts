import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionInfo } from "@/lib/schemas/submission";
import { ExtractorError, type Extraction } from "./extractor";
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

type Row = NewSubmission & {
  status: "processing" | "needs_ocr" | "failed";
  error: string | null;
  text: string | null;
  extraction: ExtractionInfo | null;
};

/** A memory store that follows the same rules as the database triggers (text is written once). */
function memory() {
  const rows = new Map<string, Row>();
  const store: SubmissionStore = {
    async insert(row) {
      rows.set(row.id, { ...row, status: "processing", error: null, text: null, extraction: null });
    },
    async saveExtraction(id, text, info) {
      const row = rows.get(id)!;
      if (row.text !== null) throw new Error("extracted text cannot be changed once saved");
      row.text = text;
      row.extraction = info;
    },
    async setStatus(id, status, reason) {
      Object.assign(rows.get(id)!, { status, error: reason });
    },
    async claimRetry(id) {
      const row = rows.get(id);
      if (!row || row.status !== "failed") return null;
      Object.assign(row, { status: "processing", error: null });
      return { filePath: row.filePath, fileType: row.fileType, hasText: row.text !== null };
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
const typed: Extraction = {
  text: "Page 1:\n" + "A loop repeats a block of code. ".repeat(20),
  pages: [{ number: 1, chars: 650 }],
  warnings: [],
};
const scanned: Extraction = { text: "Page 1:\n\n\nPage 2:\n", pages: [{ number: 1, chars: 0 }, { number: 2, chars: 0 }], warnings: ["Page 1 has no readable text (it may be a scan or an image)."] };
const input = { assignmentId: ASSIGNMENT, studentName: "Asha Fictional", fileName: "answers.pdf", bytes: new Uint8Array([1, 2, 3]), type: "pdf" as UploadType };

let m: ReturnType<typeof memory>;
let extract: ReturnType<typeof vi.fn>;
const deps = (): SubmissionDeps => ({ store: m.store, storage: m.storage, extract: extract as SubmissionDeps["extract"], newId: () => "11111111-1111-4111-8111-111111111111" });
const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  m = memory();
  extract = vi.fn().mockResolvedValue(typed);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("submitAnswers", () => {
  it("stores the original file under the assignment, saves the text, and leaves the submission processing", async () => {
    expect(await submitAnswers(input, deps())).toBe(ID);
    expect(m.files.get(`${ASSIGNMENT}/${ID}.pdf`)).toEqual(input.bytes);
    const row = m.rows.get(ID)!;
    expect(row).toMatchObject({ studentName: "Asha Fictional", fileName: "answers.pdf", fileType: "pdf", fileSize: 3, status: "processing", error: null });
    expect(row.text).toBe(typed.text);
    expect(row.extraction).toEqual({ pages: typed.pages, warnings: [] });
    expect(extract).toHaveBeenCalledWith(input.bytes, "pdf");
  });

  it("a scanned document is kept, its text and warnings saved, and marked needs_ocr with a reason", async () => {
    extract.mockResolvedValue(scanned);
    await submitAnswers(input, deps());
    const row = m.rows.get(ID)!;
    expect(row.status).toBe("needs_ocr");
    expect(row.error).toMatch(/scanned or image-only PDF/);
    expect(row.extraction?.warnings).toHaveLength(1);
    expect(m.files.has(`${ASSIGNMENT}/${ID}.pdf`)).toBe(true);
  });

  it("when the reading service is down the submission is kept as failed with a friendly reason", async () => {
    extract.mockRejectedValue(new ExtractorError("unavailable", "The text-reading service is not running. Please try again in a moment."));
    await submitAnswers(input, deps());
    expect(m.rows.get(ID)).toMatchObject({ status: "failed", error: "The text-reading service is not running. Please try again in a moment.", text: null });
    expect(m.files.has(`${ASSIGNMENT}/${ID}.pdf`)).toBe(true);
  });

  it("a problem with the file itself (e.g. a password) is reported in the service's words", async () => {
    extract.mockRejectedValue(new ExtractorError("rejected", "This PDF is password protected."));
    await submitAnswers(input, deps());
    expect(m.rows.get(ID)).toMatchObject({ status: "failed", error: "This PDF is password protected." });
  });

  it("an unexpected error never leaks its details to the student", async () => {
    extract.mockRejectedValue(new Error("connect ECONNREFUSED secret-host:5432 password=hunter2"));
    await submitAnswers(input, deps());
    const { error } = m.rows.get(ID)!;
    expect(error).toBe("Something went wrong while reading your file. Please try again.");
    expect(error).not.toMatch(/hunter2|ECONNREFUSED/);
  });

  it("if the file cannot be stored, nothing is read and the submission is failed, not lost", async () => {
    m.storage.upload = vi.fn().mockRejectedValue(new Error("bucket not found"));
    await submitAnswers(input, deps());
    expect(m.rows.get(ID)).toMatchObject({ status: "failed", error: "Your file could not be saved. Please upload it again." });
    expect(extract).not.toHaveBeenCalled();
  });

  it("if the text cannot be saved, the submission is failed with a retry instead of staying stuck", async () => {
    m.store.saveExtraction = vi.fn().mockRejectedValue(new Error("db down"));
    await submitAnswers(input, deps());
    expect(m.rows.get(ID)).toMatchObject({ status: "failed" });
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
    expect(extract).toHaveBeenCalledWith(input.bytes, "docx");
  });
});

describe("retrySubmission", () => {
  async function failedSubmission() {
    extract.mockRejectedValueOnce(new ExtractorError("unavailable", "The text-reading service is not running. Please try again in a moment."));
    await submitAnswers(input, deps());
    expect(m.rows.get(ID)!.status).toBe("failed");
  }

  it("reads the stored file again and recovers", async () => {
    await failedSubmission();
    await retrySubmission(ID, deps());
    expect(m.rows.get(ID)).toMatchObject({ status: "processing", error: null });
    expect(m.rows.get(ID)!.text).toBe(typed.text);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("can fail again, with the reason updated", async () => {
    await failedSubmission();
    extract.mockRejectedValueOnce(new ExtractorError("timeout", "Reading your file took too long. Please try again."));
    await retrySubmission(ID, deps());
    expect(m.rows.get(ID)).toMatchObject({ status: "failed", error: "Reading your file took too long. Please try again." });
  });

  it("only a failed submission can be retried: processing, needs_ocr and unknown ids are refused", async () => {
    await submitAnswers(input, deps());
    await expect(retrySubmission(ID, deps())).rejects.toMatchObject({ code: "not_failed" });
    m.rows.get(ID)!.status = "needs_ocr";
    await expect(retrySubmission(ID, deps())).rejects.toBeInstanceOf(SubmissionError);
    await expect(retrySubmission("nope", deps())).rejects.toMatchObject({ code: "not_found" });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("two simultaneous retries start the work only once", async () => {
    await failedSubmission();
    const results = await Promise.allSettled([retrySubmission(ID, deps()), retrySubmission(ID, deps())]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(extract).toHaveBeenCalledTimes(2); // the first attempt plus exactly one retry
  });

  it("if the stored file is missing it fails again with a clear message", async () => {
    await failedSubmission();
    m.files.clear();
    await retrySubmission(ID, deps());
    expect(m.rows.get(ID)).toMatchObject({ status: "failed", error: "Your file could not be found. Please upload it again." });
  });

  it("if the text was already saved before the failure, it is not read or saved a second time", async () => {
    await failedSubmission();
    m.rows.get(ID)!.text = "already read";
    await retrySubmission(ID, deps());
    expect(m.rows.get(ID)!.text).toBe("already read");
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
