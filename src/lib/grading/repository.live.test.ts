// Live test against the real Supabase project: saving the AI recommendation and the faculty decision, with a
// fake AI so no Gemini call is made. Needs migration 0008. Fictional data, deleted afterwards.
// Run with `npm run test:live`.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAssignment } from "@/lib/assignments/repository";
import { getSupabase } from "@/lib/db/supabase";
import type { AiResult } from "@/lib/schemas/submission";
import { getFacultySubmission, getStudentSubmission, supabaseStorage, supabaseStore } from "@/lib/submissions/repository";
import { submitAnswers } from "@/lib/submissions/service";
import { supabaseWorkflowStore } from "@/lib/workflow/submission/repository";
import { DecisionError, decideSubmission } from "./repository";

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const db = () => getSupabase();

const bytes = new TextEncoder().encode("%PDF-1.7 fictional live test file");
const typed = { text: "Page 1:\n" + "A loop repeats a block of code. ".repeat(20), pages: [{ number: 1, chars: 650 }], warnings: [] };
const aiResult: AiResult = {
  questions: [
    { number: 1, marks: 4, maxMarks: 5, explanation: "Defines repetition.", quotes: ["A loop repeats a block of code."] },
    { number: 2, marks: 2, maxMarks: 2.5, explanation: "Mentions order.", quotes: ["A loop repeats a block of code."] },
  ],
  feedback: "Good start. Add an example next time.",
  notes: [],
};

let assignmentId = "";
const objectPaths: string[] = [];
/** The marking step's database write, as the workflow's save_result and park_failed nodes do it. */
async function mark(id: string, result: AiResult = aiResult): Promise<"graded" | "skipped" | "failed"> {
  try {
    return (await supabaseWorkflowStore.saveResult(id, result, "fake-model")) === "saved" ? "graded" : "skipped";
  } catch {
    await supabaseWorkflowStore.setFailed(id, "Marking could not be completed. Please try again.");
    return "failed";
  }
}

/** A processing submission with its text read, as Phase B leaves it. */
async function readySubmission(name: string): Promise<string> {
  const id = await submitAnswers(
    { assignmentId, studentName: name, fileName: "answers.pdf", bytes, type: "pdf" },
    { store: supabaseStore, storage: supabaseStorage },
  );
  await supabaseWorkflowStore.saveExtraction(id, typed.text, { pages: typed.pages, warnings: typed.warnings });
  objectPaths.push(`${assignmentId}/${id}.pdf`);
  return id;
}
async function markedSubmission(name: string): Promise<string> {
  const id = await readySubmission(name);
  expect(await mark(id)).toBe("graded");
  return id;
}

