import { errorResponse } from "@/lib/api/errors";
import { invalidIdResponse, reviewErrorResponse } from "@/lib/review/http";
import { reviewStore } from "@/lib/review/repository";
import { submitDecision } from "@/lib/review/service";
import { DecisionRequestSchema } from "@/lib/schemas/review";

/**
 * Records the teacher's official decision on an AI evaluation. A decision is final.
 * Teachers only once login exists: until then this endpoint is open.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/faculty/evaluations/[id]/decision">) {
  const { id } = await ctx.params;
  const invalid = invalidIdResponse(id, "Evaluation");
  if (invalid) return invalid;

  const body: unknown = await request.json().catch(() => null);
  const parsed = DecisionRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "decision"] ??= issue.message;
    return errorResponse(400, "invalid_decision", "The decision is not valid.", fields);
  }
  try {
    const decision = await submitDecision(id, parsed.data, reviewStore);
    return Response.json({ decision }, { status: 201 });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
