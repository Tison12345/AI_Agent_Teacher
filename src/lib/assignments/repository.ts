import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/db/supabase";
import { RepositoryError } from "@/lib/projects/repository";
import {
  FacultyAssignmentSchema,
  FacultyAssignmentSummarySchema,
  QuestionSchema,
  StudentAssignmentSchema,
  type FacultyAssignment,
  type FacultyAssignmentSummary,
  type StudentAssignment,
} from "@/lib/schemas/assignment";
import type { AssignmentInput } from "@/lib/validation/assignment";

// Students read ONLY the `student_assignments` view, which has no reference answers.
// Faculty read the table. Keep the column lists explicit so nothing is exposed by accident.
const STUDENT_COLUMNS = "id, title, instructions, questions, max_marks, created_at";
const FACULTY_SUMMARY_COLUMNS = `${STUDENT_COLUMNS}, reference_answers`;

const StudentRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  questions: z.array(QuestionSchema),
  max_marks: z.coerce.number(),
  created_at: z.string(),
});
const FacultyRowSchema = StudentRowSchema.extend({
  reference_answers: z.record(z.string(), z.string()).nullable(),
});

function parseRow<T extends z.ZodType>(schema: T, row: unknown): z.output<T> {
  const parsed = schema.safeParse(row);
  if (!parsed.success) throw new RepositoryError("invalid_data", "Unexpected row shape from database.");
  return parsed.data;
}

function toStudent(row: unknown): StudentAssignment {
  const r = parseRow(StudentRowSchema, row);
  const assignment = StudentAssignmentSchema.safeParse({
    id: r.id,
    title: r.title,
    instructions: r.instructions,
    questions: r.questions,
    maxMarks: r.max_marks,
    createdAt: r.created_at,
  });
  if (!assignment.success) throw new RepositoryError("invalid_data", "Stored assignment failed validation.");
  return assignment.data;
}

/** Where an assignment's submissions stand. Computed from their statuses, never stored. */
export type SubmissionStats = { total: number; awaitingReview: number; decided: number; needsAttention: number };

const NO_SUBMISSIONS: SubmissionStats = { total: 0, awaitingReview: 0, decided: 0, needsAttention: 0 };

export function addToStats(stats: SubmissionStats, status: string): SubmissionStats {
  return {
    total: stats.total + 1,
    awaitingReview: stats.awaitingReview + (status === "awaiting_review" ? 1 : 0),
    decided: stats.decided + (["approved", "edited", "rejected"].includes(status) ? 1 : 0),
    needsAttention: stats.needsAttention + (status === "failed" || status === "needs_ocr" ? 1 : 0),
  };
}

function toFaculty(row: unknown, stats: SubmissionStats): FacultyAssignment {
  const r = parseRow(FacultyRowSchema, row);
  const assignment = FacultyAssignmentSchema.safeParse({
    ...toStudent(row),
    submissionCount: stats.total,
    awaitingReviewCount: stats.awaitingReview,
    decidedCount: stats.decided,
    needsAttentionCount: stats.needsAttention,
    hasReferenceAnswers: r.reference_answers !== null && Object.keys(r.reference_answers).length > 0,
    referenceAnswers: r.reference_answers,
  });
  if (!assignment.success) throw new RepositoryError("invalid_data", "Stored assignment failed validation.");
  return assignment.data;
}

/** Creates an assignment. Question numbers follow the order given; the total is computed by the database. */
export async function createAssignment(input: AssignmentInput): Promise<FacultyAssignment> {
  const questions = input.questions.map((q, i) => ({
    number: i + 1,
    text: q.text,
    maxMarks: q.maxMarks,
    rubric: q.rubric,
  }));
  const references = Object.fromEntries(
    input.questions.flatMap((q, i) => (q.referenceAnswer ? [[String(i + 1), q.referenceAnswer]] : [])),
  );
  const { data, error } = await getSupabase()
    .from("assignments")
    .insert({
      title: input.title,
      instructions: input.instructions,
      questions,
      reference_answers: Object.keys(references).length > 0 ? references : null,
    })
    .select(FACULTY_SUMMARY_COLUMNS)
    .single();
  if (error) throw new RepositoryError("db_error", error.message);
  return toFaculty(data, NO_SUBMISSIONS);
}

/** Submission stats per assignment. Fine at demo scale: two lightweight columns, counted here. */
async function submissionStats(): Promise<Map<string, SubmissionStats>> {
  const { data, error } = await getSupabase().from("submissions").select("assignment_id, status");
  if (error) throw new RepositoryError("db_error", error.message);
  const stats = new Map<string, SubmissionStats>();
  for (const row of data ?? []) {
    const { assignment_id: id, status } = row as { assignment_id: string; status: string };
    stats.set(id, addToStats(stats.get(id) ?? NO_SUBMISSIONS, status));
  }
  return stats;
}

/** Faculty list: every assignment with its submission count. Reference answers are not included. */
export async function listFacultyAssignments(): Promise<FacultyAssignmentSummary[]> {
  const { data, error } = await getSupabase()
    .from("assignments")
    .select(FACULTY_SUMMARY_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new RepositoryError("db_error", error.message);
  const stats = await submissionStats();
  // Parsing with the summary schema drops the reference answers, which the list never needs.
  return (data ?? []).map((row) =>
    FacultyAssignmentSummarySchema.parse(toFaculty(row, stats.get((row as { id: string }).id) ?? NO_SUBMISSIONS)),
  );
}

/** One assignment for faculty, with the reference answers. Null when it does not exist. */
export async function getFacultyAssignment(id: string): Promise<FacultyAssignment | null> {
  const { data, error } = await getSupabase()
    .from("assignments")
    .select(FACULTY_SUMMARY_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new RepositoryError("db_error", error.message);
  if (!data) return null;
  const { data: statuses, error: statusError } = await getSupabase().from("submissions").select("status").eq("assignment_id", id);
  if (statusError) throw new RepositoryError("db_error", statusError.message);
  const stats = (statuses ?? []).reduce((sum, row) => addToStats(sum, (row as { status: string }).status), NO_SUBMISSIONS);
  return toFaculty(data, stats);
}

/** What students see: read from the view that has no reference answers and no AI columns. */
export async function listStudentAssignments(): Promise<StudentAssignment[]> {
  const { data, error } = await getSupabase()
    .from("student_assignments")
    .select(STUDENT_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new RepositoryError("db_error", error.message);
  return (data ?? []).map(toStudent);
}

export async function getStudentAssignment(id: string): Promise<StudentAssignment | null> {
  const { data, error } = await getSupabase()
    .from("student_assignments")
    .select(STUDENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new RepositoryError("db_error", error.message);
  return data ? toStudent(data) : null;
}
