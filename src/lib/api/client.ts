import { z } from "zod";
import type { ProjectSubmitResult } from "@/components/ProjectForm";
import { ProjectSchema, type Project } from "@/lib/schemas/project";
import { StoredPlanSchema, type StoredPlan } from "@/lib/schemas/weekly-plan";
import type {
  ProjectFormErrors,
  ProjectFormValues,
} from "@/lib/validation/project";

const ErrorBodySchema = z.object({
  error: z.object({
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
});

async function readError(res: Response): Promise<string> {
  const parsed = ErrorBodySchema.safeParse(await res.json().catch(() => null));
  return parsed.success
    ? parsed.data.error.message
    : `Request failed (${res.status}).`;
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  const body = z
    .object({ projects: z.array(ProjectSchema) })
    .parse(await res.json());
  return body.projects;
}

export async function fetchProject(id: string): Promise<Project | null> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readError(res));
  return z.object({ project: ProjectSchema }).parse(await res.json()).project;
}

export async function fetchPlan(projectId: string): Promise<StoredPlan | null> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/plan`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readError(res));
  return z
    .object({ plan: StoredPlanSchema.nullable() })
    .parse(await res.json()).plan;
}

/** Asks the server to generate and save the plan. Can take up to a minute. */
export async function generatePlan(projectId: string): Promise<StoredPlan> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/plan`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await readError(res));
  return z.object({ plan: StoredPlanSchema }).parse(await res.json()).plan;
}

export async function createProject(
  values: ProjectFormValues,
): Promise<{ result: ProjectSubmitResult; project?: Project }> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: values.title,
      description: values.description,
      repoUrl: values.repoUrl,
    }),
  });
  if (res.ok) {
    const { project } = z
      .object({ project: ProjectSchema })
      .parse(await res.json());
    return { result: { ok: true }, project };
  }
  const parsed = ErrorBodySchema.safeParse(await res.json().catch(() => null));
  const message = parsed.success
    ? parsed.data.error.message
    : `Request failed (${res.status}).`;
  const fields: ProjectFormErrors = {};
  if (parsed.success && parsed.data.error.fields) {
    const f = parsed.data.error.fields;
    if (f.title) fields.title = f.title;
    if (f.description) fields.description = f.description;
    if (f.repoUrl) fields.repoUrl = f.repoUrl;
  }
  return { result: { ok: false, message, fields } };
}
