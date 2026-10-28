// Live test of the database rules in migration 0008: the submission guard trigger, the AI-result
// lock, decide_submission(), the student-safe views and the storage bucket. Uses fictional data and
// deletes it afterwards. Run with `npm run test:live` (skipped without SUPABASE_* variables).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSupabase } from "@/lib/db/supabase";

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const db = () => getSupabase();

let assignmentId = "";
const created: string[] = [];

const aiResult = (marks: [number, number], feedback = "Good effort overall.") => ({
  questions: [
    { number: 1, marks: marks[0], maxMarks: 5, explanation: "x", quotes: ["a loop repeats"] },
    { number: 2, marks: marks[1], maxMarks: 2.5, explanation: "y", quotes: [] },
  ],
  feedback,
});

/** A fresh submission row. `ready` also saves text and an AI result so it can be reviewed. */
async function submission(options: { ready?: boolean; name?: string } = {}) {
  const { data, error } = await db()
    .from("submissions")
    .insert({
      assignment_id: assignmentId,
      student_name: options.name ?? "Asha Fictional",
      file_path: `live-test/${crypto.randomUUID()}.pdf`,
      file_name: "answers.pdf",
      file_type: "pdf",
      file_size: 1234,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  const id = data!.id as string;
  created.push(id);
  if (options.ready) {
    const { error: e } = await db()
      .from("submissions")
      .update({ extracted_text: "A loop repeats code.", extraction: { pages: 1 }, ai_result: aiResult([4, 2]), ai_model: "test-model" })
      .eq("id", id);
    expect(e).toBeNull();
    const { error: s } = await db().from("submissions").update({ status: "awaiting_review" }).eq("id", id);
    expect(s).toBeNull();
  }
  return id;
}

const row = async (id: string) => (await db().from("submissions").select("*").eq("id", id).single()).data!;
const decide = (id: string, decision: string, scores: unknown = null, feedback: string | null = null, comment: string | null = null) =>
  db().rpc("decide_submission", { p_submission_id: id, p_decision: decision, p_scores: scores, p_feedback: feedback, p_comment: comment });

describe.skipIf(!configured)("assignment database rules (live Supabase, needs migration 0008)", () => {
  beforeAll(async () => {
    const { data, error } = await db()
      .from("assignments")
      .insert({
        title: "Live schema test",
        instructions: "Fictional; created by the live test.",
        questions: [
          { number: 1, text: "What does a loop do?", maxMarks: 5, rubric: "Repetition." },
          { number: 2, text: "What is an array?", maxMarks: 2.5, rubric: "Ordered values." },
        ],
        reference_answers: { "1": "REFERENCE-SECRET" },
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    assignmentId = data!.id;
  });

  afterAll(async () => {
    if (assignmentId) await db().from("assignments").delete().eq("id", assignmentId); // cascades to submissions and decisions
  });

  it("a new submission starts as processing and empty; anything else is refused", async () => {
    const id = await submission();
    expect((await row(id)).status).toBe("processing");
    const { error } = await db().from("submissions").insert({
      assignment_id: assignmentId, student_name: "Bad Start", file_path: "x/y.pdf", file_name: "y.pdf",
      file_type: "pdf", file_size: 10, status: "approved",
    });
    expect(error).not.toBeNull();
  });

  it("refuses oversize files, odd types and one-letter names", async () => {
    const base = { assignment_id: assignmentId, student_name: "Asha Fictional", file_path: "x/y", file_name: "y", file_type: "pdf", file_size: 10 };
    expect((await db().from("submissions").insert({ ...base, file_size: 4194305 })).error).not.toBeNull();
    expect((await db().from("submissions").insert({ ...base, file_type: "exe" })).error).not.toBeNull();
    expect((await db().from("submissions").insert({ ...base, student_name: "A" })).error).not.toBeNull();
  });

  it("only allowed status changes happen, and needs_ocr/failed need a reason", async () => {
    const id = await submission();
    expect((await db().from("submissions").update({ status: "approved" }).eq("id", id)).error).not.toBeNull();
    expect((await db().from("submissions").update({ status: "awaiting_review" }).eq("id", id)).error).not.toBeNull(); // no text/AI yet
    expect((await db().from("submissions").update({ status: "failed" }).eq("id", id)).error).not.toBeNull(); // no reason
    expect((await db().from("submissions").update({ status: "needs_ocr", error: "This looks like a scanned document." }).eq("id", id)).error).toBeNull();
    expect((await db().from("submissions").update({ status: "processing", error: null }).eq("id", id)).error).not.toBeNull(); // needs_ocr is final
  });

  it("a failed submission can be retried: failed -> processing", async () => {
    const id = await submission();
    expect((await db().from("submissions").update({ status: "failed", error: "The AI service was unavailable." }).eq("id", id)).error).toBeNull();
    expect((await db().from("submissions").update({ status: "processing", error: null }).eq("id", id)).error).toBeNull();
  });

  it("the AI total is computed by the database, whatever the caller sends", async () => {
    const id = await submission();
    await db().from("submissions").update({ extracted_text: "text", extraction: {} }).eq("id", id);
    const { error } = await db().from("submissions").update({ ai_result: aiResult([3, 2]), ai_model: "m", ai_total: 99 }).eq("id", id);
    expect(error).toBeNull();
    expect(Number((await row(id)).ai_total)).toBe(5);
  });

  it("AI marks above a question's maximum, or missing questions, are refused", async () => {
    const id = await submission();
    await db().from("submissions").update({ extracted_text: "text", extraction: {} }).eq("id", id);
    expect((await db().from("submissions").update({ ai_result: aiResult([6, 1]), ai_model: "m" }).eq("id", id)).error).not.toBeNull();
    const partial = { questions: [{ number: 1, marks: 1, maxMarks: 5, explanation: "x", quotes: [] }], feedback: "f" };
    expect((await db().from("submissions").update({ ai_result: partial, ai_model: "m" }).eq("id", id)).error).not.toBeNull();
    expect((await row(id)).ai_result).toBeNull();
  });

  it("the AI recommendation and the extracted text cannot be changed once saved", async () => {
    const id = await submission({ ready: true });
    expect((await db().from("submissions").update({ ai_result: aiResult([5, 2.5]) }).eq("id", id)).error).not.toBeNull();
    expect((await db().from("submissions").update({ ai_total: 7.5 }).eq("id", id)).error).not.toBeNull();
    expect((await db().from("submissions").update({ extracted_text: "rewritten" }).eq("id", id)).error).not.toBeNull();
    expect((await db().from("submissions").update({ student_name: "Someone Else" }).eq("id", id)).error).not.toBeNull();
  });

  it("students see no marks, feedback or AI data before approval", async () => {
    const id = await submission({ ready: true, name: "Pending Pat" });
    const { data } = await db().from("student_submissions").select("*").eq("id", id).single();
    expect(data).toMatchObject({ status: "awaiting_review", scores: null, final_total: null, feedback: null, decided_at: null });
    expect(Object.keys(data!)).not.toEqual(expect.arrayContaining(["ai_result"]));
    for (const column of ["ai_result", "ai_total", "ai_model", "extracted_text", "comment"]) {
      expect((await db().from("student_submissions").select(column).limit(1)).error).not.toBeNull();
    }
    expect((await db().from("student_assignments").select("reference_answers").limit(1)).error).not.toBeNull();
  });

  it("approve copies the AI's marks and feedback, ignoring what the caller sends", async () => {
    const id = await submission({ ready: true });
    const { data, error } = await decide(id, "approve", [{ number: 1, marks: 0 }, { number: 2, marks: 0 }], "caller feedback", "private note");
    expect(error).toBeNull();
    expect(Number(data.final_total)).toBe(6);
    expect(data.feedback).toBe("Good effort overall.");
    expect(data.scores).toEqual([{ number: 1, marks: 4 }, { number: 2, marks: 2 }]);
    expect((await row(id)).status).toBe("approved");
    const { data: view } = await db().from("student_submissions").select("*").eq("id", id).single();
    expect(Number(view!.final_total)).toBe(6);
    expect(view!.feedback).toBe("Good effort overall.");
    expect(JSON.stringify(view)).not.toContain("private note");
  });

  it("edit validates every mark, needs feedback and a comment, and must change something", async () => {
    const id = await submission({ ready: true });
    const good = [{ number: 1, marks: 5 }, { number: 2, marks: 2.5 }];
    expect((await decide(id, "edit", [{ number: 1, marks: 6 }, { number: 2, marks: 1 }], "f", "c")).error).not.toBeNull(); // above max
    expect((await decide(id, "edit", [{ number: 1, marks: 1 }], "f", "c")).error).not.toBeNull(); // missing question
    expect((await decide(id, "edit", [{ number: 1, marks: 1 }, { number: 1, marks: 2 }], "f", "c")).error).not.toBeNull(); // duplicate
    expect((await decide(id, "edit", [{ number: 1, marks: 1.234 }, { number: 2, marks: 1 }], "f", "c")).error).not.toBeNull(); // 3 decimals
    expect((await decide(id, "edit", good, "", "c")).error).not.toBeNull(); // no feedback
    expect((await decide(id, "edit", good, "better", "")).error).not.toBeNull(); // no comment
    expect((await decide(id, "edit", [{ number: 1, marks: 4 }, { number: 2, marks: 2 }], "Good effort overall.", "c")).error?.message).toMatch(/unchanged_edit/);
    expect((await row(id)).status).toBe("awaiting_review"); // nothing was recorded by the refusals

    const { data, error } = await decide(id, "edit", good, "Full marks after review.", "AI was too harsh");
    expect(error).toBeNull();
    expect(Number(data.final_total)).toBe(7.5); // computed by the function, not supplied
    expect((await row(id)).status).toBe("edited");
  });

  it("reject stores no marks and no feedback", async () => {
    const id = await submission({ ready: true });
    const { data, error } = await decide(id, "reject", [{ number: 1, marks: 5 }, { number: 2, marks: 2 }], "ignored", "AI misread the file");
    expect(error).toBeNull();
    expect(data).toMatchObject({ scores: null, final_total: null, feedback: null });
    const { data: view } = await db().from("student_submissions").select("*").eq("id", id).single();
    expect(view).toMatchObject({ status: "rejected", scores: null, final_total: null, feedback: null });
  });

  it("a submission can be decided only once, and only when it is awaiting review", async () => {
    const id = await submission({ ready: true });
    expect((await decide(id, "approve")).error).toBeNull();
    expect((await decide(id, "reject")).error?.message).toMatch(/already_decided/);
    const processing = await submission();
    expect((await decide(processing, "approve")).error?.message).toMatch(/not_awaiting_review/);
    expect((await decide(crypto.randomUUID(), "approve")).error?.message).toMatch(/submission_not_found/);
    expect((await decide(id, "bogus")).error).not.toBeNull();
  });

  it("a decision cannot be edited or forged", async () => {
    const id = await submission({ ready: true });
    await decide(id, "approve");
    expect((await db().from("submission_decisions").update({ final_total: 100 }).eq("submission_id", id)).error).not.toBeNull();
    // A status of "approved" without a decision behind it is refused.
    const other = await submission({ ready: true });
    expect((await db().from("submissions").update({ status: "approved" }).eq("id", other)).error).not.toBeNull();
  });

  it("the submissions bucket exists, is private, and only allows PDF and DOCX up to 4 MB", async () => {
    const { data, error } = await db().storage.getBucket("submissions");
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: "submissions", public: false, file_size_limit: 4194304 });
    expect(data!.allowed_mime_types).toEqual(
      expect.arrayContaining(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
    );
  });
});
