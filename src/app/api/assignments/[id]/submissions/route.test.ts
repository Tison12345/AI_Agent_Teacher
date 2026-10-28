// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const submissions = vi.hoisted(() => ({
  defaultSubmissionDeps: vi.fn(() => ({ marker: "deps" })),
  getStudentSubmission: vi.fn(),
  listStudentSubmissions: vi.fn(),
  getFacultySubmission: vi.fn(),
  listFacultySubmissions: vi.fn(),
}));
const assignments = vi.hoisted(() => ({ getStudentAssignment: vi.fn() }));
const service = vi.hoisted(() => ({ submitAnswers: vi.fn(), retrySubmission: vi.fn() }));
vi.mock("@/lib/submissions/repository", () => submissions);
vi.mock("@/lib/assignments/repository", () => assignments);
vi.mock("@/lib/submissions/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/submissions/service")>()),
  ...service,
}));
vi.mock("@/lib/db/supabase", () => ({ StorageConfigError: class StorageConfigError extends Error {} }));
const background = vi.hoisted(() => ({ markInBackground: vi.fn() }));
vi.mock("@/lib/grading/background", () => background);

import { GET as FACULTY_LIST } from "@/app/api/faculty/assignments/[id]/submissions/route";
import { GET as FACULTY_ONE } from "@/app/api/faculty/submissions/[id]/route";
import { POST as RETRY } from "@/app/api/submissions/[id]/retry/route";
import { SubmissionError } from "@/lib/submissions/service";
import { GET, POST } from "./route";

const A = "123e4567-e89b-42d3-a456-426614174000";
const S = "223e4567-e89b-42d3-a456-426614174000";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const pdf = (name = "answers.pdf") => new File([new TextEncoder().encode("%PDF-1.7 hello")], name, { type: "application/pdf" });
const studentView = { id: S, status: "processing", assignmentId: A };

function upload(fields: { studentName?: string; file?: File | string }, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (fields.studentName !== undefined) form.set("studentName", fields.studentName);
  if (fields.file !== undefined) form.set("file", fields.file);
  return POST(new Request("http://localhost/api/assignments/x/submissions", { method: "POST", body: form, headers }), ctx(A));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  assignments.getStudentAssignment.mockResolvedValue({ id: A });
  service.submitAnswers.mockResolvedValue(S);
  submissions.getStudentSubmission.mockResolvedValue(studentView);
});

