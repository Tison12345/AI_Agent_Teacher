import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/db/supabase";
import { RepositoryError } from "@/lib/projects/repository";
import { EVALUATION_STATUSES } from "@/lib/schemas/evaluation";
import { SubmissionStatusSchema } from "@/lib/schemas/submission";
import { buildStudentDetail, buildStudentList, type ClassData } from "./aggregate";
import type { StudentDetail, StudentList } from "./types";

/*
 * Reads what the faculty student pages need, then lets aggregate.ts work out the numbers. It reads with explicit
 * columns (never the extracted text or the AI's full output) and in a handful of queries, not one per student.
 * Faculty only: the routes that call it are behind the faculty sign-in.
 */

const LIMIT = 5000;
const num = z.union([z.number(), z.string()]).transform(Number);
const nullableNum = z.union([z.number(), z.string(), z.null()]).transform((v) => (v === null ? null : Number(v)));

async function rows<T extends z.ZodType>(table: string, columns: string, schema: T): Promise<z.output<T>[]> {
  const { data, error } = await getSupabase().from(table).select(columns).limit(LIMIT);
  if (error) throw new RepositoryError("db_error", error.message);
  const parsed = z.array(schema).safeParse(data ?? []);
  if (!parsed.success) throw new RepositoryError("invalid_data", `Unexpected rows from ${table}.`);
  return parsed.data;
}

async function loadClassData(): Promise<ClassData> {
  const db = getSupabase();
  const accounts = await db.from("app_users").select("id, full_name, email, created_at").eq("role", "student").limit(LIMIT);
  if (accounts.error) {
    // Migration 0010 (accounts) is needed for any student to exist.
    throw new RepositoryError("db_error", accounts.error.message);
  }

  const [projects, checkpoints, evaluations, decisions, quizzes, attempts, assignments, submissions, submissionDecisions] = await Promise.all([
    rows("projects", "id, title, repo_url, duration_weeks, owner_id, created_at", z.object({ id: z.string(), title: z.string(), repo_url: z.string(), duration_weeks: z.number(), owner_id: z.string().nullable(), created_at: z.string() })),
    rows("weekly_checkpoints", "id, project_id, week_number, recorded_at, files_changed, additions, deletions", z.object({ id: z.string(), project_id: z.string(), week_number: z.number(), recorded_at: z.string(), files_changed: z.number(), additions: z.number(), deletions: z.number() })),
    (async () => {
      const { data, error } = await db.from("evaluations").select("id, project_id, checkpoint_id, week_number, status, suggested_score, confidence:result->confidence").limit(LIMIT);
      if (error) throw new RepositoryError("db_error", error.message);
      const parsed = z
        .array(
          z.object({
            id: z.string(),
            project_id: z.string(),
            checkpoint_id: z.string(),
            week_number: z.number(),
            status: z.enum(EVALUATION_STATUSES),
            suggested_score: num,
            confidence: z.object({ level: z.enum(["low", "medium", "high"]) }).nullable().optional(),
          }),
        )
        .safeParse(data ?? []);
      if (!parsed.success) throw new RepositoryError("invalid_data", "Unexpected rows from evaluations.");
      return parsed.data;
    })(),
    rows("teacher_decisions", "evaluation_id, approved_score, decided_at", z.object({ evaluation_id: z.string(), approved_score: nullableNum, decided_at: z.string() })),
    rows("quizzes", "id, checkpoint_id", z.object({ id: z.string(), checkpoint_id: z.string() })),
    rows("quiz_attempts", "quiz_id, correct_count, total", z.object({ quiz_id: z.string(), correct_count: z.number(), total: z.number() })),
    rows("assignments", "id, title, max_marks", z.object({ id: z.string(), title: z.string(), max_marks: num })),
    rows("submissions", "id, assignment_id, student_id, file_name, status, ai_total, error, created_at", z.object({ id: z.string(), assignment_id: z.string(), student_id: z.string().nullable(), file_name: z.string(), status: SubmissionStatusSchema, ai_total: nullableNum, error: z.string().nullable(), created_at: z.string() })),
    rows("submission_decisions", "submission_id, final_total, feedback, decided_at", z.object({ submission_id: z.string(), final_total: nullableNum, feedback: z.string().nullable(), decided_at: z.string() })),
  ]);

  const attemptByQuiz = new Map(attempts.map((a) => [a.quiz_id, a]));
  const accountRows = z.array(z.object({ id: z.string(), full_name: z.string(), email: z.string(), created_at: z.string() })).parse(accounts.data ?? []);

  return {
    students: accountRows.map((a) => ({ id: a.id, fullName: a.full_name, email: a.email, createdAt: a.created_at })),
    projects: projects.map((p) => ({ id: p.id, title: p.title, repoUrl: p.repo_url, durationWeeks: p.duration_weeks, ownerId: p.owner_id, createdAt: p.created_at })),
    checkpoints: checkpoints.map((c) => ({ id: c.id, projectId: c.project_id, weekNumber: c.week_number, recordedAt: c.recorded_at, filesChanged: c.files_changed, additions: c.additions, deletions: c.deletions })),
    evaluations: evaluations.map((e) => ({ id: e.id, projectId: e.project_id, checkpointId: e.checkpoint_id, weekNumber: e.week_number, status: e.status, suggestedScore: e.suggested_score, confidence: e.confidence?.level ?? null })),
    decisions: decisions.map((d) => ({ evaluationId: d.evaluation_id, approvedScore: d.approved_score, decidedAt: d.decided_at })),
    quizzes: quizzes.map((q) => {
      const attempt = attemptByQuiz.get(q.id);
      return { checkpointId: q.checkpoint_id, correctCount: attempt?.correct_count ?? null, total: attempt?.total ?? null };
    }),
    assignments: assignments.map((a) => ({ id: a.id, title: a.title, maxMarks: a.max_marks })),
    submissions: submissions.map((s) => ({ id: s.id, assignmentId: s.assignment_id, studentId: s.student_id, fileName: s.file_name, status: s.status, aiTotal: s.ai_total, error: s.error, createdAt: s.created_at })),
    submissionDecisions: submissionDecisions.map((d) => ({ submissionId: d.submission_id, finalTotal: d.final_total, feedback: d.feedback, decidedAt: d.decided_at })),
  };
}

/** The class overview and a summary per student. */
export async function listStudents(): Promise<StudentList> {
  return buildStudentList(await loadClassData());
}

/** One student's projects, weeks, quizzes and assignments, or null for an unknown id. */
export async function getStudent(id: string): Promise<StudentDetail | null> {
  return buildStudentDetail(await loadClassData(), id);
}
