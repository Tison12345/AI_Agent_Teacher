import "server-only";
import { z } from "zod";
import { ExtractionInfoSchema } from "@/lib/schemas/submission";
import type { UploadType } from "./file";

export type ExtractorErrorCode = "not_configured" | "unavailable" | "timeout" | "rejected" | "invalid_response";

/** `userMessage` is written by us and safe to show to a student. Raw details are only logged. */
export class ExtractorError extends Error {
  constructor(
    readonly code: ExtractorErrorCode,
    readonly userMessage: string,
  ) {
    super(userMessage);
    this.name = "ExtractorError";
  }
}

const ResultSchema = ExtractionInfoSchema.extend({ text: z.string() });
export type Extraction = z.infer<typeof ResultSchema>;

const ServiceErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const TIMEOUT_MS = 30_000;
const DEFAULT_URL = "http://127.0.0.1:8001";

export type ExtractorConfig = { url: string; key: string };

/** The local text-extraction service. Both values are server-only. */
export function getExtractorConfig(env: NodeJS.ProcessEnv = process.env): ExtractorConfig {
  const key = env.EXTRACTOR_KEY?.trim();
  if (!key) throw new ExtractorError("not_configured", "The text-reading service is not set up.");
  return { url: (env.EXTRACTOR_URL?.trim() || DEFAULT_URL).replace(/\/+$/, ""), key };
}

/** Sends the file's bytes to the Python service and returns the text it read. */
export async function extractText(
  bytes: Uint8Array,
  type: UploadType,
  deps: { config?: ExtractorConfig; fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<Extraction> {
  const config = deps.config ?? getExtractorConfig();
  const doFetch = deps.fetch ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`${config.url}/extract?type=${type}`, {
      method: "POST",
      headers: { "X-Extractor-Key": config.key, "Content-Type": "application/octet-stream" },
      body: bytes as unknown as BodyInit,
      signal: deps.signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), deps.signal]) : AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error("[extractor] request failed:", error instanceof Error ? error.name : "unknown");
    throw timedOut
      ? new ExtractorError("timeout", "Reading your file took too long. Please try again.")
      : new ExtractorError("unavailable", "The text-reading service is not running. Please try again in a moment.");
  }

  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = ResultSchema.safeParse(body);
    if (!parsed.success) {
      console.error("[extractor] unexpected response shape");
      throw new ExtractorError("invalid_response", "The text-reading service gave an unexpected answer.");
    }
    return parsed.data;
  }

  // 422 is a problem with the file itself (corrupt, encrypted ...): the service's message is meant for the student.
  const serviceError = ServiceErrorSchema.safeParse(body);
  if (response.status === 422 && serviceError.success) {
    throw new ExtractorError("rejected", serviceError.data.error.message);
  }
  console.error("[extractor] service answered", response.status);
  throw new ExtractorError(
    response.status === 503 || response.status === 401 ? "not_configured" : "unavailable",
    response.status === 413
      ? "The file is larger than 4 MB."
      : "The text-reading service could not read your file. Please try again.",
  );
}
