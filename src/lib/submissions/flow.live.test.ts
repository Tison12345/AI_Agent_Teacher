// End-to-end test of the whole assignment flow, against the real Supabase project and the real local Python
// extraction service, using the fictional sample files in /samples:
//   assignment -> upload -> workflow graph (text read from a real PDF/DOCX -> AI marking -> pause) -> faculty
//   decision -> graph finishes -> what the student sees.
// The graph runs on the real checkpoint tables (DATABASE_URL, migration 0009) with the real lease functions.
// Gemini is replaced by a scripted answer so the test costs no quota, but it still goes through the real prompt,
// the real schema and the real quote checks against the text that was really read from the real file.
// Needs migrations 0008 and 0009, DATABASE_URL and the extractor running (see extractor/README.md); skipped when it is not.
// Run with `npm run test:live`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAssignment } from "@/lib/assignments/repository";
import { getSupabase } from "@/lib/db/supabase";
import type { GeminiClient } from "@/lib/gemini/client";
import { requestGrading } from "@/lib/grading/generator";
import { decideSubmission } from "@/lib/grading/repository";
import { getCheckpointer } from "@/lib/workflow/checkpointer";
import { closeWorkflowPool, getWorkflowPool } from "@/lib/workflow/db";
import { pgLeaseStore, runWithLease } from "@/lib/workflow/lease";
import { buildSubmissionGraph } from "@/lib/workflow/submission/graph";
import { defaultSubmissionGraphDeps, supabaseWorkflowStore } from "@/lib/workflow/submission/repository";
import { createSubmissionRunner, submissionThread } from "@/lib/workflow/submission/runner";
import { checkUpload } from "./file";
import { defaultSubmissionDeps, getFacultySubmission, getStudentSubmission, listFacultySubmissions } from "./repository";
import { submitAnswers } from "./service";

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.EXTRACTOR_KEY && process.env.DATABASE_URL);
const extractorUrl = process.env.EXTRACTOR_URL ?? "http://127.0.0.1:8001";
const db = () => getSupabase();

const FILES = path.resolve(process.cwd(), "samples");
const load = (name: string) => new File([readFileSync(path.join(FILES, name))], name);

/** The scripted "model": a marking whose quotes are really in the sample file it is marking. */
type Canned = { marks: [number, number, number]; quotes: [string[], string[], string[]]; feedback: string };
const answerFor = (c: Canned) => ({
  questions: c.marks.map((marks, i) => ({ number: i + 1, marks, explanation: `Scripted explanation for question ${i + 1}.`, quotes: c.quotes[i] })),
  feedback: c.feedback,
});
const scripted = (value: unknown): GeminiClient => ({ models: { generateContent: vi.fn(async () => ({ text: JSON.stringify(value) })) } });

const STRONG: Canned = {
  marks: [5, 6, 4],
  quotes: [
    ["repeat a block of code until a condition stops it", "brushing each tooth in turn"],
    ["an ordered collection of values stored together under one name", "for (let i = 0; i < nums.length; i++)"],
    ["when I do not know how many repeats are needed"],
  ],
  feedback: "Excellent work. Your definitions, code and examples are clear.",
};
const MIXED: Canned = {
  marks: [5, 2, 4],
  quotes: [["repeat a block of code until a condition stops it", "washing machine repeating its spin cycle"], ["An array is a list of numbers"], STRONG.quotes[2]],
  feedback: "Good on loops. Practise writing a loop that prints an array.",
};
const WEAK: Canned = { marks: [0, 0, 0], quotes: [[], [], []], feedback: "Please review loops and arrays and try again." };

let extractorUp = false;
let assignmentId = "";
const objectPaths: string[] = [];

const submissionIds: string[] = [];

/** Uploads a sample file through the real checks and storage; the workflow then reads and marks it. */
async function upload(student: string, file: string): Promise<string> {
  const check = await checkUpload(load(file));
  if (!check.ok) throw new Error(check.message);
  const id = await submitAnswers({ assignmentId, studentName: student, fileName: check.fileName, bytes: check.bytes, type: check.type }, defaultSubmissionDeps());
  objectPaths.push(`${assignmentId}/${id}.${check.type}`);
  submissionIds.push(id);
  return id;
}

/** The real graph (real Supabase, real extractor, real checkpoints and leases) with a scripted Gemini. */
function runnerWith(client: GeminiClient) {
  const base = defaultSubmissionGraphDeps();
  const deps = {
    ...base,
    model: "scripted-model",
    requestGrading: (input: Parameters<typeof requestGrading>[0], issues: string | undefined, signal?: AbortSignal) =>
      requestGrading(input, issues, { client, model: "scripted-model", signal }),
  };
  return createSubmissionRunner({
    graph: buildSubmissionGraph(deps, getCheckpointer()),
    leases: pgLeaseStore(getWorkflowPool()),
    store: supabaseWorkflowStore,
  });
}
const marking = (value: unknown) => runnerWith(scripted(value));

