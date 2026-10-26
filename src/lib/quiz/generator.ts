import "server-only";
import type { GeminiClient } from "@/lib/gemini/client";
import { GeminiError } from "@/lib/gemini/errors";
import { parseModelJson, structuredSchema, summarizeIssues, toGeminiError } from "@/lib/gemini/shared";
import type { QuizQuestion } from "@/lib/schemas/quiz";
import { assembleQuiz, ModelQuizSchema, type RandomInt } from "./assemble";
import { buildQuizPrompt, SYSTEM_INSTRUCTION, type QuizPromptInput } from "./prompt";

const REQUEST_TIMEOUT_MS = 55_000;
const MAX_ATTEMPTS = 2;

/**
 * Asks Gemini for the week's multiple-choice questions, then checks them and shuffles
 * the options. Invalid answers get one corrected retry; they are never accepted or
 * repaired silently.
 */
export async function generateQuizQuestions(
  input: QuizPromptInput,
  deps: { client: GeminiClient; model: string; random?: RandomInt },
): Promise<QuizQuestion[]> {
  let issues: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let text: string | undefined;
    try {
      const response = await deps.client.models.generateContent({
        model: deps.model,
        contents: buildQuizPrompt(input, issues),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: structuredSchema(ModelQuizSchema),
          temperature: 0.4,
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
    const parsed = ModelQuizSchema.safeParse(json);
    if (!parsed.success) {
      issues = summarizeIssues(parsed.error);
      console.error("[quiz] output failed schema (attempt", attempt, "):", issues);
      continue;
    }
    const assembled = assembleQuiz(parsed.data, deps.random);
    if (assembled.ok) return assembled.value;
    issues = assembled.issues.slice(0, 6).join("; ");
    console.error("[quiz] output failed checks (attempt", attempt, "):", issues);
  }

  throw new GeminiError("invalid_response");
}
