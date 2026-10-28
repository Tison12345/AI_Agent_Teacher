import { average } from "@/lib/dashboard/summary";
import type { Evaluation } from "@/lib/schemas/evaluation";
import type { SubmissionStatus } from "@/lib/schemas/submission";
import {
  UNASSIGNED_ID,
  type ClassOverview,
  type StudentDetail,
  type StudentList,
  type StudentProject,
  type StudentSubmissionRow,
  type StudentSummary,
  type StudentWeek,
} from "./types";

/*
 * Turns the raw rows of the database into the student pages. Pure: it does no database work, so every number can be
 * tested. Rules:
 *  - A student's work is the projects whose owner_id is their account and the submissions whose student_id is their
 *    account; weekly checkpoints, evaluations and quizzes belong to a project, so they follow it.
 *  - Work with no owner (made before accounts existed) is shown as one separate "Unassigned" group, never guessed.
 *  - Only faculty-approved results (approved or edited) count as scores, and the AI's recommendation is kept apart.
 *    A rejection carries no score. Assignment marks are turned into a percentage of that assignment's total.
 */

export type RawStudent = { id: string; fullName: string; email: string; createdAt: string };
export type RawProject = { id: string; title: string; repoUrl: string; durationWeeks: number; ownerId: string | null; createdAt: string };
export type RawCheckpoint = { id: string; projectId: string; weekNumber: number; recordedAt: string; filesChanged: number; additions: number; deletions: number };
type EvaluationStatus = Evaluation["status"];
export type RawEvaluation = {
  id: string;
  projectId: string;
  checkpointId: string;
  weekNumber: number;
  status: EvaluationStatus;
  suggestedScore: number;
  confidence: "low" | "medium" | "high" | null;
};
export type RawDecision = { evaluationId: string; approvedScore: number | null; decidedAt: string };
/** A quiz for a checkpoint, with the student's attempt if there is one. */
export type RawQuiz = { checkpointId: string; correctCount: number | null; total: number | null };
export type RawAssignment = { id: string; title: string; maxMarks: number };
export type RawSubmission = {
  id: string;
  assignmentId: string;
  studentId: string | null;
  fileName: string;
  status: SubmissionStatus;
  aiTotal: number | null;
  error: string | null;
  createdAt: string;
};
export type RawSubmissionDecision = { submissionId: string; finalTotal: number | null; feedback: string | null; decidedAt: string };

export type ClassData = {
  students: RawStudent[];
  projects: RawProject[];
  checkpoints: RawCheckpoint[];
  evaluations: RawEvaluation[];
  decisions: RawDecision[];
  quizzes: RawQuiz[];
  assignments: RawAssignment[];
  submissions: RawSubmission[];
  submissionDecisions: RawSubmissionDecision[];
};

const OFFICIAL_SUBMISSION: SubmissionStatus[] = ["approved", "edited"];
const percent = (marks: number, max: number) => (max > 0 ? Math.round((marks / max) * 1000) / 10 : 0);
const byWeek = <T extends { weekNumber: number }>(a: T, b: T) => a.weekNumber - b.weekNumber;
const newestFirst = (a: { submittedAt: string | null }, b: { submittedAt: string | null }) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "");

/** The rows that belong to one owner: an account id, or null for work with no owner. */
type Scope = { ownerId: string | null };

