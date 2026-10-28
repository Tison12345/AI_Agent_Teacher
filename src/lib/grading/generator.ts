import "server-only";
import type { GeminiClient } from "@/lib/gemini/client";
import { GeminiError } from "@/lib/gemini/errors";
import { parseModelJson, structuredSchema, summarizeIssues, toGeminiError } from "@/lib/gemini/shared";
import type { AiResult } from "@/lib/schemas/submission";
import { assembleGrading, ModelGradingSchema } from "./assemble";
import { buildGradingPrompt, MAX_ANSWER_CHARS, SYSTEM_INSTRUCTION, type GradingPromptInput } from "./prompt";

const REQUEST_TIMEOUT_MS = 55_000;
/** Gemini is asked at most this many times: the first answer, and one corrected retry if it did not pass the checks. */
export const MAX_ATTEMPTS = 2;

/** The answer is cut to MAX_ANSWER_CHARS before it is sent and before the quotes are checked against it. */
function preparedInput(input: GradingPromptInput): { prompted: GradingPromptInput; cut: boolean } {
  const cut = input.answerText.length > MAX_ANSWER_CHARS;
  return { prompted: cut ? { ...input, answerText: input.answerText.slice(0, MAX_ANSWER_CHARS) } : input, cut };
}

/**
 * One request to Gemini. Returns the raw text (possibly empty). Network and API problems are thrown as GeminiError.
 * `issues` are the problems found in the previous answer, so the model can correct them.
 */
export async function requestGrading(
  input: GradingPromptInput,
  issues: string | undefined,
  deps: { client: GeminiClient; model: string; signal?: AbortSignal },
): Promise<string | undefined> {
  const { prompted } = preparedInput(input);
  try {
    const response = await deps.client.models.generateContent({
      model: deps.model,
      contents: buildGradingPrompt(prompted, issues),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseJsonSchema: structuredSchema(ModelGradingSchema),
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

export type GradingCheck = { ok: true; value: AiResult } | { ok: false; issues: string };

/** Checks Gemini's raw answer against the assignment and the student's real text. Never repairs anything silently. */
export function checkGrading(raw: string | undefined, input: GradingPromptInput, attempt: number): GradingCheck {
  const { prompted, cut } = preparedInput(input);
  if (!raw?.trim()) return { ok: false, issues: "The response was empty." };
  let json: unknown;
  try {
    json = parseModelJson(raw);
  } catch {
    return { ok: false, issues: "The response was not valid JSON." };
  }
  const parsed = ModelGradingSchema.safeParse(json);
  if (!parsed.success) {
    const issues = summarizeIssues(parsed.error);
    console.error("[grading] output failed schema (attempt", attempt, "):", issues);
    return { ok: false, issues };
  }
  const assembled = assembleGrading(parsed.data, { questions: input.questions, answerText: prompted.answerText });
  if (assembled.ok) {
    const notes = cut ? [`The answer was longer than ${MAX_ANSWER_CHARS.toLocaleString()} characters; only the first part was marked.`] : [];
    return { ok: true, value: { ...assembled.value, notes } };
  }
  const issues = assembled.issues.slice(0, 6).join("; ");
  console.error("[grading] output failed checks (attempt", attempt, "):", issues);
  return { ok: false, issues };
}

/**
 * Asks Gemini to mark one submission, then checks the answer. Invalid answers get one corrected retry; they are
 * never accepted or repaired silently. (The assignment workflow graph runs the same two steps as separate nodes.)
 */
export async function generateGrading(input: GradingPromptInput, deps: { client: GeminiClient; model: string }): Promise<AiResult> {
  let issues: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await requestGrading(input, issues, deps);
    const checked = checkGrading(raw, input, attempt);
    if (checked.ok) return checked.value;
    issues = checked.issues;
  }
  throw new GeminiError("invalid_response");
}
