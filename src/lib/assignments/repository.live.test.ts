// Live test against the real Supabase project. Skipped unless SUPABASE_URL and SUPABASE_SECRET_KEY
// are set, and needs migration 0008_assignments.sql to have been run. Run with `npm run test:live`.
// It creates fictional data and deletes it afterwards.
import { afterAll, describe, expect, it } from "vitest";
import { getSupabase } from "@/lib/db/supabase";
import {
  createAssignment,
  getFacultyAssignment,
  getStudentAssignment,
  listFacultyAssignments,
  listStudentAssignments,
} from "./repository";

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const createdIds: string[] = [];

const input = {
  title: "Live test: loops",
  instructions: "Created by the automated live test; safe to delete.",
  questions: [
    { text: "What does a loop do?", maxMarks: 5, rubric: "Mentions repetition.", referenceAnswer: "REFERENCE-SECRET-ANSWER" },
    { text: "What is an array?", maxMarks: 2.5, rubric: "Ordered list of values.", referenceAnswer: undefined },
  ],
};

describe.skipIf(!configured)("assignments (live Supabase, needs migration 0008)", () => {
  afterAll(async () => {
    if (createdIds.length) await getSupabase().from("assignments").delete().in("id", createdIds);
  });

  it("creates an assignment: the database numbers the questions and computes the total", async () => {
    const created = await createAssignment(input);
    createdIds.push(created.id);
    expect(created.maxMarks).toBe(7.5);
    expect(created.questions.map((q) => q.number)).toEqual([1, 2]);
    expect(created.referenceAnswers).toEqual({ "1": "REFERENCE-SECRET-ANSWER" });
    expect(created.submissionCount).toBe(0);
  });

  it("faculty see the reference answers; the list leaves them out", async () => {
    const [id] = createdIds;
    expect((await getFacultyAssignment(id))?.referenceAnswers).toEqual({ "1": "REFERENCE-SECRET-ANSWER" });
    const summary = (await listFacultyAssignments()).find((a) => a.id === id)!;
    expect(summary).not.toHaveProperty("referenceAnswers");
    expect(summary.hasReferenceAnswers).toBe(true);
  });

  it("students read a view that physically has no reference answers", async () => {
    const [id] = createdIds;
    const student = await getStudentAssignment(id);
    expect(student?.maxMarks).toBe(7.5);
    expect(JSON.stringify(student)).not.toContain("REFERENCE-SECRET-ANSWER");
    expect((await listStudentAssignments()).some((a) => a.id === id)).toBe(true);

    const { error } = await getSupabase().from("student_assignments").select("reference_answers").limit(1);
    expect(error).not.toBeNull(); // the column does not exist on the view
  });

  it("an assignment cannot be edited after it is created", async () => {
    const [id] = createdIds;
    const { error } = await getSupabase().from("assignments").update({ title: "Changed title" }).eq("id", id);
    expect(error?.message).toMatch(/cannot be changed/);
  });

  it("the database refuses malformed questions even if the app did not", async () => {
    const bad = (questions: unknown) => getSupabase().from("assignments").insert({ title: "Bad one", instructions: "x", questions });
    expect((await bad([])).error).not.toBeNull();
    expect((await bad([{ number: 2, text: "t", maxMarks: 1, rubric: "r" }])).error).not.toBeNull();
    expect((await bad([{ number: 1, text: "t", maxMarks: 101, rubric: "r" }])).error).not.toBeNull();
    expect((await bad([{ number: 1, text: "t", maxMarks: 1, rubric: "" }])).error).not.toBeNull();
  });

  it("returns null for an unknown id", async () => {
    expect(await getFacultyAssignment("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await getStudentAssignment("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