describe("POST /api/assignments/[id]/submissions", () => {
  it("stores and reads the file, then returns the student-safe submission", async () => {
    const res = await upload({ studentName: "  Asha Fictional ", file: pdf() });
    expect(res.status).toBe(201);
    expect((await res.json()).submission).toEqual(studentView);
    const [input] = service.submitAnswers.mock.calls[0];
    expect(input).toMatchObject({ assignmentId: A, studentName: "Asha Fictional", fileName: "answers.pdf", type: "pdf" });
    expect(input.bytes).toBeInstanceOf(Uint8Array);
    expect(submissions.getStudentSubmission).toHaveBeenCalledWith(S);
  });

  it("starts the AI marking after the upload, without waiting for it", async () => {
    await upload({ studentName: "Asha Fictional", file: pdf() });
    expect(background.markInBackground).toHaveBeenCalledWith(S);
  });

  it("does not start marking for an upload that was refused", async () => {
    await upload({ studentName: "Asha Fictional", file: "not a file" });
    expect(background.markInBackground).not.toHaveBeenCalled();
  });

  it("the response is read from the student view, never the faculty one", async () => {
    await upload({ studentName: "Asha Fictional", file: pdf() });
    expect(submissions.getFacultySubmission).not.toHaveBeenCalled();
  });

  it("needs a name of at least 2 characters and a file", async () => {
    const res = await upload({ studentName: "A" });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(Object.keys(error.fields).sort()).toEqual(["file", "studentName"]);
    expect(service.submitAnswers).not.toHaveBeenCalled();
  });

  it("a text field in place of a file is refused", async () => {
    expect((await upload({ studentName: "Asha Fictional", file: "not a file" })).status).toBe(400);
    expect(service.submitAnswers).not.toHaveBeenCalled();
  });

  it.each([
    ["answers.exe", "Upload a PDF or Word (.docx) file."],
  ])("rejects %s", async (name, message) => {
    const res = await upload({ studentName: "Asha Fictional", file: new File([new TextEncoder().encode("%PDF-")], name) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.file).toBe(message);
    expect(service.submitAnswers).not.toHaveBeenCalled();
  });

  it("rejects a fake PDF, by its first bytes", async () => {
    const res = await upload({ studentName: "Asha Fictional", file: new File(["MZ\u0090\u0000 not a pdf"], "evil.pdf") });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.file).toBe("This file is not a real PDF.");
  });

  it("refuses a huge body before reading it", async () => {
    const res = await upload({ studentName: "Asha Fictional", file: pdf() }, { "content-length": String(10 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(service.submitAnswers).not.toHaveBeenCalled();
  });

  it("404 for an unknown assignment, 400 for a bad id, 400 for a non-form body", async () => {
    assignments.getStudentAssignment.mockResolvedValue(null);
    expect((await upload({ studentName: "Asha Fictional", file: pdf() })).status).toBe(404);
    expect(service.submitAnswers).not.toHaveBeenCalled();
    const bad = await POST(new Request("http://localhost", { method: "POST", body: new FormData() }), ctx("nope"));
    expect(bad.status).toBe(400);
    const notForm = await POST(new Request("http://localhost", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), ctx(A));
    expect(notForm.status).toBe(400);
  });

  it("an unexpected failure is a generic 500 with no details", async () => {
    service.submitAnswers.mockRejectedValue(new Error("secret db detail"));
    const res = await upload({ studentName: "Asha Fictional", file: pdf() });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret db detail");
  });
});

describe("GET /api/assignments/[id]/submissions", () => {
  const get = (name?: string) =>
    GET(new Request(`http://localhost/api/assignments/x/submissions${name === undefined ? "" : `?name=${encodeURIComponent(name)}`}`), ctx(A));

  it("lists the submissions for the typed name", async () => {
    submissions.listStudentSubmissions.mockResolvedValue([studentView]);
    const res = await get(" asha fictional ");
    expect((await res.json()).submissions).toEqual([studentView]);
    expect(submissions.listStudentSubmissions).toHaveBeenCalledWith(A, "asha fictional");
  });

  it("needs a real name, so the whole list can never be requested", async () => {
    expect((await get()).status).toBe(400);
    expect((await get(" ")).status).toBe(400);
    expect((await get("A")).status).toBe(400);
    expect(submissions.listStudentSubmissions).not.toHaveBeenCalled();
  });
});

describe("POST /api/submissions/[id]/retry", () => {
  const retry = (id = S) => RETRY(new Request("http://localhost", { method: "POST" }), ctx(id));

  it("retries and returns the student-safe submission", async () => {
    service.retrySubmission.mockResolvedValue(undefined);
    const res = await retry();
    expect(res.status).toBe(200);
    expect((await res.json()).submission).toEqual(studentView);
    expect(background.markInBackground).toHaveBeenCalledWith(S); // a retry that has its text goes on to marking
  });

  it("409 when the submission is not failed, 404 when it does not exist, 400 for a bad id", async () => {
    service.retrySubmission.mockRejectedValueOnce(new SubmissionError("not_failed", "Only a failed submission can be tried again."));
    expect((await retry()).status).toBe(409);
    service.retrySubmission.mockRejectedValueOnce(new SubmissionError("not_found", "Submission not found."));
    expect((await retry()).status).toBe(404);
    expect((await retry("nope")).status).toBe(400);
  });
});

describe("faculty submission routes", () => {
  it("list returns the faculty summaries for the assignment", async () => {
    submissions.listFacultySubmissions.mockResolvedValue([{ id: S }]);
    const res = await FACULTY_LIST(new Request("http://localhost"), ctx(A));
    expect((await res.json()).submissions).toEqual([{ id: S }]);
    expect((await FACULTY_LIST(new Request("http://localhost"), ctx("nope"))).status).toBe(400);
  });

  it("detail returns the submission, 404 when missing", async () => {
    submissions.getFacultySubmission.mockResolvedValueOnce({ id: S, extractedText: "hi" }).mockResolvedValueOnce(null);
    expect((await (await FACULTY_ONE(new Request("http://localhost"), ctx(S))).json()).submission.extractedText).toBe("hi");
    expect((await FACULTY_ONE(new Request("http://localhost"), ctx(S))).status).toBe(404);
    expect((await FACULTY_ONE(new Request("http://localhost"), ctx("nope"))).status).toBe(400);
  });
});
