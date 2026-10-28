import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  createAssignment: vi.fn(),
  listFacultyAssignments: vi.fn(),
  getFacultyAssignment: vi.fn(),
  listStudentAssignments: vi.fn(),
  getStudentAssignment: vi.fn(),
}));
vi.mock("@/lib/assignments/repository", () => repo);
vi.mock("@/lib/db/supabase", () => ({
  StorageConfigError: class StorageConfigError extends Error {},
}));

import { GET, POST } from "./route";
import { GET as GET_ONE } from "./[id]/route";
import { GET as GET_STUDENT_LIST } from "../../assignments/route";
import { GET as GET_STUDENT_ONE } from "../../assignments/[id]/route";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const question = { text: "What does a loop do?", maxMarks: 5, rubric: "Mentions repetition." };
const valid = { title: "Loops and arrays", instructions: "Answer every question.", questions: [question] };

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/faculty/assignments", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/faculty/assignments", () => {
  it("creates an assignment and passes the validated input on", async () => {
    repo.createAssignment.mockResolvedValue({ id: ID, ...valid });
    const res = await post({ ...valid, questions: [{ ...question, referenceAnswer: "  Repeats code.  " }] });
    expect(res.status).toBe(201);
    expect(repo.createAssignment).toHaveBeenCalledWith({
      ...valid,
      questions: [{ ...question, referenceAnswer: "Repeats code." }],
    });
  });

  it("an empty reference answer means none", async () => {
    repo.createAssignment.mockResolvedValue({ id: ID });
    await post({ ...valid, questions: [{ ...question, referenceAnswer: "" }] });
    expect(repo.createAssignment.mock.calls[0][0].questions[0].referenceAnswer).toBeUndefined();
  });

  it("rejects invalid JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");
    expect(repo.createAssignment).not.toHaveBeenCalled();
  });

  it("rejects invalid input with field errors and creates nothing", async () => {
    const res = await post({ title: "x", instructions: "", questions: [{ text: "", maxMarks: 0, rubric: "" }] });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(Object.keys(error.fields)).toEqual(
      expect.arrayContaining(["title", "instructions", "questions.0.text", "questions.0.maxMarks", "questions.0.rubric"]),
    );
    expect(repo.createAssignment).not.toHaveBeenCalled();
  });

  it.each([
    ["no questions", { ...valid, questions: [] }],
    ["more than 20 questions", { ...valid, questions: Array.from({ length: 21 }, () => question) }],
    ["marks above 100", { ...valid, questions: [{ ...question, maxMarks: 101 }] }],
    ["negative marks", { ...valid, questions: [{ ...question, maxMarks: -1 }] }],
    ["marks as text", { ...valid, questions: [{ ...question, maxMarks: "5" }] }],
    ["three decimals", { ...valid, questions: [{ ...question, maxMarks: 2.555 }] }],
    ["a non-object body", "[1,2]"],
  ])("rejects %s", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(repo.createAssignment).not.toHaveBeenCalled();
  });

  it("does not accept a total from the caller: only questions carry marks", async () => {
    repo.createAssignment.mockResolvedValue({ id: ID });
    await post({ ...valid, maxMarks: 9999 });
    expect(repo.createAssignment.mock.calls[0][0]).not.toHaveProperty("maxMarks");
  });

  it("reports a database failure without leaking details", async () => {
    repo.createAssignment.mockRejectedValue(new Error("secret db detail"));
    const res = await post(valid);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret db detail");
  });
});

describe("GET /api/faculty/assignments", () => {
  it("lists assignments", async () => {
    repo.listFacultyAssignments.mockResolvedValue([{ id: ID, submissionCount: 2 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).assignments).toEqual([{ id: ID, submissionCount: 2 }]);
  });
});

describe("GET /api/faculty/assignments/[id]", () => {
  it("returns the assignment with its reference answers", async () => {
    repo.getFacultyAssignment.mockResolvedValue({ id: ID, referenceAnswers: { "1": "x" } });
    const res = await GET_ONE(new Request("http://localhost"), ctx(ID));
    expect((await res.json()).assignment.referenceAnswers).toEqual({ "1": "x" });
  });
  it("404 when missing, 400 for a bad id", async () => {
    repo.getFacultyAssignment.mockResolvedValue(null);
    expect((await GET_ONE(new Request("http://localhost"), ctx(ID))).status).toBe(404);
    expect((await GET_ONE(new Request("http://localhost"), ctx("nope"))).status).toBe(400);
  });
});

describe("student routes read only the student-safe functions", () => {
  it("GET /api/assignments uses the student list, never the faculty one", async () => {
    repo.listStudentAssignments.mockResolvedValue([{ id: ID }]);
    const res = await GET_STUDENT_LIST();
    expect(res.status).toBe(200);
    expect(repo.listStudentAssignments).toHaveBeenCalled();
    expect(repo.listFacultyAssignments).not.toHaveBeenCalled();
  });

  it("GET /api/assignments/[id] uses the student reader, never the faculty one", async () => {
    repo.getStudentAssignment.mockResolvedValue({ id: ID, title: "T" });
    const res = await GET_STUDENT_ONE(new Request("http://localhost"), ctx(ID));
    expect(res.status).toBe(200);
    expect(repo.getFacultyAssignment).not.toHaveBeenCalled();
    expect((await GET_STUDENT_ONE(new Request("http://localhost"), ctx("bad"))).status).toBe(400);
  });
});
