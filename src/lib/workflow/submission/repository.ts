import "server-only";
import { getSupabase } from "@/lib/db/supabase";
import { getGeminiClient, getGeminiModel } from "@/lib/gemini/client";
import { loadGradingSubject } from "@/lib/grading/repository";
import { requestGrading } from "@/lib/grading/generator";
import { RepositoryError } from "@/lib/projects/repository";
import { ExtractionInfoSchema } from "@/lib/schemas/submission";
import { extractText } from "@/lib/submissions/extractor";
import type { UploadType } from "@/lib/submissions/file";
import { supabaseStorage } from "@/lib/submissions/repository";
import type { SubmissionGraphDeps, WorkflowStore } from "./graph";

/** Each write below changes the row only while it is still "processing", so repeating it is harmless. */
export const supabaseWorkflowStore: WorkflowStore = {
  async loadSnapshot(id) {
    const { data, error } = await getSupabase()
      .from("submissions")
      .select("status, file_path, file_type, extracted_text, extraction")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new RepositoryError("db_error", error.message);
    if (!data) return null;
    const row = data as { status: never; file_path: string; file_type: UploadType; extracted_text: string | null; extraction: unknown };
    const extraction = ExtractionInfoSchema.nullable().safeParse(row.extraction ?? null);
    return {
      status: row.status,
      filePath: row.file_path,
      fileType: row.file_type,
      hasText: row.extracted_text !== null,
      extraction: extraction.success ? extraction.data : null,
    };
  },

  async saveExtraction(id, text, info) {
    const { error } = await getSupabase().from("submissions").update({ extracted_text: text, extraction: info }).eq("id", id);
    if (error) throw new RepositoryError("db_error", error.message);
  },

  loadSubject: loadGradingSubject,

  async saveResult(id, result, model) {
    // One conditional update. The database validates the marks (0..max, every question once), computes
    // ai_total itself, and refuses to change a result that is already saved.
    const db = getSupabase();
    const { data, error } = await db
      .from("submissions")
      .update({ ai_result: result, ai_model: model, status: "awaiting_review" })
      .eq("id", id)
      .eq("status", "processing")
      .is("ai_result", null)
      .select("id");
    if (error) throw new RepositoryError("db_error", error.message);
    if ((data ?? []).length > 0) return "saved";

    // Not updated: either an earlier run of this step already saved it, or the submission moved on.
    const { data: row, error: readError } = await db.from("submissions").select("ai_result").eq("id", id).maybeSingle();
    if (readError) throw new RepositoryError("db_error", readError.message);
    return row && row.ai_result !== null ? "already" : "skipped";
  },

  async markNeedsOcr(id, reason) {
    const { error } = await getSupabase()
      .from("submissions")
      .update({ status: "needs_ocr", error: reason.slice(0, 300) })
      .eq("id", id)
      .eq("status", "processing");
    if (error) throw new RepositoryError("db_error", error.message);
  },

  async setFailed(id, reason) {
    const { error } = await getSupabase()
      .from("submissions")
      .update({ status: "failed", error: reason.slice(0, 300) })
      .eq("id", id)
      .eq("status", "processing");
    if (error) throw new RepositoryError("db_error", error.message);
  },

  async decisionExists(id) {
    const { data, error } = await getSupabase().from("submission_decisions").select("submission_id").eq("submission_id", id).maybeSingle();
    if (error) throw new RepositoryError("db_error", error.message);
    return data !== null;
  },
};

/** The real dependencies: Supabase, Storage, the local extraction service and Gemini (server key). */
export function defaultSubmissionGraphDeps(): SubmissionGraphDeps {
  const model = getGeminiModel();
  return {
    store: supabaseWorkflowStore,
    download: (path) => supabaseStorage.download(path),
    extract: (bytes, type, signal) => extractText(bytes, type, { signal }),
    requestGrading: (input, issues, signal) => requestGrading(input, issues, { client: getGeminiClient(), model, signal }),
    model,
  };
}
