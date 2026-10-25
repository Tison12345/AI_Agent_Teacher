import "server-only";
import { ApiError } from "@google/genai";
import { z } from "zod";
import { GeminiError } from "./errors";

// Size/range limits make Gemini reject the schema ("too many states for serving").
// Gemini only gets the structure; our Zod schemas enforce every limit afterwards.
const CONSTRAINT_KEYS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "pattern",
  "format",
]);

function stripConstraints(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripConstraints);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !CONSTRAINT_KEYS.has(key))
        .map(([key, value]) => [key, stripConstraints(value)]),
    );
  }
  return node;
}

/** JSON Schema for Gemini's structured output: structure only, no size limits. */
export function structuredSchema(schema: z.ZodType): unknown {
  return stripConstraints(z.toJSONSchema(schema, { target: "draft-7", io: "input" }));
}

export function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(unfenced);
}

export function toGeminiError(error: unknown): GeminiError {
  if (error instanceof GeminiError) return error;
  if (error instanceof ApiError) {
    console.error("[gemini] API error, status", error.status);
    if (error.status === 429) {
      // Google names the exhausted quota in the message; a per-day quota will not clear in a minute.
      return new GeminiError(/per.?day/i.test(error.message) ? "quota_exhausted" : "rate_limited");
    }
    if (error.status === 408 || error.status === 504) return new GeminiError("timeout");
    if (error.status >= 500) return new GeminiError("unavailable");
    return new GeminiError("rejected");
  }
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  console.error("[gemini] request failed:", name, message.slice(0, 200));
  if (/abort|timeout|timed out/i.test(`${name} ${message}`)) {
    return new GeminiError("timeout");
  }
  return new GeminiError("unavailable");
}

/** Short, model-readable list of validation problems, used to ask for a corrected answer. */
export function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * JSON for embedding untrusted text inside a tagged prompt block. JSON.stringify
 * escapes quotes and newlines but not angle brackets, so a fake closing tag in
 * student text would appear literally. Escaping < and > keeps the real tags unique,
 * and the result is still valid JSON that decodes to exactly the same text.
 */
export function jsonForPrompt(value: unknown): string {
  const backslash = String.fromCharCode(92); // a backslash character; the replacements below produce JSON unicode escapes
  return JSON.stringify(value)
    .replace(/</g, `${backslash}u003c`)
    .replace(/>/g, `${backslash}u003e`);
}