describe.skipIf(!configured)("AI recommendation and faculty decision (live Supabase, needs migration 0008)", () => {
  beforeAll(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const assignment = await createAssignment({
      title: "Live grading test",
      instructions: "Fictional; created by the live test.",
      questions: [
        { text: "What does a loop do?", maxMarks: 5, rubric: "Repetition.", referenceAnswer: undefined },
        { text: "What is an array?", maxMarks: 2.5, rubric: "Ordered values.", referenceAnswer: "An ordered collection." },
      ],
    });
    assignmentId = assignment.id;
  });

  afterAll(async () => {
    if (objectPaths.length) await db().storage.from("submissions").remove(objectPaths);
    if (assignmentId) await db().from("assignments").delete().eq("id", assignmentId);
  });

  it("saves the recommendation, moves to awaiting_review, and the DATABASE computes the total", async () => {
    const id = await markedSubmission("Asha Fictional");
    const faculty = await getFacultySubmission(id);
    expect(faculty).toMatchObject({ status: "awaiting_review", aiTotal: 6, aiModel: "fake-model", decision: null });
    expect(faculty?.aiResult?.feedback).toBe(aiResult.feedback);
    expect(faculty?.aiResult?.questions.map((q) => q.marks)).toEqual([4, 2]);
  });

  it("the recommendation is written once: a second marking is skipped and cannot overwrite it", async () => {
    const id = await markedSubmission("Bala Fictional");
    const other: AiResult = { ...aiResult, questions: aiResult.questions.map((q) => ({ ...q, marks: 0, quotes: [] })) };
    expect(await mark(id, other)).toBe("skipped");
    expect((await getFacultySubmission(id))?.aiTotal).toBe(6);
    // Even a direct write is refused by the database.
    const { error } = await db().from("submissions").update({ ai_result: other }).eq("id", id);
    expect(error?.message).toMatch(/cannot be changed once saved/);
  });

  it("the database refuses marks above a question's maximum, so the submission stays unmarked", async () => {
    const id = await readySubmission("Chitra Fictional");
    const tooHigh: AiResult = { ...aiResult, questions: [{ ...aiResult.questions[0], marks: 6 }, aiResult.questions[1]] };
    expect(await mark(id, tooHigh)).toBe("failed");
    const faculty = await getFacultySubmission(id);
    expect(faculty).toMatchObject({ status: "failed", aiTotal: null, aiResult: null });
    expect(faculty?.error).toBe("Marking could not be completed. Please try again.");
  });

  it("a student sees no marks, feedback or AI data while the submission awaits review", async () => {
    const id = await markedSubmission("Dev Fictional");
    const student = await getStudentSubmission(id);
    expect(student).toMatchObject({ status: "awaiting_review", scores: null, finalTotal: null, feedback: null, decidedAt: null });
    expect(JSON.stringify(student)).not.toMatch(/Defines repetition|fake-model|Good start/);
  });

  it("approve copies the AI's marks and feedback, and ignores any marks a caller tries to send", async () => {
    const id = await markedSubmission("Esha Fictional");
    // The app's API cannot even send marks with an approval; call the database function directly to prove it ignores them.
    const { error } = await db().rpc("decide_submission", {
      p_submission_id: id,
      p_decision: "approve",
      p_scores: [{ number: 1, marks: 5 }, { number: 2, marks: 2.5 }],
      p_feedback: "Sneaky full marks",
      p_comment: null,
    });
    expect(error).toBeNull();
    const faculty = await getFacultySubmission(id);
    expect(faculty).toMatchObject({ status: "approved" });
    expect(faculty?.decision).toMatchObject({ decision: "approve", finalTotal: 6, feedback: aiResult.feedback });
    const student = await getStudentSubmission(id);
    expect(student).toMatchObject({ status: "approved", finalTotal: 6, feedback: aiResult.feedback, scores: [{ number: 1, marks: 4 }, { number: 2, marks: 2 }] });
  });

  it("a decision is final: a second decision is refused", async () => {
    const id = await markedSubmission("Farid Fictional");
    await decideSubmission(id, { decision: "approve" });
    await expect(decideSubmission(id, { decision: "reject" })).rejects.toMatchObject({ code: "already_decided" });
    await expect(decideSubmission(id, { decision: "reject" })).rejects.toBeInstanceOf(DecisionError);
    expect((await getFacultySubmission(id))?.status).toBe("approved");
    const { error } = await db().from("submission_decisions").update({ final_total: 7.5 }).eq("submission_id", id);
    expect(error?.message).toMatch(/cannot be changed/);
  });

  it("edit: marks are checked, the total is computed in the database, and the private comment stays private", async () => {
    const id = await markedSubmission("Gita Fictional");
    const edit = { decision: "edit" as const, feedback: "Excellent.", comment: "Complete answer, AI was too strict." };
    await expect(decideSubmission(id, { ...edit, scores: [{ number: 1, marks: 6 }, { number: 2, marks: 2 }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(decideSubmission(id, { ...edit, scores: [{ number: 1, marks: 5 }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(
      decideSubmission(id, { decision: "edit", scores: [{ number: 1, marks: 4 }, { number: 2, marks: 2 }], feedback: aiResult.feedback, comment: "same" }),
    ).rejects.toMatchObject({ code: "invalid" }); // nothing changed
    expect((await getFacultySubmission(id))?.status).toBe("awaiting_review"); // refused edits changed nothing

    await decideSubmission(id, { ...edit, scores: [{ number: 1, marks: 5 }, { number: 2, marks: 2 }] });
    const faculty = await getFacultySubmission(id);
    expect(faculty?.status).toBe("edited");
    expect(faculty?.decision).toMatchObject({ finalTotal: 7, comment: edit.comment, feedback: "Excellent." });
    expect(faculty?.aiTotal).toBe(6); // the AI's recommendation is untouched, apart from the official result
    const student = await getStudentSubmission(id);
    expect(student).toMatchObject({ status: "edited", finalTotal: 7, feedback: "Excellent." });
    expect(JSON.stringify(student)).not.toContain("AI was too strict");
  });

  it("reject stores no marks and the student sees no marks", async () => {
    const id = await markedSubmission("Hari Fictional");
    await decideSubmission(id, { decision: "reject" });
    expect((await getFacultySubmission(id))?.decision).toMatchObject({ decision: "reject", scores: null, finalTotal: null, feedback: null });
    expect(await getStudentSubmission(id)).toMatchObject({ status: "rejected", scores: null, finalTotal: null, feedback: null });
  });

  it("cannot decide a submission that has not been marked, or that does not exist", async () => {
    const id = await readySubmission("Indu Fictional");
    await expect(decideSubmission(id, { decision: "approve" })).rejects.toMatchObject({ code: "not_awaiting_review" });
    await expect(decideSubmission("00000000-0000-4000-8000-000000000000", { decision: "approve" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("a status cannot be forced to approved without a decision", async () => {
    const id = await markedSubmission("Jay Fictional");
    const { error } = await db().from("submissions").update({ status: "approved" }).eq("id", id);
    expect(error?.message).toMatch(/decision is required/);
  });
});
