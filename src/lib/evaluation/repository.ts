import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/db/supabase";
import { RepositoryError } from "@/lib/projects/repository";
import {
  EvaluationSchema,
  EVALUATION_STATUSES,
  SnapshotSchema,
} from "@/lib/schemas/evaluation";
import {
  EvaluationConflictError,
  type EvaluationStore,
  type StoredEvaluation,
} from "./service";

export const COLUMNS =
  "id, project_id, checkpoint_id, week_number, suggested_score, result, snapshot, model, status, created_at";

const Row = z.object({
  id: z.string(),
  project_id: z.string(),
  checkpoint_id: z.string(),
  week_number: z.number(),
  // Postgres numeric may arrive as a number or a string.
  suggested_score: z.union([z.number(), z.string()]).transform(Number),
  result: z.record(z.string(), z.unknown()),
  snapshot: z.unknown(),
  model: z.string(),
  status: z.enum(EVALUATION_STATUSES),
  created_at: z.string(),
});

export function toStored(raw: unknown): StoredEvaluation {
  const row = Row.safeParse(raw);
  if (!row.success) throw new RepositoryError("invalid_data", "Stored evaluation has an unexpected shape.");
  const r = row.data;
  const evaluation = EvaluationSchema.safeParse({
    id: r.id,
    projectId: r.project_id,
    checkpointId: r.checkpoint_id,
    weekNumber: r.week_number,
    suggestedScore: r.suggested_score,
    ...r.result,
    model: r.model,
    status: r.status,
    createdAt: r.created_at,
  });
  const snapshot = SnapshotSchema.safeParse(r.snapshot);
  if (!evaluation.success || !snapshot.success) {
    throw new RepositoryError("invalid_data", "Stored evaluation failed validation.");
  }
  return { evaluation: evaluation.data, snapshot: snapshot.data };
}

function fail(error: { code?: string; message: string }): never {
  if (error.code === "23505") throw new EvaluationConflictError();
  if (error.code === "23503") throw new RepositoryError("not_found", "Checkpoint does not exist.");
  throw new RepositoryError("db_error", error.message);
}

/** Supabase-backed store. The AI output is inserted once and never rewritten. */
export const evaluationStore: EvaluationStore = {
  async getByCheckpoint(checkpointId) {
    const { data, error } = await getSupabase()
      .from("evaluations")
      .select(COLUMNS)
      .eq("checkpoint_id", checkpointId)
      .maybeSingle();
    if (error) fail(error);
    return data ? toStored(data) : null;
  },

  async insert(evaluation) {
    const { suggestedScore, ...result } = evaluation.result;
    const { data, error } = await getSupabase()
      .from("evaluations")
      .insert({
        project_id: evaluation.projectId,
        checkpoint_id: evaluation.checkpointId,
        week_number: evaluation.weekNumber,
        suggested_score: suggestedScore,
        result,
        snapshot: evaluation.snapshot,
        model: evaluation.model,
      })
      .select(COLUMNS)
      .single();
    if (error) fail(error);
    return toStored(data);
  },

  async listStatuses(projectId) {
    const { data, error } = await getSupabase()
      .from("evaluations")
      .select("week_number, status")
      .eq("project_id", projectId)
      .order("week_number", { ascending: true });
    if (error) fail(error);
    return z
      .array(z.object({ week_number: z.number(), status: z.enum(EVALUATION_STATUSES) }))
      .parse(data ?? [])
      .map((row) => ({ weekNumber: row.week_number, status: row.status }));
  },
};
