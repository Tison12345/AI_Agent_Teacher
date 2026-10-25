import "server-only";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { CheckpointError, type CheckpointErrorCode } from "./service";

const STATUS: Record<CheckpointErrorCode, number> = {
  invalid_week: 400,
  baseline_required: 409,
  baseline_exists: 409,
  previous_week_required: 409,
  already_recorded: 409,
  no_new_commits: 409,
  empty_diff: 409,
  history_changed: 409,
};

/** Turns service errors into precise responses; everything else gets the generic handler. */
export function checkpointErrorResponse(error: unknown): Response {
  if (!(error instanceof CheckpointError)) return handleUnexpected(error);
  if (error.code === "already_recorded" && error.existing) {
    // Include the winning checkpoint so the UI can show it instead of an error.
    return Response.json(
      {
        error: { code: error.code, message: error.message },
        checkpoint: error.existing,
      },
      { status: 409 },
    );
  }
  return errorResponse(STATUS[error.code], error.code, error.message);
}