function projectsOf(data: ClassData, scope: Scope): StudentProject[] {
  const decisionOf = new Map(data.decisions.map((d) => [d.evaluationId, d]));
  const quizOf = new Map(data.quizzes.map((q) => [q.checkpointId, q]));

  return data.projects
    .filter((project) => project.ownerId === scope.ownerId)
    .map((project) => {
      const weeks: StudentWeek[] = data.checkpoints
        .filter((c) => c.projectId === project.id)
        .map((checkpoint) => {
          const evaluation = data.evaluations.find((e) => e.checkpointId === checkpoint.id) ?? null;
          const decision = evaluation ? decisionOf.get(evaluation.id) : undefined;
          const quiz = quizOf.get(checkpoint.id);
          const official = evaluation && evaluation.status !== "pending_review" && evaluation.status !== "rejected" ? decision?.approvedScore ?? null : null;
          return {
            weekNumber: checkpoint.weekNumber,
            checkpointId: checkpoint.id,
            recordedAt: checkpoint.recordedAt,
            filesChanged: checkpoint.filesChanged,
            additions: checkpoint.additions,
            deletions: checkpoint.deletions,
            evaluation: evaluation
              ? {
                  id: evaluation.id,
                  status: evaluation.status,
                  aiScore: evaluation.suggestedScore,
                  officialScore: official,
                  confidence: evaluation.confidence,
                  decidedAt: decision?.decidedAt ?? null,
                }
              : null,
            quiz: quiz && quiz.correctCount !== null && quiz.total !== null ? { correctCount: quiz.correctCount, total: quiz.total } : null,
            quizCreated: quiz !== undefined,
          };
        })
        .sort(byWeek);
      return {
        id: project.id,
        title: project.title,
        repoUrl: project.repoUrl,
        durationWeeks: project.durationWeeks,
        createdAt: project.createdAt,
        weeks,
        averageOfficial: average(weeks.flatMap((w) => (w.evaluation?.officialScore == null ? [] : [w.evaluation.officialScore]))),
        pending: weeks.filter((w) => w.evaluation?.status === "pending_review").length,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Every assignment for this owner: each submission, and a "Not submitted" row for an assignment never submitted. */
function assignmentsOf(data: ClassData, scope: Scope, includeNotSubmitted: boolean): StudentSubmissionRow[] {
  const decisionOf = new Map(data.submissionDecisions.map((d) => [d.submissionId, d]));
  const rows: StudentSubmissionRow[] = [];

  for (const assignment of data.assignments) {
    const mine = data.submissions.filter((s) => s.assignmentId === assignment.id && s.studentId === scope.ownerId);
    for (const submission of mine) {
      const decision = decisionOf.get(submission.id);
      const official = OFFICIAL_SUBMISSION.includes(submission.status) ? decision?.finalTotal ?? null : null;
      rows.push({
        submissionId: submission.id,
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        maxMarks: assignment.maxMarks,
        status: submission.status,
        fileName: submission.fileName,
        submittedAt: submission.createdAt,
        aiTotal: submission.aiTotal,
        officialTotal: official,
        feedback: official === null ? null : decision?.feedback ?? null,
        decidedAt: decision?.decidedAt ?? null,
        error: submission.error,
      });
    }
    if (includeNotSubmitted && mine.length === 0) {
      rows.push({
        submissionId: null,
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        maxMarks: assignment.maxMarks,
        status: "not_submitted",
        fileName: null,
        submittedAt: null,
        aiTotal: null,
        officialTotal: null,
        feedback: null,
        decidedAt: null,
        error: null,
      });
    }
  }
  // Newest submissions first; assignments never submitted last.
  return rows.sort(newestFirst);
}

function summarize(id: string, name: string, email: string | null, joinedAt: string | null, projects: StudentProject[], assignments: StudentSubmissionRow[]): StudentSummary {
  const submitted = assignments.filter((a) => a.submissionId !== null);
  const projectScores = projects.flatMap((p) => p.weeks.flatMap((w) => (w.evaluation?.officialScore == null ? [] : [w.evaluation.officialScore])));
  const assignmentScores = submitted.flatMap((a) => (a.officialTotal === null ? [] : [percent(a.officialTotal, a.maxMarks)]));
  return {
    id,
    name,
    email,
    joinedAt,
    projectCount: projects.length,
    weeksRecorded: projects.reduce((sum, p) => sum + p.weeks.length, 0),
    assignmentsSubmitted: submitted.length,
    weeklyPending: projects.reduce((sum, p) => sum + p.pending, 0),
    assignmentPending: submitted.filter((a) => a.status === "awaiting_review").length,
    averageOfficial: average([...projectScores, ...assignmentScores]),
    projectAverage: average(projectScores),
    assignmentAverage: average(assignmentScores),
  };
}

function detailFor(data: ClassData, scope: Scope, header: { id: string; name: string; email: string | null; joinedAt: string | null }): StudentDetail {
  const projects = projectsOf(data, scope);
  const assignments = assignmentsOf(data, scope, scope.ownerId !== null); // old unowned work has no "not submitted"
  return { summary: summarize(header.id, header.name, header.email, header.joinedAt, projects, assignments), projects, assignments };
}

const hasUnassignedWork = (data: ClassData) => data.projects.some((p) => p.ownerId === null) || data.submissions.some((s) => s.studentId === null);

const UNASSIGNED_HEADER = { id: UNASSIGNED_ID, name: "Unassigned (before accounts)", email: null, joinedAt: null };

/** The class overview and one summary per student account, plus an Unassigned group when old work has no owner. */
export function buildStudentList(data: ClassData): StudentList {
  const summaries = data.students
    .map((student) => detailFor(data, { ownerId: student.id }, { id: student.id, name: student.fullName, email: student.email, joinedAt: student.createdAt }).summary)
    .sort((a, b) => a.name.localeCompare(b.name));
  const students = hasUnassignedWork(data) ? [...summaries, detailFor(data, { ownerId: null }, UNASSIGNED_HEADER).summary] : summaries;

  // Class totals count every project and submission, including unassigned ones. The average is across real students.
  const scored = summaries.flatMap((s) => (s.averageOfficial === null ? [] : [s.averageOfficial]));
  const overview: ClassOverview = {
    totalStudents: data.students.length,
    totalProjects: data.projects.length,
    assignmentsSubmitted: data.submissions.length,
    assignmentsAwaitingReview: data.submissions.filter((s) => s.status === "awaiting_review").length,
    weeklyAwaitingReview: data.evaluations.filter((e) => e.status === "pending_review").length,
    overallAverage: average(scored),
    studentsWithScores: scored.length,
  };
  return { overview, students };
}

/** One student's full picture, or null when there is no such student (an unknown id). */
export function buildStudentDetail(data: ClassData, studentId: string): StudentDetail | null {
  if (studentId === UNASSIGNED_ID) return hasUnassignedWork(data) ? detailFor(data, { ownerId: null }, UNASSIGNED_HEADER) : null;
  const student = data.students.find((s) => s.id === studentId);
  if (!student) return null;
  return detailFor(data, { ownerId: student.id }, { id: student.id, name: student.fullName, email: student.email, joinedAt: student.createdAt });
}
