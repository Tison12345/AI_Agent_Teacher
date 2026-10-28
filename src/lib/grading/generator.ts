import "server-only";
import type { GeminiClient } from "@/lib/gemini/client";
import { GeminiError } from "@/lib/gemini/errors";
import { parseModelJson, structuredSchema, summarizeIssues, toGeminiError } from "@/lib/gemini/shared";
import type { AiResult } from "@/lib/schemas/submission";
import { assembleGrading, ModelGradingSchema } from "./assemble";
import { buildGradingPrompt, MAX_ANSWER_CHARS, SYSTEM_INSTRUCTION, type GradingPromptInput } from "./prompt";

const REQUEST_TIMEOUT_MS = 55_000;
const MAX_ATTEMPTS = 2;

/**
 * Asks Gemini to mark one submission, then checks the answer against the assignment and the student's real
 * text. Invalid answers get one corrected retry; they are never accepted or repaired silently.
 */
export async function generateGrading(input: GradingPromptInput, deps: { client: GeminiClient; model: string }): Promise<AiResult> {
  const cut = input.answerText.length > MAX_ANSWER_CHARS;
  const answerText = cut ? input.answerText.slice(0, MAX_ANSWER_CHARS) : input.answerText;
  const prompted = { ...input, answerText };
  let issues: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string | undefined;
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
        },
      });
      raw = response.text;
    } catch (error) {
      throw toGeminiError(error);
    }

    if (!raw?.trim()) {
      issues = "The response was empty.";
      continue;
    }
    let json: unknown;
    try {
      json = parseModelJson(raw);
    } catch {
      issues = "The response was not valid JSON.";
      continue;
    }
    const parsed = ModelGradingSchema.safeParse(json);
    if (!parsed.success) {
      issues = summarizeIssues(parsed.error);
      console.error("[grading] output failed schema (attempt", attempt, "):", issues);
      continue;
    }
    const assembled = assembleGrading(parsed.data, { questions: input.questions, answerText });
    if (assembled.ok) {
      const notes = cut ? [`The answer was longer than ${MAX_ANSWER_CHARS.toLocaleString()} characters; only the first part was marked.`] : [];
      return { ...assembled.value, notes };
    }
    issues = assembled.issues.slice(0, 6).join("; ");
    console.error("[grading] output failed checks (attempt", attempt, "):", issues);
  }

  throw new GeminiError("invalid_response");
}
