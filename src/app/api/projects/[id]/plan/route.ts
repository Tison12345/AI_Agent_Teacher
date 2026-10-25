import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { getGeminiClient, getGeminiModel } from "@/lib/gemini/client";
import { generateWeeklyPlan } from "@/lib/gemini/plan-generator";
import { getPlan, savePlan } from "@/lib/plans/repository";
import { getProject, RepositoryError } from "@/lib/projects/repository";

// Plan generation can take a while; allow up to 60s on hosts that honour this.
export const maxDuration = 60;

type Ctx = RouteContext<"/api/projects/[id]/plan">;

async function readProjectId(ctx: Ctx): Promise<string | Response> {
  const { id } = await ctx.params;
  return z.uuid().safeParse(id).success
    ? id
    : errorResponse(400, "invalid_id", "Project id must be a valid UUID.");
}

export async function GET(_request: Request, ctx: Ctx) {
  const id = await readProjectId(ctx);
  if (id instanceof Response) return id;
  try {
    if (!(await getProject(id))) {
      return errorResponse(404, "not_found", "Project not found.");
    }
    return Response.json({ plan: await getPlan(id) });
  } catch (error) {
    return handleUnexpected(error);
  }
}

export async function POST(_request: Request, ctx: Ctx) {
  const id = await readProjectId(ctx);
  if (id instanceof Response) return id;
  try {
    const project = await getProject(id);
    if (!project) return errorResponse(404, "not_found", "Project not found.");
    if (await getPlan(id)) {
      return errorResponse(409, "plan_exists", "This project already has a plan.");
    }

    // Fail fast with a clear message before spending an API call.
    const client = getGeminiClient();
    const model = getGeminiModel();
    const plan = await generateWeeklyPlan(project, { client, model });
    const stored = await savePlan(id, plan, model);
    return Response.json({ plan: stored }, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError && error.code === "conflict") {
      return errorResponse(409, "plan_exists", "This project already has a plan.");
    }
    return handleUnexpected(error);
  }
}
