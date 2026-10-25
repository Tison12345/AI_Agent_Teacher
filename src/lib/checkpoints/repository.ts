import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/db/supabase";
import { RepositoryError } from "@/lib/projects/repository";
import {
  BaselineSchema,
  CheckpointSchema,
  type Baseline,
  type Checkpoint,
} from "@/lib/schemas/checkpoint";
import { StoreConflictError, type CheckpointStore } from "./service";

const BASELINE_COLUMNS = "project_id, commit_sha, branch, recorded_at";
const CHECKPOINT_COLUMNS =
  "id, project_id, week_number, commit_sha, base_commit_sha, branch, files_changed, additions, deletions, recorded_at";

const BaselineRow = z.object({
  project_id: z.string(),
  commit_sha: z.string(),
  branch: z.string(),
  recorded_at: z.string(),
});

const CheckpointRow = z.object({
  id: z.string(),
  project_id: z.string(),
  week_number: z.number(),
  commit_sha: z.string(),
  base_commit_sha: z.string(),
  branch: z.string(),
  files_changed: z.number(),
  additions: z.number(),
  deletions: z.number(),
  recorded_at: z.string(),
});

function invalid(): never {
  throw new RepositoryError("invalid_data", "Stored record failed validation.");
}

function toBaseline(row: unknown): Baseline {
  const r = BaselineRow.safeParse(row);
  if (!r.success) invalid();
  const parsed = BaselineSchema.safeParse({
    projectId: r.data.project_id,
    commitSha: r.data.commit_sha,
    branch: r.data.branch,
    recordedAt: r.data.recorded_at,
  });
  return parsed.success ? parsed.data : invalid();
}

function toCheckpoint(row: unknown): Checkpoint {
  const r = CheckpointRow.safeParse(row);
  if (!r.success) invalid();
  const parsed = CheckpointSchema.safeParse({
    id: r.data.id,
    projectId: r.data.project_id,
    weekNumber: r.data.week_number,
    commitSha: r.data.commit_sha,
    baseCommitSha: r.data.base_commit_sha,
    branch: r.data.branch,
    filesChanged: r.data.files_changed,
    additions: r.data.additions,
    deletions: r.data.deletions,
    recordedAt: r.data.recorded_at,
  });
  return parsed.success ? parsed.data : invalid();
}

type DbError = { code?: string; message: string };

function fail(error: DbError): never {
  if (error.code === "23505") throw new StoreConflictError(); // unique violation
  if (error.code === "23503") throw new RepositoryError("not_found", "Project does not exist.");
  throw new RepositoryError("db_error", error.message);
}

/** Supabase-backed store. Rows are only ever inserted, never updated. */
export const checkpointStore: CheckpointStore = {
  async getBaseline(projectId) {
    const { data, error } = await getSupabase()
      .from("project_baselines")
      .select(BASELINE_COLUMNS)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) fail(error);
    return data ? toBaseline(data) : null;
  },

  async insertBaseline(baseline) {
    const { data, error } = await getSupabase()
      .from("project_baselines")
      .insert({
        project_id: baseline.projectId,
        commit_sha: baseline.commitSha,
        branch: baseline.branch,
      })
      .select(BASELINE_COLUMNS)
      .single();
    if (error) fail(error);
    return toBaseline(data);
  },

  async getCheckpoint(projectId, weekNumber) {
    const { data, error } = await getSupabase()
      .from("weekly_checkpoints")
      .select(CHECKPOINT_COLUMNS)
      .eq("project_id", projectId)
      .eq("week_number", weekNumber)
      .maybeSingle();
    if (error) fail(error);
    return data ? toCheckpoint(data) : null;
  },

  async listCheckpoints(projectId) {
    const { data, error } = await getSupabase()
      .from("weekly_checkpoints")
      .select(CHECKPOINT_COLUMNS)
      .eq("project_id", projectId)
      .order("week_number", { ascending: true });
    if (error) fail(error);
    return (data ?? []).map(toCheckpoint);
  },

  async insertCheckpoint(checkpoint) {
    const { data, error } = await getSupabase()
      .from("weekly_checkpoints")
      .insert({
        project_id: checkpoint.projectId,
        week_number: checkpoint.weekNumber,
        commit_sha: checkpoint.commitSha,
        base_commit_sha: checkpoint.baseCommitSha,
        branch: checkpoint.branch,
        files_changed: checkpoint.filesChanged,
        additions: checkpoint.additions,
        deletions: checkpoint.deletions,
      })
      .select(CHECKPOINT_COLUMNS)
      .single();
    if (error) fail(error);
    return toCheckpoint(data);
  },
};
