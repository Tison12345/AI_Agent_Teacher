import "server-only";
import { z } from "zod";
import { getSupabase } from "@/lib/db/supabase";
import { ProjectSchema, type Project } from "@/lib/schemas/project";
import type { ProjectFormValues } from "@/lib/validation/project";

export class RepositoryError extends Error {
  constructor(
    readonly code: "db_error" | "invalid_data",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

const COLUMNS = "id, title, description, repo_url, duration_weeks, created_at";

const RowSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  repo_url: z.string(),
  duration_weeks: z.number(),
  created_at: z.string(),
});

function toProject(row: unknown): Project {
  const parsed = RowSchema.safeParse(row);
  if (!parsed.success) {
    throw new RepositoryError("invalid_data", "Unexpected row shape from database.");
  }
  const r = parsed.data;
  const project = ProjectSchema.safeParse({
    id: r.id,
    title: r.title,
    description: r.description,
    repoUrl: r.repo_url,
    durationWeeks: r.duration_weeks,
    createdAt: r.created_at,
  });
  if (!project.success) {
    throw new RepositoryError("invalid_data", "Stored project failed validation.");
  }
  return project.data;
}

export async function createProject(input: ProjectFormValues): Promise<Project> {
  const { data, error } = await getSupabase()
    .from("projects")
    .insert({
      title: input.title,
      description: input.description,
      repo_url: input.repoUrl,
      duration_weeks: input.durationWeeks,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new RepositoryError("db_error", error.message);
  return toProject(data);
}

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await getSupabase()
    .from("projects")
    .select(COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new RepositoryError("db_error", error.message);
  return (data ?? []).map(toProject);
}

/** Returns null when no project has this id. */
export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await getSupabase()
    .from("projects")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new RepositoryError("db_error", error.message);
  return data ? toProject(data) : null;
}
