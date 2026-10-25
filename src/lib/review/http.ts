import "server-only";
import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { RepositoryError } from "@/lib/projects/repository";
import { ReviewError, type ReviewErrorCode } from "./service";

const STATUS: Record<ReviewErrorCode, number> = {
  not_found: 404,
  already_decided: 409,
  unchanged_edit: 422,
};

export function reviewErrorResponse(error: unknown): Response {
  if (error instanceof ReviewError) return errorResponse(STATUS[error.code], error.code, error.message);
  if (error instanceof RepositoryError && error.code === "invalid_data") {
    console.error("[api] stored review data is invalid", error.message);
  }
  return handleUnexpected(error);
}

/** Returns an error response for a path id that is not a UUID, or null when it is fine. */
export function invalidIdResponse(id: string, what: string): Response | null {
  return z.uuid().safeParse(id).success ? null : errorResponse(400, "invalid_id", `${what} id must be a valid UUID.`);
}
