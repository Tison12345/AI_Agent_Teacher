import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { SubmissionError } from "./service";

/** Maps a submission problem to a response; anything else falls through to the shared handler. */
export function submissionErrorResponse(error: unknown): Response {
  if (error instanceof SubmissionError) {
    return error.code === "not_found"
      ? errorResponse(404, "not_found", error.message)
      : errorResponse(409, error.code, error.message);
  }
  return handleUnexpected(error);
}
