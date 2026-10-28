import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "@/lib/gemini/errors";
import type { AiResult, SubmissionStatus } from "@/lib/schemas/submission";
import { gradeSubmission, type GradingDeps, type GradingStore, type GradingSubject } from "./service";

const result: AiResult = {
  questions: [{ number: 1, marks: 3, maxMarks: 5, explanation: "Partly.", quotes: ["a loop repeats code"] }],
  feedback: "Good.",
  notes: [],
};

function memory(over: Partial<GradingSubject> | null = {}) {
  const state = {
    row: over === null ? null : ({
      status: "processing" as SubmissionStatus,
      title: "Loops",
      instructions: "Answer.",
      questions: [{ number: 1, text: "What is a loop?", maxMarks: 5, rubric: "Repetition." }],
      referenceAnswers: null,
      extractedText: "a loop repeats code",
      ...over,
    } satisfies GradingSubject),
    saved: null as null | { result: AiResult; model: string },
    failedWith: null as null | string,
    saveWins: true,
  };
  const store: GradingStore = {
    load: vi.fn(async () => state.row),
    saveResult: vi.fn(async (_id, r, model) => {
      if (!state.saveWins) return false;
      state.saved = { result: r, model };
      return true;
    }),
    setFailed: vi.fn(async (_id, reason) => {
      state.failedWith = reason;
    }),
  };
  return { state, store };
}
const deps = (store: GradingStore, generate: GradingDeps["generate"]): GradingDeps => ({ store, generate, model: "test-model" });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("gradeSubmission", () => {
  it("saves the recommendation with the model name, and returns graded", async () => {
    const { state, store } = memory();
    const generate = vi.fn().mockResolvedValue(result);
    expect(await gradeSubmission("s1", deps(store, generate))).toBe("graded");
    expect(state.saved).toEqual({ result, model: "test-model" });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ answerText: "a loop repeats code", title: "Loops" }));
  });

  it("does nothing for a submission that is not processing or has no text (no AI call)", async () => {
    for (const row of [{ status: "needs_ocr" as const }, { status: "awaiting_review" as const }, { status: "approved" as const }, { extractedText: null }]) {
      const { store } = memory(row);
      const generate = vi.fn();
      expect(await gradeSubmission("s1", deps(store, generate))).toBe("skipped");
      expect(generate).not.toHaveBeenCalled();
    }
  });

  it("throws not_found for an unknown submission", async () => {
    const { store } = memory(null);
    await expect(gradeSubmission("nope", deps(store, vi.fn()))).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps the submission as failed, with a safe reason, when Gemini fails", async () => {
    const { state, store } = memory();
    const generate = vi.fn().mockRejectedValue(new GeminiError("rate_limited"));
    expect(await gradeSubmission("s1", deps(store, generate))).toBe("failed");
    expect(state.failedWith).toMatch(/^Marking could not be completed\. Gemini is rate limiting/);
    expect(state.saved).toBeNull();
  });

  it("never stores a raw error message, only a generic sentence", async () => {
    const { state, store } = memory();
    const generate = vi.fn().mockRejectedValue(new Error("secret internal detail key=abc"));
    expect(await gradeSubmission("s1", deps(store, generate))).toBe("failed");
    expect(state.failedWith).toBe("Marking could not be completed. Please try again.");
  });

  it("marks it failed if the result cannot be saved, instead of leaving it stuck", async () => {
    const { state, store } = memory();
    (store.saveResult as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
    expect(await gradeSubmission("s1", deps(store, vi.fn().mockResolvedValue(result)))).toBe("failed");
    expect(state.failedWith).toBe("Marking could not be completed. Please try again.");
  });

  it("returns skipped when someone else saved a result first", async () => {
    const { state, store } = memory();
    state.saveWins = false;
    expect(await gradeSubmission("s1", deps(store, vi.fn().mockResolvedValue(result)))).toBe("skipped");
    expect(state.failedWith).toBeNull();
  });
});
