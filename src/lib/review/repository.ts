import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/db/supabase";
import { COLUMNS, toStored } from "@/lib/evaluation/repository";
import { RepositoryError } from "@/lib/projects/repository";
import { EVALUATION_STATUSES } from "@/lib/schemas/evaluation";
import { StudentResultSchema, type StudentResult } from "@/lib/schemas/review";
import { TeacherDecisionSchema, type TeacherDecision } from "@/lib/schemas/teacher-decision";
import { ReviewError, type ReviewStore } from "./service";

const QUEUE_LIMIT = 200;
const DECISION_COLUMNS = "id, evaluation_id, decision, approved_score, approved_feedback, comment, decided_at";

const DecisionRow = z.object({
  id: z.string(),
  evaluation_id: z.string(),
  decision: z.enum(["approve", "edit", "reject"]),
  // Postgres numeric may arrive as a number or a string.
  approved_score: z.union([z.number(), z.string()]).nullable(),
  approved_feedback: z.string().nullable(),
  comment: z.string().nullable(),
  decided_at: z.string(),
});

function toDecision(raw: unknown): TeacherDecision {
  const row = DecisionRow.safeParse(raw);
  const parsed = row.success
    ? TeacherDecisionSchema.safeParse({
        id: row.data.id,
        evaluationId: row.data.evaluation_id,
        decision: row.data.decision,
        approvedScore: row.data.approved_score === null ? null : Number(row.data.approved_score),
        approvedFeedback: row.data.approved_feedback,
        comment: row.data.comment,
        decidedAt: row.data.decided_at,
      })
    : null;
  if (!parsed?.success) throw new RepositoryError("invalid_data", "Stored decision has an unexpected shape.");
  return parsed.data;
}

function fail(error: { code?: string; message: string }): never {
  if (error.message.includes("already_decided") || error.code === "23505") throw new ReviewError("already_decided");
  if (error.message.includes("evaluation_not_found") || error.code === "23503") throw new ReviewError("not_found");
  throw new RepositoryError("db_error", error.message);
}

/** Supabase-backed review store. Decisions are written by the decide_evaluation function, atomically. */
export const reviewStore: ReviewStore = {
  async list(status) {
    const db = getSupabase();
    let query = db
      .from("evaluations")
      .select("id, project_id, week_number, status, suggested_score, created_at, confidence:result->confidence")
      .limit(QUEUE_LIMIT);
    if (status !== "all") query = query.eq("status", status);
    // Oldest first for the work queue; newest first for the history.
    const { data, error } = await query.order("created_at", { ascending: status === "pending_review" });
    if (error) fail(error);

    const rows = z
      .array(
        z.object({
          id: z.string(),
          project_id: z.string(),
          week_number: z.number(),
          status: z.enum(EVALUATION_STATUSES),
          suggested_score: z.union([z.number(), z.string()]).transform(Number),
          created_at: z.string(),
          confidence: z.object({ level: z.enum(["low", "medium", "high"]) }),
        }),
      )
      .parse(data ?? []);
    if (rows.length === 0) return [];

    const projects = await db
      .from("projects")
      .select("id, title")
      .in("id", [...new Set(rows.map((r) => r.project_id))]);
    if (projects.error) fail(projects.error);
    const titles = new Map((projects.data ?? []).map((p) => [String(p.id), String(p.title)]));

    return rows.map((r) => ({
      evaluationId: r.id,
      projectId: r.project_id,
      projectTitle: titles.get(r.project_id) ?? "Unknown project",
      weekNumber: r.week_number,
      status: r.status,
      suggestedScore: r.suggested_score,
      confidence: r.confidence.level,
      createdAt: r.created_at,
    }));
  },

  async getDetail(evaluationId) {
    const db = getSupabase();
    const found = await db.from("evaluations").select(COLUMNS).eq("id", evaluationId).maybeSingle();
    if (found.error) fail(found.error);
    if (!found.data) return null;
    const stored = toStored(found.data);

    const project = await db
      .from("projects")
      .select("id, title, repo_url")
      .eq("id", stored.evaluation.projectId)
      .single();
    if (project.error) fail(project.error);
    const decision = await db
      .from("teacher_decisions")
      .select(DECISION_COLUMNS)
      .eq("evaluation_id", evaluationId)
      .maybeSingle();
    if (decision.error) fail(decision.error);

    return {
      evaluation: stored.evaluation,
      snapshot: stored.snapshot,
      project: { id: String(project.data.id), title: String(project.data.title), repoUrl: String(project.data.repo_url) },
      decision: decision.data ? toDecision(decision.data) : null,
    };
  },

  async decide(d) {
    const { data, error } = await getSupabase().rpc("decide_evaluation", {
      p_evaluation_id: d.evaluationId,
      p_decision: d.decision,
      p_score: d.approvedScore,
      p_feedback: d.approvedFeedback,
      p_comment: d.comment,
    });
    if (error) fail(error);
    return toDecision(data);
  },

  async listResults(projectId) {
    const db = getSupabase();
    const evaluations = await db
      .from("evaluations")
      .select("id, week_number, status")
      .eq("project_id", projectId);
    if (evaluations.error) fail(evaluations.error);
    const decided = (evaluations.data ?? []).filter((e) => e.status !== "pending_review");
    if (decided.length === 0) return [];

    const decisions = await db
      .from("teacher_decisions")
      .select(DECISION_COLUMNS)
      .in("evaluation_id", decided.map((e) => String(e.id)));
    if (decisions.error) fail(decisions.error);

    const weeks = new Map(decided.map((e) => [String(e.id), Number(e.week_number)]));
    const results: StudentResult[] = (decisions.data ?? []).map((raw) => {
      const d = toDecision(raw);
      return StudentResultSchema.parse({
        weekNumber: weeks.get(d.evaluationId),
        outcome: d.decision === "approve" ? "approved" : d.decision === "edit" ? "edited" : "rejected",
        officialScore: d.approvedScore,
        feedback: d.approvedFeedback,
        decidedAt: d.decidedAt,
      });
    });
    return results.sort((a, b) => a.weekNumber - b.weekNumber);
  },
};
