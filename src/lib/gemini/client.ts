import "server-only";
import { GoogleGenAI } from "@google/genai";
import { GeminiError } from "./errors";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/** The slice of the SDK we use; lets tests inject a fake. */
export type GeminiClient = {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }): Promise<{ text?: string }>;
  };
};

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

let client: GoogleGenAI | null = null;

/** Server-only. The API key is read from GEMINI_API_KEY and never leaves the server. */
export function getGeminiClient(): GeminiClient {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new GeminiError("not_configured");
  client ??= new GoogleGenAI({ apiKey });
  return client as unknown as GeminiClient;
}
