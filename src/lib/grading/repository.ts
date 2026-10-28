import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/db/supabase";
import { getGeminiClient, getGeminiModel } from "@/lib/gemini/client";
import { RepositoryError } from "@/lib/projects/repository";
import { QuestionSchema } from "@/lib/schemas/assignment";
import { DecisionRecordSchema, SubmissionStatusSchema, type DecisionRecord } from "@/lib/schemas/submission";
import type { SubmissionDecisionInput } from "@/lib/validation/submission-decision";
import { generateGrading } from "./generator";
import type { GradingDeps, GradingStore, GradingSubject } from "./service";

const SubmissionRowSchema = z.object({
  assignment_id: z.string(),
  status: SubmissionStatusSchema,
  extracted_text: z.string().nullable(),
});
const AssignmentRowSchema = z.object({
  title: z.string(),
  instructions: z.string(),
  questions: z.array(QuestionSchema),
  reference_answers: z.record(z.string(), z.string()).nullable(),
});

export const supabaseGradingStore: GradingStore = {
  async load(id): Promise<GradingSubject | null> {
    const db = getSupabase();
    const { data, error } = await db.from("submissions").select("assignment_id, status, extracted_text").eq("id", id).maybeSingle();
    if (error) throw new RepositoryError("db_error", error.message);
    if (!data) return null;
    const submission = SubmissionRowSchema.safeParse(data);
    if (!submission.success) throw new RepositoryError("invalid_data", "Unexpected row shape from database.");

    const { data: assignmentRow, error: assignmentError } = await db
      .from("assignments")
      .select("title, instructions, questions, reference_answers")
      .eq("id", submission.data.assignment_id)
      .maybeSingle();
    if (assignmentError) throw new RepositoryError("db_error", assignmentError.message);
    const assignment = AssignmentRowSchema.safeParse(assignmentRow);
    if (!assignment.success) throw new RepositoryError("invalid_data", "Stored assignment failed validation.");

    return {
      status: submission.data.status,
      extractedText: submission.data.extracted_text,
      title: assignment.data.title,
      instructions: assignment.data.instructions,
      questions: assignment.data.questions,
      referenceAnswers: assignment.data.reference_answers,
    };
  },

  async saveResult(id, result, model) {
    // One conditional update. The database validates the marks (0..max, every question once), computes
    // ai_total itself, and refuses to change a result that is already saved.
    const { data, error } = await getSupabase()
      .from("submissions")
      .update({ ai_result: result, ai_model: model, status: "awaiting_review" })
      .eq("id", id)
      .eq("status", "processing")
      .is("ai_result", null)
      .select("id");
    if (error) throw new RepositoryError("db_error", error.message);
    return (data ?? []).length > 0;
  },

  async setFailed(id, reason) {
    const { error } = await getSupabase()
      .from("submissions")
      .update({ status: "failed", error: reason.slice(0, 300) })
      .eq("id", id)
      .eq("status", "processing");
    if (error) throw new RepositoryError("db_error", error.message);
  },
};

/**
 * The real dependencies: Gemini (server key) and the Supabase store. A missing key is reported when marking
 * starts, so the submission is kept as failed with a reason instead of the request crashing.
 */
export function defaultGradingDeps(): GradingDeps {
  const model = getGeminiModel();
  return { store: supabaseGradingStore, generate: (input) => generateGrading(input, { client: getGeminiClient(), model }), model };
}

// ---- Faculty decisions --------------------------------------------------------------------------------

export type DecisionErrorCode = "not_found" | "already_decided" | "not_awaiting_review" | "invalid";

export class DecisionError extends Error {
  constructor(
    readonly code: DecisionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DecisionError";
  }
}

const DecisionRowSchema = z.object({
  decision: z.enum(["approve", "edit", "reject"]),
  scores: z.array(z.object({ number: z.number(), marks: z.coerce.number() })).nullable(),
  final_total: z.coerce.number().nullable(),
  feedback: z.string().nullable(),
  comment: z.string().nullable(),
  decided_at: z.string(),
});

export function toDecisionRecord(row: unknown): DecisionRecord {
  const r = DecisionRowSchema.safeParse(row);
  if (!r.success) throw new RepositoryError("invalid_data", "Unexpected row shape from database.");
  const record = DecisionRecordSchema.safeParse({
    decision: r.data.decision,
    scores: r.data.scores,
    finalTotal: r.data.final_total,
    feedback: r.data.feedback,
    comment: r.data.comment,
    decidedAt: r.data.decided_at,
  });
  if (!record.success) throw new RepositoryError("invalid_data", "Stored decision failed validation.");
  return record.data;
}

/** Turns what the database function raised into a message a teacher can act on. */
function decisionError(message: string): DecisionError | null {
  if (message.includes("submission_not_found")) return new DecisionError("not_found", "Submission not found.");
  if (message.includes("already_decided")) return new DecisionError("already_decided", "This submission has already been decided. A decision is final.");
  if (message.includes("not_awaiting_review")) return new DecisionError("not_awaiting_review", "This submission is not waiting for review.");
  if (message.includes("unchanged_edit")) return new DecisionError("invalid", "Nothing was changed. Approve the AI's recommendation instead, or change a mark or the feedback.");
  if (message.includes("edit_needs_feedback_and_comment")) return new DecisionError("invalid", "An edit needs the student feedback and a private comment.");
  if (message.includes("marks must cover") || message.includes("outside 0..")) {
    return new DecisionError("invalid", "Give marks for every question, within each question's maximum.");
  }
  return null;
}

/**
 * Records the official decision through the database function, which does the whole change in one transaction.
 * Approve copies the AI's marks and feedback (nothing the browser sends is used); edit validates every mark
 * and computes the total in the database; reject stores no marks. A decision can only be made once.
 */
export async function decideSubmission(id: string, input: SubmissionDecisionInput): Promise<DecisionRecord> {
  const edit = input.decision === "edit" ? input : null;
  const { data, error } = await getSupabase().rpc("decide_submission", {
    p_submission_id: id,
    p_decision: input.decision,
    p_scores: edit ? edit.scores : null,
    p_feedback: edit ? edit.feedback : null,
    p_comment: edit ? edit.comment : null,
  });
  if (error) {
    throw decisionError(error.message) ?? new RepositoryError("db_error", error.message);
  }
  return toDecisionRecord(data);
}
