// Live test against the real Supabase project (tables, views and the private storage bucket) with a fake
// text reader, so the Python service is not needed. Needs migration 0008. Fictional data, deleted afterwards.
// Run with `npm run test:live`.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAssignment } from "@/lib/assignments/repository";
import { getSupabase } from "@/lib/db/supabase";
import type { Extraction } from "./extractor";
import {
  getFacultySubmission,
  getStudentSubmission,
  listFacultySubmissions,
  listStudentSubmissions,
  supabaseStorage,
  supabaseStore,
} from "./repository";
import { retrySubmission, submitAnswers, type SubmissionDeps } from "./service";

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const db = () => getSupabase();

const typed: Extraction = {
  text: "Page 1:\n" + "A loop repeats a block of code. ".repeat(20),
  pages: [{ number: 1, chars: 650 }],
  warnings: [],
};
const scanned: Extraction = { text: "Page 1:\n", pages: [{ number: 1, chars: 0 }], warnings: ["Page 1 has no readable text (it may be a scan or an image)."] };
const bytes = new TextEncoder().encode("%PDF-1.7 fictional live test file");

let assignmentId = "";
const objectPaths: string[] = [];
let extract = vi.fn();

const deps = (): SubmissionDeps => ({ store: supabaseStore, storage: supabaseStorage, extract: extract as SubmissionDeps["extract"] });
const submit = async (studentName: string) => {
  const id = await submitAnswers({ assignmentId, studentName, fileName: "answers.pdf", bytes, type: "pdf" }, deps());
  objectPaths.push(`${assignmentId}/${id}.pdf`);
  return id;
};

describe.skipIf(!configured)("submissions (live Supabase, needs migration 0008)", () => {
  beforeAll(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const assignment = await createAssignment({
      title: "Live submissions test",
      instructions: "Fictional; created by the live test.",
      questions: [{ text: "What does a loop do?", maxMarks: 5, rubric: "Repetition.", referenceAnswer: undefined }],
    });
    assignmentId = assignment.id;
  });

  afterAll(async () => {
    if (objectPaths.length) await db().storage.from("submissions").remove(objectPaths);
    if (assignmentId) await db().from("assignments").delete().eq("id", assignmentId);
  });

  it("stores the original file privately and saves the text it was read from", async () => {
    extract = vi.fn().mockResolvedValue(typed);
    const id = await submit("Asha Fictional");

    const downloaded = await supabaseStorage.download(`${assignmentId}/${id}.pdf`);
    expect(Array.from(downloaded)).toEqual(Array.from(bytes));

    const faculty = await getFacultySubmission(id);
    expect(faculty).toMatchObject({ studentName: "Asha Fictional", status: "processing", hasText: true, extractedText: typed.text, aiTotal: null });
    expect(faculty?.extraction).toEqual({ pages: typed.pages, warnings: [] });

    // The signed link works for a few minutes and returns exactly the uploaded bytes.
    const response = await fetch(faculty!.downloadUrl!);
    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(bytes));
  });

  it("the bucket is private: the plain public URL does not serve the file", async () => {
    const [path] = objectPaths;
    const publicUrl = db().storage.from("submissions").getPublicUrl(path).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);
  });

  it("students find their submissions by name, ignoring case and spaces, and nobody else's", async () => {
    await submit("Bala Fictional");
    expect((await listStudentSubmissions(assignmentId, "  ASHA fictional ")).map((s) => s.studentName)).toEqual(["Asha Fictional"]);
    expect(await listStudentSubmissions(assignmentId, "Nobody Here")).toEqual([]);
  });

  it("a typed name cannot be used as a wildcard to list other people's submissions", async () => {
    expect(await listStudentSubmissions(assignmentId, "%")).toEqual([]);
    expect(await listStudentSubmissions(assignmentId, "%ictional")).toEqual([]);
    expect(await listStudentSubmissions(assignmentId, "As_a Fictional")).toEqual([]);
  });

  it("the student view has no text and no AI data, and no marks before approval", async () => {
    const [mine] = await listStudentSubmissions(assignmentId, "Asha Fictional");
    expect(Object.keys(mine).sort()).toEqual(
      ["assignmentId", "createdAt", "decidedAt", "error", "feedback", "fileName", "fileSize", "fileType", "finalTotal", "id", "scores", "status", "studentName"].sort(),
    );
    expect(mine).toMatchObject({ scores: null, finalTotal: null, feedback: null, decidedAt: null });
    expect(await getStudentSubmission(mine.id)).toEqual(mine);
  });

  it("faculty list shows every submission for the assignment", async () => {
    const list = await listFacultySubmissions(assignmentId);
    expect(list.map((s) => s.studentName).sort()).toEqual(["Asha Fictional", "Bala Fictional"]);
    expect(JSON.stringify(list)).not.toContain("A loop repeats");
  });

  it("a scanned file is kept and marked needs_ocr with a reason, its warnings saved", async () => {
    extract = vi.fn().mockResolvedValue(scanned);
    const id = await submit("Chitra Fictional");
    const faculty = await getFacultySubmission(id);
    expect(faculty).toMatchObject({ status: "needs_ocr", hasText: true });
    expect(faculty?.error).toMatch(/scanned or image-only PDF/);
    expect(faculty?.extraction?.warnings).toHaveLength(1);
    const student = await getStudentSubmission(id);
    expect(student?.error).toMatch(/scanned or image-only PDF/);
  });

  it("a failed submission is kept, can be retried once, and then recovers", async () => {
    extract = vi.fn().mockRejectedValueOnce(Object.assign(new Error("down"), { userMessage: "The text-reading service is not running." }));
    const id = await submit("Dev Fictional");
    expect(await getStudentSubmission(id)).toMatchObject({ status: "failed", error: "The text-reading service is not running." });

    extract = vi.fn().mockResolvedValue(typed);
    const results = await Promise.allSettled([retrySubmission(id, deps()), retrySubmission(id, deps())]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]); // only one retry can claim it
    expect(extract).toHaveBeenCalledTimes(1);
    expect(await getStudentSubmission(id)).toMatchObject({ status: "processing", error: null });
    expect((await getFacultySubmission(id))?.extractedText).toBe(typed.text);
  });

  it("only a failed submission can be retried", async () => {
    extract = vi.fn().mockResolvedValue(typed);
    const id = await submit("Esha Fictional");
    await expect(retrySubmission(id, deps())).rejects.toMatchObject({ code: "not_failed" });
    await expect(retrySubmission("00000000-0000-4000-8000-000000000000", deps())).rejects.toMatchObject({ code: "not_found" });
  });

  it("if the file cannot be stored the submission is kept as failed, not lost", async () => {
    extract = vi.fn().mockResolvedValue(typed);
    const failing = { ...deps(), storage: { ...supabaseStorage, upload: vi.fn().mockRejectedValue(new Error("bucket down")) } };
    const id = await submitAnswers({ assignmentId, studentName: "Farid Fictional", fileName: "a.pdf", bytes, type: "pdf" }, failing);
    expect(await getStudentSubmission(id)).toMatchObject({ status: "failed", error: "Your file could not be saved. Please upload it again." });
    expect(extract).not.toHaveBeenCalled();
  });

  it("the storage bucket refuses files that are not PDF or DOCX", async () => {
    const path = `${assignmentId}/not-allowed.exe`;
    const { error } = await db().storage.from("submissions").upload(path, new Uint8Array([1, 2, 3]), { contentType: "application/x-msdownload" });
    expect(error).not.toBeNull();
    if (!error) objectPaths.push(path);
  });
});
