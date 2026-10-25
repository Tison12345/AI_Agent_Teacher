import { errorResponse } from "@/lib/api/errors";
import { reviewStore } from "@/lib/review/repository";
import { reviewErrorResponse } from "@/lib/review/http";
import { EVALUATION_STATUSES } from "@/lib/schemas/evaluation";

const FILTERS = [...EVALUATION_STATUSES, "all"] as const;

/**
 * The faculty review queue. It carries the AI's suggested scores, so it must be
 * restricted to teachers once login and permissions exist (all /api/faculty routes).
 */
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") ?? "pending_review";
  if (!(FILTERS as readonly string[]).includes(status)) {
    return errorResponse(400, "invalid_status", `Status must be one of: ${FILTERS.join(", ")}.`);
  }
  try {
    const evaluations = await reviewStore.list(status as (typeof FILTERS)[number]);
    return Response.json({ evaluations });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