describe.skipIf(!configured)("assignment flow end to end (real Supabase, real extractor, scripted Gemini)", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    extractorUp = await fetch(`${extractorUrl}/health`).then((r) => r.ok, () => false);
    const assignment = await createAssignment({
      title: "Loops and Arrays (end-to-end test)",
      instructions: "Fictional; created by the end-to-end test.",
      questions: [
        { text: "Explain what a loop is and why programmers use loops. Give one everyday example of something that repeats.", maxMarks: 5, rubric: "2 definition, 2 why, 1 example.", referenceAnswer: "A loop repeats a block of code." },
        { text: "What is an array? Write a short code example that creates an array of three numbers and prints each one using a loop.", maxMarks: 6, rubric: "2 definition, 2 array, 2 loop.", referenceAnswer: undefined },
        { text: "Describe the difference between a for loop and a while loop. When would you choose each one?", maxMarks: 4, rubric: "2 how, 2 when.", referenceAnswer: undefined },
      ],
    });
    assignmentId = assignment.id;
  });

  afterAll(async () => {
    if (configured) {
      const saver = getCheckpointer();
      const options = { store: pgLeaseStore(getWorkflowPool()) };
      await Promise.all(
        submissionIds.map((id) => runWithLease(submissionThread(id), () => saver.deleteThread(submissionThread(id)), options).catch(() => {})),
      );
      await closeWorkflowPool();
    }
    if (objectPaths.length) await db().storage.from("submissions").remove(objectPaths);
    if (assignmentId) await db().from("assignments").delete().eq("id", assignmentId);
  });

  const needExtractor = (ctx: { skip: () => void }) => {
    if (!extractorUp) ctx.skip();
  };

  it("strong answers: read from a real DOCX, marked 15/15, approved, and the student then sees the marks", async (ctx) => {
    needExtractor(ctx);
    const id = await upload("Asha Fictional", "strong-answers.docx");
    expect(await getFacultySubmission(id)).toMatchObject({ status: "processing", hasText: false }); // the workflow has not run yet

    const runner = marking(answerFor(STRONG));
    expect((await runner.start(id)).outcome).toBe("running"); // paused, waiting for faculty
    expect((await getFacultySubmission(id))?.extractedText).toContain("brushing each tooth in turn");
    const marked = await getFacultySubmission(id);
    expect(marked).toMatchObject({ status: "awaiting_review", aiTotal: 15, aiModel: "scripted-model" });

    // The progress read from the checkpoint is student-safe and says the run waits for faculty.
    const waiting = await runner.progress(id);
    expect(waiting.state).toBe("waiting_faculty");
    expect(JSON.stringify(waiting)).not.toContain("brushing each tooth");

    // Before the decision the student sees nothing but the status.
    expect(await getStudentSubmission(id)).toMatchObject({ status: "awaiting_review", scores: null, finalTotal: null, feedback: null });

    await decideSubmission(id, { decision: "approve" });
    await runner.resumeAfterDecision(id); // what the decision route does next
    expect((await runner.progress(id)).state).toBe("complete");
    expect(await getStudentSubmission(id)).toMatchObject({
      status: "approved",
      finalTotal: 15,
      feedback: STRONG.feedback,
      scores: [{ number: 1, marks: 5 }, { number: 2, marks: 6 }, { number: 3, marks: 4 }],
    });
  });

  it("mixed answers: marked 11/15, then the teacher edits it to 12 and the student sees the teacher's marks, not the AI's", async (ctx) => {
    needExtractor(ctx);
    const id = await upload("Bala Fictional", "mixed-answers.docx");
    await marking(answerFor(MIXED)).start(id);
    expect(await getFacultySubmission(id)).toMatchObject({ status: "awaiting_review", aiTotal: 11 });

    await decideSubmission(id, {
      decision: "edit",
      scores: [{ number: 1, marks: 5 }, { number: 2, marks: 3 }, { number: 3, marks: 4 }],
      feedback: "Good on loops. You described arrays well; practise printing them with a loop.",
      comment: "Gave 1 extra mark: the array definition was fine.",
    });
    const faculty = await getFacultySubmission(id);
    expect(faculty).toMatchObject({ status: "edited", aiTotal: 11 }); // the AI's number is kept as history
    expect(faculty?.decision).toMatchObject({ finalTotal: 12 });
    const student = await getStudentSubmission(id);
    expect(student).toMatchObject({ status: "edited", finalTotal: 12 });
    expect(JSON.stringify(student)).not.toContain("extra mark");
  });

  it("weak answers from a real PDF: marked 0 and rejected, so the student sees no marks", async (ctx) => {
    needExtractor(ctx);
    const id = await upload("Chitra Fictional", "weak-answers.pdf");
    await marking(answerFor(WEAK)).start(id);
    expect((await getFacultySubmission(id))?.extractedText).toContain("kind of variable");
    expect(await getFacultySubmission(id)).toMatchObject({ aiTotal: 0 });
    await decideSubmission(id, { decision: "reject" });
    expect(await getStudentSubmission(id)).toMatchObject({ status: "rejected", scores: null, finalTotal: null, feedback: null });
  });

  it("an AI answer that quotes words the student never wrote is refused: nothing is saved and the submission is kept as failed", async (ctx) => {
    needExtractor(ctx);
    const id = await upload("Dev Fictional", "weak-answers.pdf");
    const lying = answerFor({ ...WEAK, marks: [5, 6, 4], quotes: [["A loop repeats a block of code until a condition stops it"], ["An array is an ordered collection"], ["for loops count, while loops wait"]] });
    const client = scripted(lying);
    expect((await runnerWith(client).start(id)).outcome).toBe("failed");
    expect(client.models.generateContent).toHaveBeenCalledTimes(2); // the answer, and one corrected attempt
    const faculty = await getFacultySubmission(id);
    expect(faculty).toMatchObject({ status: "failed", aiTotal: null, aiResult: null });
    expect(faculty?.error).toMatch(/did not pass validation/);
  });

  it("a prompt-injection answer is sent to the model as data inside the data block, and a marking that ignores it is accepted as usual", async (ctx) => {
    needExtractor(ctx);
    const id = await upload("Esha Fictional", "injection-answers.docx");
    const client = scripted(answerFor({ marks: [0, 0, 0], quotes: [[], [], []], feedback: "Please answer the questions properly." }));
    await runnerWith(client).start(id);
    const prompt = (client.models.generateContent as ReturnType<typeof vi.fn>).mock.calls[0][0].contents as string;
    expect(prompt).toContain("ignore all previous instructions"); // present, but only inside the escaped JSON data block
    expect(prompt.indexOf("<marking_input>")).toBe(0);
    expect(prompt.split("</marking_input>")).toHaveLength(2);
    expect(await getFacultySubmission(id)).toMatchObject({ status: "awaiting_review", aiTotal: 0 });
  });

  it("a scanned PDF is kept and reported as needing OCR; it is never marked", async (ctx) => {
    needExtractor(ctx);
    const id = await upload("Farid Fictional", "scanned-answers.pdf");
    const client = scripted(answerFor(STRONG));
    const runner = runnerWith(client);
    expect((await runner.start(id)).outcome).toBe("needs_ocr");
    expect(client.models.generateContent).not.toHaveBeenCalled();
    const faculty = await getFacultySubmission(id);
    expect(faculty).toMatchObject({ status: "needs_ocr", aiTotal: null });
    expect(faculty?.error).toMatch(/scanned or image-only PDF/);
    expect((await runner.progress(id)).state).toBe("needs_ocr");
    expect((await getStudentSubmission(id))?.error).toMatch(/scanned or image-only PDF/);
  });

  it("the assignment's list shows every submission with its real status", async (ctx) => {
    needExtractor(ctx);
    const list = await listFacultySubmissions(assignmentId);
    const byName = Object.fromEntries(list.map((s) => [s.studentName, s.status]));
    expect(byName).toEqual({
      "Asha Fictional": "approved",
      "Bala Fictional": "edited",
      "Chitra Fictional": "rejected",
      "Dev Fictional": "failed",
      "Esha Fictional": "awaiting_review",
      "Farid Fictional": "needs_ocr",
    });
  });

  it("the dashboard counts follow the statuses: 1 awaiting review, 3 decided, 2 need attention", async (ctx) => {
    needExtractor(ctx);
    const { getFacultyAssignment, listFacultyAssignments } = await import("@/lib/assignments/repository");
    const expected = { submissionCount: 6, awaitingReviewCount: 1, decidedCount: 3, needsAttentionCount: 2 };
    expect(await getFacultyAssignment(assignmentId)).toMatchObject(expected);
    expect((await listFacultyAssignments()).find((a) => a.id === assignmentId)).toMatchObject(expected);
  });
});
