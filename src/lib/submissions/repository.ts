import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/db/supabase";
import { RepositoryError } from "@/lib/projects/repository";
import { toDecisionRecord } from "@/lib/grading/repository";
import {
  AiResultSchema,
  ExtractionInfoSchema,
  FacultySubmissionSchema,
  FacultySubmissionSummarySchema,
  StudentSubmissionSchema,
  SubmissionStatusSchema,
  type FacultySubmission,
  type FacultySubmissionSummary,
  type StudentSubmission,
} from "@/lib/schemas/submission";
import { extractText } from "./extractor";
import type { UploadType } from "./file";
import type { FileStorage, SubmissionDeps, SubmissionStore } from "./service";

const BUCKET = "submissions";
const DOWNLOAD_LINK_SECONDS = 600;

// Students read ONLY the `student_submissions` view: no extracted text, no AI columns, and marks and
// feedback only after faculty approve. Faculty read the table, with explicit columns.
const STUDENT_COLUMNS =
  "id, assignment_id, student_name, file_name, file_type, file_size, status, error, created_at, scores, final_total, feedback, decided_at";
const FACULTY_COLUMNS =
  "id, assignment_id, student_name, file_name, file_type, file_size, status, error, created_at, ai_total, extracted_text";

const StudentRowSchema = z.object({
  id: z.string(),
  assignment_id: z.string(),
  student_name: z.string(),
  file_name: z.string(),
  file_type: z.enum(["pdf", "docx"]),
  file_size: z.number(),
  status: SubmissionStatusSchema,
  error: z.string().nullable(),
  created_at: z.string(),
  scores: z.array(z.object({ number: z.number(), marks: z.coerce.number() })).nullable(),
  final_total: z.coerce.number().nullable(),
  feedback: z.string().nullable(),
  decided_at: z.string().nullable(),
});

const FacultyRowSchema = StudentRowSchema.omit({ scores: true, final_total: true, feedback: true, decided_at: true }).extend({
  ai_total: z.coerce.number().nullable(),
  extracted_text: z.string().nullable(),
});

function parseRow<T extends z.ZodType>(schema: T, row: unknown): z.output<T> {
  const parsed = schema.safeParse(row);
  if (!parsed.success) throw new RepositoryError("invalid_data", "Unexpected row shape from database.");
  return parsed.data;
}

function toStudent(row: unknown): StudentSubmission {
  const r = parseRow(StudentRowSchema, row);
  const result = StudentSubmissionSchema.safeParse({
    id: r.id,
    assignmentId: r.assignment_id,
    studentName: r.student_name,
    fileName: r.file_name,
    fileType: r.file_type,
    fileSize: r.file_size,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
    scores: r.scores,
    finalTotal: r.final_total,
    feedback: r.feedback,
    decidedAt: r.decided_at,
  });
  if (!result.success) throw new RepositoryError("invalid_data", "Stored submission failed validation.");
  return result.data;
}

function toFacultySummary(row: unknown): FacultySubmissionSummary {
  const r = parseRow(FacultyRowSchema, row);
  return FacultySubmissionSummarySchema.parse({
    id: r.id,
    assignmentId: r.assignment_id,
    studentName: r.student_name,
    fileName: r.file_name,
    fileType: r.file_type,
    fileSize: r.file_size,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
    aiTotal: r.ai_total,
    hasText: r.extracted_text !== null,
  });
}

/** Escapes the characters that act as wildcards in a Postgres ILIKE pattern, so a typed name matches literally. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---- Student reads ------------------------------------------------------------------------------

/** One student's submissions for an assignment, found by the name they typed (case-insensitive). */
export async function listStudentSubmissions(assignmentId: string, studentName: string): Promise<StudentSubmission[]> {
  const { data, error } = await getSupabase()
    .from("student_submissions")
    .select(STUDENT_COLUMNS)
    .eq("assignment_id", assignmentId)
    .ilike("student_name", likeLiteral(studentName.trim()))
    .order("created_at", { ascending: false });
  if (error) throw new RepositoryError("db_error", error.message);
  return (data ?? []).map(toStudent);
}

export async function getStudentSubmission(id: string): Promise<StudentSubmission | null> {
  const { data, error } = await getSupabase().from("student_submissions").select(STUDENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new RepositoryError("db_error", error.message);
  return data ? toStudent(data) : null;
}

// ---- Faculty reads ------------------------------------------------------------------------------

export async function listFacultySubmissions(assignmentId: string): Promise<FacultySubmissionSummary[]> {
  const { data, error } = await getSupabase()
    .from("submissions")
    .select(FACULTY_COLUMNS)
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false });
  if (error) throw new RepositoryError("db_error", error.message);
  return (data ?? []).map(toFacultySummary);
}

