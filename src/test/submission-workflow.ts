// Test-only: a memory database (with the same conditional-update rules as the real one), fake Gemini and
// extractor, and the fixtures shared by the assignment workflow's unit tests and its live test.
import { vi } from "vitest";
import type { GradingSubject } from "@/lib/grading/types";
import type { AiResult, ExtractionInfo, SubmissionStatus } from "@/lib/schemas/submission";
import type { Extraction } from "@/lib/submissions/extractor";
import { type SaveOutcome, type SubmissionGraphDeps, type WorkflowStore } from "@/lib/workflow/submission/graph";

export const ID = "223e4567-e89b-42d3-a456-426614174000";
export const ANSWER = "1. A loop repeats a block of code until a condition stops it.\n2. An array is an ordered collection of values.";
export const questions = [
  { number: 1, text: "What does a loop do?", maxMarks: 5, rubric: "Repetition." },
  { number: 2, text: "What is an array?", maxMarks: 2.5, rubric: "Ordered values." },
];
export const good = {
  questions: [
    { number: 1, marks: 5, explanation: "Defines repetition.", quotes: ["A loop repeats a block of code"] },
    { number: 2, marks: 2.5, explanation: "Mentions order.", quotes: ["an ordered collection of values"] },
  ],
  feedback: "Well done.",
};
export const bad = { ...good, questions: [{ ...good.questions[0], quotes: ["a sentence the student never wrote"] }, good.questions[1]] };
export const reply = (value: unknown) => JSON.stringify(value);
export const typed: Extraction = { text: ANSWER, pages: [{ number: 1, chars: 450 }], warnings: [] };
export const scanned: Extraction = { text: "\n\n", pages: [{ number: 1, chars: 0 }, { number: 2, chars: 0 }], warnings: ["Page 1 has no readable text."] };

/** A memory database that follows the same rules as the real conditional updates. */
export function memory(init: { text?: string | null; status?: SubmissionStatus; extraction?: ExtractionInfo | null } = {}) {
  const db = {
    status: (init.status ?? "processing") as SubmissionStatus,
    text: init.text ?? null,
    extraction: init.extraction ?? null,
    error: null as string | null,
    aiResult: null as AiResult | null,
    decided: false,
    saves: 0,
    textSaves: 0,
    saveBehaviour: null as null | "crash-after-write" | "db-down" | "moved-on",
  };
  const store: WorkflowStore = {
    async loadSnapshot() {
      return { status: db.status, filePath: `a/${ID}.pdf`, fileType: "pdf", hasText: db.text !== null, extraction: db.extraction };
    },
    async saveExtraction(_id, text, info) {
      if (db.text !== null) throw new Error("extracted text cannot be changed once saved");
      db.text = text;
      db.extraction = info;
      db.textSaves += 1;
    },
    async loadSubject(): Promise<GradingSubject> {
      return { status: db.status, title: "Loops", instructions: "Answer both.", questions, referenceAnswers: null, extractedText: db.text };
    },
    async saveResult(_id, result): Promise<SaveOutcome> {
      db.saves += 1;
      if (db.saveBehaviour === "db-down") throw new Error("connect ECONNREFUSED secret-host:5432 password=hunter2");
      if (db.saveBehaviour === "moved-on") return "skipped";
      if (db.aiResult) return "already";
      if (db.status !== "processing") return "skipped";
      db.aiResult = result;
      db.status = "awaiting_review";
      return "saved";
    },
    async markNeedsOcr(_id, reason) {
      if (db.status === "processing") Object.assign(db, { status: "needs_ocr", error: reason });
    },
    async setFailed(_id, reason) {
      if (db.status === "processing") Object.assign(db, { status: "failed", error: reason });
    },
    async decisionExists() {
      return db.decided;
    },
  };
  return { db, store };
}


export type Behaviour = {
  extract?: (...args: never[]) => Promise<Extraction>;
  grading?: Array<string | Error>;
  init?: Parameters<typeof memory>[0];
};

/** Fake dependencies for the graph. `grading` lists what Gemini answers in turn (the last one repeats). */
export function fakeDeps(options: Behaviour = {}) {
  const { db, store } = memory(options.init);
  const extract = vi.fn(async () => typed);
  if (options.extract) extract.mockImplementation(options.extract as never);
  const responses = [...(options.grading ?? [reply(good)])];
  const requestGrading = vi.fn(async (...args: [input: unknown, issues: string | undefined, signal?: AbortSignal]) => {
    void args;
    const next = responses.length > 1 ? responses.shift()! : responses[0];
    if (next instanceof Error) throw next;
    return next;
  });
  const deps: SubmissionGraphDeps = {
    store,
    download: vi.fn(async () => new Uint8Array([1])),
    extract: extract as unknown as SubmissionGraphDeps["extract"],
    requestGrading,
    model: "test-model",
  };
  return { db, store, deps, extract, requestGrading };
}
