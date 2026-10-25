import "server-only";
import { StorageConfigError } from "@/lib/db/supabase";
import { GeminiError, type GeminiErrorCode } from "@/lib/gemini/errors";

export type ApiErrorBody = {
  error: { code: string; message: string; fields?: Record<string, string> };
};

export function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response {
  const body: ApiErrorBody = { error: { code, message, fields } };
  return Response.json(body, { status });
}

const GEMINI_STATUS: Record<GeminiErrorCode, number> = {
  not_configured: 503,
  rate_limited: 429,
  rejected: 502,
  unavailable: 502,
  timeout: 504,
  invalid_response: 502,
};

/** Maps unexpected failures to safe responses; details are logged, never returned. */
export function handleUnexpected(error: unknown): Response {
  if (error instanceof StorageConfigError) {
    console.error("[api] storage not configured");
    return errorResponse(503, "storage_unavailable", "Storage is not configured on the server.");
  }
  if (error instanceof GeminiError) {
    return errorResponse(GEMINI_STATUS[error.code], `gemini_${error.code}`, error.message);
  }
  console.error("[api] unexpected error", error);
  return errorResponse(500, "internal_error", "Something went wrong. Please try again.");
}