/** One submission for faculty: the extracted text and a short-lived link to the original file. */
export async function getFacultySubmission(id: string): Promise<FacultySubmission | null> {
  const { data, error } = await getSupabase()
    .from("submissions")
    .select(`${FACULTY_COLUMNS}, file_path, extraction, ai_result, ai_model`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new RepositoryError("db_error", error.message);
  if (!data) return null;

  const row = data as unknown as {
    file_path: string;
    extraction: unknown;
    extracted_text: string | null;
    ai_result: unknown;
    ai_model: string | null;
  };
  const extraction = ExtractionInfoSchema.nullable().safeParse(row.extraction ?? null);
  const aiResult = AiResultSchema.nullable().safeParse(row.ai_result ?? null);
  if (!aiResult.success) throw new RepositoryError("invalid_data", "Stored AI result failed validation.");

  const { data: decisionRow, error: decisionError } = await getSupabase()
    .from("submission_decisions")
    .select("decision, scores, final_total, feedback, comment, decided_at")
    .eq("submission_id", id)
    .maybeSingle();
  if (decisionError) throw new RepositoryError("db_error", decisionError.message);

  const signed = await getSupabase().storage.from(BUCKET).createSignedUrl(row.file_path, DOWNLOAD_LINK_SECONDS);
  return FacultySubmissionSchema.parse({
    ...toFacultySummary(data),
    extractedText: row.extracted_text,
    extraction: extraction.success ? extraction.data : null,
    downloadUrl: signed.error ? null : signed.data.signedUrl,
    aiResult: aiResult.data,
    aiModel: row.ai_model,
    decision: decisionRow ? toDecisionRecord(decisionRow) : null,
  });
}

// ---- Writes (used by the service) -----------------------------------------------------------------

const CONTENT_TYPES: Record<UploadType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const supabaseStore: SubmissionStore = {
  async insert(row) {
    const { error } = await getSupabase().from("submissions").insert({
      id: row.id,
      assignment_id: row.assignmentId,
      student_name: row.studentName,
      file_path: row.filePath,
      file_name: row.fileName,
      file_type: row.fileType,
      file_size: row.fileSize,
    });
    if (error) throw new RepositoryError("db_error", error.message);
  },

  async saveExtraction(id, text, info) {
    const { error } = await getSupabase().from("submissions").update({ extracted_text: text, extraction: info }).eq("id", id);
    if (error) throw new RepositoryError("db_error", error.message);
  },

  async setStatus(id, status, reason) {
    const { error } = await getSupabase().from("submissions").update({ status, error: reason.slice(0, 300) }).eq("id", id);
    if (error) throw new RepositoryError("db_error", error.message);
  },

  async claimRetry(id) {
    // One atomic statement: only a FAILED row can be claimed, and only by one caller.
    const { data, error } = await getSupabase()
      .from("submissions")
      .update({ status: "processing", error: null })
      .eq("id", id)
      .eq("status", "failed")
      .select("file_path, file_type, extracted_text")
      .maybeSingle();
    if (error) throw new RepositoryError("db_error", error.message);
    if (!data) return null;
    const row = data as { file_path: string; file_type: UploadType; extracted_text: string | null };
    return { filePath: row.file_path, fileType: row.file_type, hasText: row.extracted_text !== null };
  },

  async exists(id) {
    const { data, error } = await getSupabase().from("submissions").select("id").eq("id", id).maybeSingle();
    if (error) throw new RepositoryError("db_error", error.message);
    return data !== null;
  },
};

export const supabaseStorage: FileStorage = {
  async upload(path, bytes, fileType) {
    const { error } = await getSupabase().storage.from(BUCKET).upload(path, bytes, {
      contentType: CONTENT_TYPES[fileType],
      upsert: false,
    });
    if (error) throw new Error(error.message);
  },
  async download(path) {
    const { data, error } = await getSupabase().storage.from(BUCKET).download(path);
    if (error || !data) throw new Error(error?.message ?? "missing file");
    return new Uint8Array(await data.arrayBuffer());
  },
};

/** The real dependencies: Supabase tables and Storage, and the local Python extraction service. */
export function defaultSubmissionDeps(): SubmissionDeps {
  return { store: supabaseStore, storage: supabaseStorage, extract: (bytes, type) => extractText(bytes, type) };
}
