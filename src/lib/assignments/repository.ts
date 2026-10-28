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

function toFaculty(row: unknown, submissionCount: number): FacultyAssignment {
  const r = parseRow(FacultyRowSchema, row);
  const assignment = FacultyAssignmentSchema.safeParse({
    ...toStudent(row),
    submissionCount,
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
  return toFaculty(data, 0);
}

/** Submission counts per assignment. Fine at demo scale: one lightweight column, counted here. */
async function submissionCounts(): Promise<Map<string, number>> {
  const { data, error } = await getSupabase().from("submissions").select("assignment_id");
  if (error) throw new RepositoryError("db_error", error.message);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = (row as { assignment_id: string }).assignment_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Faculty list: every assignment with its submission count. Reference answers are not included. */
export async function listFacultyAssignments(): Promise<FacultyAssignmentSummary[]> {
  const { data, error } = await getSupabase()
    .from("assignments")
    .select(FACULTY_SUMMARY_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new RepositoryError("db_error", error.message);
  const counts = await submissionCounts();
  // Parsing with the summary schema drops the reference answers, which the list never needs.
  return (data ?? []).map((row) =>
    FacultyAssignmentSummarySchema.parse(toFaculty(row, counts.get((row as { id: string }).id) ?? 0)),
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
  const { count, error: countError } = await getSupabase()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", id);
  if (countError) throw new RepositoryError("db_error", countError.message);
  return toFaculty(data, count ?? 0);
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
