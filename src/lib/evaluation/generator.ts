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
const MAX_ATTEMPTS = 2;

/**
 * Asks Gemini to review one week's code changes, then checks the answer against
 * the plan and the real diff. Invalid answers get one corrected retry; they are
 * never accepted or repaired silently.
 */
export async function generateEvaluation(
  input: PromptInput,
  deps: { client: GeminiClient; model: string },
): Promise<AssembledEvaluation> {
  let issues: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let text: string | undefined;
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
        },
      });
      text = response.text;
    } catch (error) {
      throw toGeminiError(error);
    }

    if (!text?.trim()) {
      issues = "The response was empty.";
      continue;
    }
    let json: unknown;
    try {
      json = parseModelJson(text);
    } catch {
      issues = "The response was not valid JSON.";
      continue;
    }
    const parsed = ModelEvaluationSchema.safeParse(json);
    if (!parsed.success) {
      issues = summarizeIssues(parsed.error);
      console.error("[evaluation] output failed schema (attempt", attempt, "):", issues);
      continue;
    }
    const assembled = assembleEvaluation(parsed.data, {
      criteria: input.week.evaluationCriteria,
      snapshot: input.snapshot,
    });
    if (assembled.ok) return assembled.value;
    issues = assembled.issues.slice(0, 6).join("; ");
    console.error("[evaluation] output failed checks (attempt", attempt, "):", issues);
  }

  throw new GeminiError("invalid_response");
}
