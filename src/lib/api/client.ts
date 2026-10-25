import { z } from "zod";
import type { ProjectSubmitResult } from "@/components/ProjectForm";
import { ProjectSchema, type Project } from "@/lib/schemas/project";
import {
  BaselineSchema,
  CheckpointSchema,
  ProgressSchema,
  type Baseline,
  type Checkpoint,
  type Progress,
} from "@/lib/schemas/checkpoint";
import { RepoInfoSchema, type RepoInfo } from "@/lib/schemas/repo-info";
import {
  QueueItemSchema,
  ReviewDetailSchema,
  StudentResultSchema,
  type DecisionRequest,
  type QueueItem,
  type ReviewDetail,
  type StudentResult,
} from "@/lib/schemas/review";
import { TeacherDecisionSchema, type TeacherDecision } from "@/lib/schemas/teacher-decision";
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

/** Asks the server to look at the project's GitHub repository (read-only). */
export async function fetchRepoInfo(projectId: string): Promise<RepoInfo> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/repo`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readError(res));
  return RepoInfoSchema.parse(await res.json());
}

export async function fetchProgress(projectId: string): Promise<Progress> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/progress`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readError(res));
  return ProgressSchema.parse(await res.json());
}

export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; existing?: Checkpoint };

/** Records the starting point (once). */
export async function recordBaseline(projectId: string): Promise<ActionResult<Baseline>> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/baseline`, {
    method: "POST",
  });
  if (!res.ok) return { ok: false, message: await readError(res) };
  const body = z.object({ baseline: BaselineSchema }).parse(await res.json());
  return { ok: true, value: body.baseline };
}

/** "Complete Week": records the latest pushed commit as this week's checkpoint. */
export async function completeWeek(
  projectId: string,
  weekNumber: number,
): Promise<ActionResult<Checkpoint>> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/weeks/${weekNumber}/complete`,
    { method: "POST" },
  );
  if (res.ok) {
    const body = z.object({ checkpoint: CheckpointSchema }).parse(await res.json());
    return { ok: true, value: body.checkpoint };
  }
  const body: unknown = await res.json().catch(() => null);
  const parsed = z
    .object({
      error: z.object({ message: z.string() }),
      checkpoint: CheckpointSchema.optional(),
    })
    .safeParse(body);
  return parsed.success
    ? { ok: false, message: parsed.data.error.message, existing: parsed.data.checkpoint }
    : { ok: false, message: `Request failed (${res.status}).` };
}

export type EvaluationStatus = "pending_review" | "approved" | "edited" | "rejected";
export type EvaluationRequestResult =
  | { ok: true; status: EvaluationStatus }
  /** `status` is set when an evaluation already exists (the request changed nothing). */
  | { ok: false; message: string; status?: EvaluationStatus };

/**
 * Asks the server to evaluate a recorded week (can take up to a minute). The reply
 * carries the status only: the AI's score is never sent to the student's browser.
 */
export async function requestEvaluation(
  projectId: string,
  weekNumber: number,
): Promise<EvaluationRequestResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/weeks/${weekNumber}/evaluate`,
    { method: "POST" },
  );
  if (res.ok) {
    const body = z
      .object({ evaluation: z.object({ status: z.enum(["pending_review", "approved", "edited", "rejected"]) }) })
      .parse(await res.json());
    return { ok: true, status: body.evaluation.status };
  }
  const body: unknown = await res.json().catch(() => null);
  const parsed = z
    .object({
      error: z.object({ message: z.string() }),
      status: z.enum(["pending_review", "approved", "edited", "rejected"]).nullable().optional(),
    })
    .safeParse(body);
  return parsed.success
    ? { ok: false, message: parsed.data.error.message, status: parsed.data.status ?? undefined }
    : { ok: false, message: `Request failed (${res.status}).` };
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
      durationWeeks: values.durationWeeks,
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

/** Student-safe: only the official outcomes a teacher has decided. */
export async function fetchResults(projectId: string): Promise<StudentResult[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/results`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return z.object({ results: z.array(StudentResultSchema) }).parse(await res.json()).results;
}

export type QueueFilter = "pending_review" | "approved" | "edited" | "rejected" | "all";

/** Faculty: the review queue (carries the AI suggestions). */
export async function fetchQueue(status: QueueFilter): Promise<QueueItem[]> {
  const res = await fetch(`/api/faculty/evaluations?status=${status}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return z.object({ evaluations: z.array(QueueItemSchema) }).parse(await res.json()).evaluations;
}

/** Faculty: one evaluation with the diff the AI saw. Null when it does not exist. */
export async function fetchReview(evaluationId: string): Promise<ReviewDetail | null> {
  const res = await fetch(`/api/faculty/evaluations/${encodeURIComponent(evaluationId)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readError(res));
  return ReviewDetailSchema.parse(await res.json());
}

export type DecisionResult =
  | { ok: true; decision: TeacherDecision }
  | { ok: false; message: string; fields?: Record<string, string> };

/** Faculty: records the official decision. It is final. */
export async function sendDecision(evaluationId: string, request: DecisionRequest): Promise<DecisionResult> {
  const res = await fetch(`/api/faculty/evaluations/${encodeURIComponent(evaluationId)}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (res.ok) {
    return { ok: true, decision: z.object({ decision: TeacherDecisionSchema }).parse(await res.json()).decision };
  }
  const parsed = ErrorBodySchema.safeParse(await res.json().catch(() => null));
  return parsed.success
    ? { ok: false, message: parsed.data.error.message, fields: parsed.data.error.fields }
    : { ok: false, message: `Request failed (${res.status}).` };
}
