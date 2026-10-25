import "server-only";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { EvaluationError, type EvaluationErrorCode } from "./service";

const STATUS: Record<EvaluationErrorCode, number> = {
  checkpoint_required: 409,
  plan_required: 409,
  evaluation_exists: 409,
};

export function evaluationErrorResponse(error: unknown): Response {
  if (!(error instanceof EvaluationError)) return handleUnexpected(error);
  if (error.code === "evaluation_exists") {
    // Say that it exists (so the UI can show its status) but never include the score.
    return Response.json(
      { error: { code: error.code, message: error.message }, status: error.existingStatus ?? null },
      { status: 409 },
    );
  }
  return errorResponse(STATUS[error.code], error.code, error.message);
}
