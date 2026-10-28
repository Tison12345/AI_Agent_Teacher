import "server-only";
import type { GeminiClient } from "@/lib/gemini/client";
import { GeminiError } from "@/lib/gemini/errors";
import {
  parseModelJson,
  structuredSchema,
  summarizeIssues,
  toGeminiError,
} from "@/lib/gemini/shared";
import {
  assembleEvaluation,
  ModelEvaluationSchema,
  type AssembledEvaluation,
} from "./assemble";
import { buildEvaluationPrompt, SYSTEM_INSTRUCTION, type PromptInput } from "./prompt";

const REQUEST_TIMEOUT_MS = 55_000;
/** Gemini is asked at most this many times: the first answer, and one corrected retry if it did not pass the checks. */
export const MAX_ATTEMPTS = 2;

/**
 * One request to Gemini. Returns the raw text (possibly empty). Network and API problems are thrown as GeminiError.
 * `issues` are the problems found in the previous answer, so the model can correct them.
 */
export async function requestEvaluation(
  input: PromptInput,
  issues: string | undefined,
  deps: { client: GeminiClient; model: string; signal?: AbortSignal },
): Promise<string | undefined> {
  try {
    const response = await deps.client.models.generateContent({
      model: deps.model,
      contents: buildEvaluationPrompt(input, issues),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseJsonSchema: structuredSchema(ModelEvaluationSchema),
        temperature: 0.2,
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
        ...(deps.signal ? { abortSignal: deps.signal } : {}),
      },
    });
    return response.text;
  } catch (error) {
    throw toGeminiError(error);
  }
}

export type EvaluationCheck = { ok: true; value: AssembledEvaluation } | { ok: false; issues: string };

/** Checks Gemini's raw answer against the plan and the real diff. Never repairs anything silently. */
export function checkEvaluation(raw: string | undefined, input: PromptInput, attempt: number): EvaluationCheck {
  if (!raw?.trim()) return { ok: false, issues: "The response was empty." };
  let json: unknown;
  try {
    json = parseModelJson(raw);
  } catch {
    return { ok: false, issues: "The response was not valid JSON." };
  }
  const parsed = ModelEvaluationSchema.safeParse(json);
  if (!parsed.success) {
    const issues = summarizeIssues(parsed.error);
    console.error("[evaluation] output failed schema (attempt", attempt, "):", issues);
    return { ok: false, issues };
  }
  const assembled = assembleEvaluation(parsed.data, {
    criteria: input.week.evaluationCriteria,
    snapshot: input.snapshot,
  });
  if (assembled.ok) return { ok: true, value: assembled.value };
  const issues = assembled.issues.slice(0, 6).join("; ");
  console.error("[evaluation] output failed checks (attempt", attempt, "):", issues);
  return { ok: false, issues };
}

/**
 * Asks Gemini to review one week's code changes, then checks the answer. Invalid answers get one corrected
 * retry; they are never accepted or repaired silently. (The evaluation workflow graph runs the same two steps
 * as separate nodes.)
 */
export async function generateEvaluation(
  input: PromptInput,
  deps: { client: GeminiClient; model: string },
): Promise<AssembledEvaluation> {
  let issues: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await requestEvaluation(input, issues, deps);
    const checked = checkEvaluation(raw, input, attempt);
    if (checked.ok) return checked.value;
    issues = checked.issues;
  }
  throw new GeminiError("invalid_response");
}
