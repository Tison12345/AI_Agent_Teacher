import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/db/supabase";
import { RepositoryError } from "@/lib/projects/repository";
import {
  WeeklyPlanSchema,
  type StoredPlan,
  type WeeklyPlan,
} from "@/lib/schemas/weekly-plan";

const RowSchema = z.object({
  project_id: z.string(),
  plan: z.unknown(),
  model: z.string(),
  generated_at: z.string(),
});

const COLUMNS = "project_id, plan, model, generated_at";

function toStoredPlan(row: unknown): StoredPlan {
  const parsed = RowSchema.safeParse(row);
  const plan = parsed.success ? WeeklyPlanSchema.safeParse(parsed.data.plan) : null;
  if (!parsed.success || !plan?.success) {
    throw new RepositoryError("invalid_data", "Stored plan failed validation.");
  }
  return {
    projectId: parsed.data.project_id,
    plan: plan.data,
    model: parsed.data.model,
    generatedAt: parsed.data.generated_at,
  };
}

/** Returns null when no plan has been generated yet. */
export async function getPlan(projectId: string): Promise<StoredPlan | null> {
  const { data, error } = await getSupabase()
    .from("weekly_plans")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new RepositoryError("db_error", error.message);
  return data ? toStoredPlan(data) : null;
}

/** Saves a plan once per project; never overwrites an existing one (conflict). */
export async function savePlan(
  projectId: string,
  plan: WeeklyPlan,
  model: string,
): Promise<StoredPlan> {
  const { data, error } = await getSupabase()
    .from("weekly_plans")
    .insert({ project_id: projectId, plan, model })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new RepositoryError("conflict", "A plan already exists for this project.");
    }
    if (error.code === "23503") {
      throw new RepositoryError("not_found", "Project does not exist.");
    }
    throw new RepositoryError("db_error", error.message);
  }
  return toStoredPlan(data);
}
