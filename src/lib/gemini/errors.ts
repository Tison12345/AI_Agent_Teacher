export type GeminiErrorCode =
  | "not_configured"
  | "rate_limited"
  | "quota_exhausted"
  | "rejected"
  | "unavailable"
  | "timeout"
  | "invalid_response";

/** Safe-to-show messages; raw upstream details are only ever logged server-side. */
const MESSAGES: Record<GeminiErrorCode, string> = {
  not_configured: "Gemini is not configured on the server.",
  rate_limited: "Gemini is rate limiting requests. Please wait a minute and try again.",
  quota_exhausted:
    "Gemini's daily free limit for the server's API key has been used up. Try again tomorrow, or ask the administrator to use another key or enable billing.",
  rejected:
    "Gemini rejected the request. The server's API key or model setting may be wrong.",
  unavailable: "Gemini is temporarily unavailable. Please try again.",
  timeout: "Gemini took too long to respond. Please try again.",
  invalid_response:
    "Gemini returned an answer that did not pass validation. Please try again.",
};

export class GeminiError extends Error {
  constructor(readonly code: GeminiErrorCode) {
    super(MESSAGES[code]);
    this.name = "GeminiError";
  }
}
