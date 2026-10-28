import {
  END,
  interrupt,
  ReducedValue,
  START,
  StateGraph,
  StateSchema,
  type BaseCheckpointSaver,
  type RetryPolicy,
} from "@langchain/langgraph";
import { z } from "zod";
import { GeminiError } from "@/lib/gemini/errors";
import { checkGrading, MAX_ATTEMPTS } from "@/lib/grading/generator";
import type { GradingPromptInput } from "@/lib/grading/prompt";
import type { GradingSubject } from "@/lib/grading/types";
import { AiResultSchema, type AiResult, type ExtractionInfo } from "@/lib/schemas/submission";
import type { Extraction } from "@/lib/submissions/extractor";
import type { UploadType } from "@/lib/submissions/file";
import { assessExtraction } from "@/lib/submissions/readable";
import { FailureCodeSchema, mergeTrace, TraceEntrySchema, type TraceEntry, type WorkflowNode } from "./progress";

/*
 * The assignment-marking workflow, one thread per submission ("submission:<id>").
 *
 *   extract_text → check_readable → grade → check_grade → save_result → await_faculty → finish
 *                       │              ↑        │                           (interrupt)
 *                       └→ needs_ocr   └────────┘ (one corrected retry)
 *   any failure → park_failed
 *
 * The graph only orchestrates. The database stays the authority: it holds the text, the recommendation and the
 * official decision (decide_submission), and every write below is a conditional, repeatable update, so a node
 * that runs twice (after a crash) does no harm. The checkpoint holds the working state only (page counts, the
 * model's raw answer and checked result, attempt numbers); it never holds the answer text.
 */

export const SubmissionState = new StateSchema({
  submissionId: z.string().default(""),
  run: z.number().int().default(0),
  /** running while the graph works; skipped when the submission was no longer processing. */
  outcome: z.enum(["running", "skipped", "needs_ocr", "failed", "complete"]).default("running"),
  fileType: z.enum(["pdf", "docx"]).nullable().default(null),
  pages: z.array(z.object({ number: z.number().int(), chars: z.number().int() })).default(() => []),
  readable: z.boolean().nullable().default(null),
  readableReason: z.string().nullable().default(null),
  gradeAttempt: z.number().int().default(0),
  /** What was wrong with the previous answer, sent back to the model for the corrected attempt. */
  gradeIssues: z.string().nullable().default(null),
  /** Gemini's answer until it has been checked. */
  rawGrading: z.string().nullable().default(null),
  aiResult: AiResultSchema.nullable().default(null),
  decided: z.boolean().default(false),
  failureCode: FailureCodeSchema.nullable().default(null),
  /** The sentence stored on the failed submission (our own wording; raw errors are only logged). */
  failureReason: z.string().nullable().default(null),
  trace: new ReducedValue(z.array(TraceEntrySchema).default(() => []), { reducer: mergeTrace }),
});
export type SubmissionStateValues = typeof SubmissionState.State;

/** The fields a new run starts from. Everything not listed here keeps no value from an earlier run. */
export const freshRunInput = (submissionId: string, run: number): Partial<SubmissionStateValues> => ({
  submissionId,
  run,
  outcome: "running",
  fileType: null,
  pages: [],
  readable: null,
  readableReason: null,
  gradeAttempt: 0,
  gradeIssues: null,
  rawGrading: null,
  aiResult: null,
  decided: false,
  failureCode: null,
  failureReason: null,
});

// ---- Dependencies ------------------------------------------------------------------------------------

export type SubmissionSnapshot = {
  status: GradingSubject["status"];
  filePath: string;
  fileType: UploadType;
  /** The text is already saved: it is reused, never read again. */
  hasText: boolean;
  extraction: ExtractionInfo | null;
};

export type SaveOutcome = "saved" | "already" | "skipped";

/** What the graph needs from the database. The Supabase version is in repository.ts; tests use a memory one. */
export type WorkflowStore = {
  loadSnapshot(id: string): Promise<SubmissionSnapshot | null>;
  /** Saves the text once. The database refuses to overwrite text that is already saved. */
  saveExtraction(id: string, text: string, info: ExtractionInfo): Promise<void>;
  loadSubject(id: string): Promise<GradingSubject | null>;
  /** "already": an earlier run of this step saved it (the step is being repeated). "skipped": no longer processing. */
  saveResult(id: string, result: AiResult, model: string): Promise<SaveOutcome>;
  /** Each of these only changes a submission that is still processing. */
  markNeedsOcr(id: string, reason: string): Promise<void>;
  setFailed(id: string, reason: string): Promise<void>;
  decisionExists(id: string): Promise<boolean>;
};

export type SubmissionGraphDeps = {
  store: WorkflowStore;
  download(path: string): Promise<Uint8Array>;
  extract(bytes: Uint8Array, type: UploadType, signal?: AbortSignal): Promise<Extraction>;
  requestGrading(input: GradingPromptInput, issues: string | undefined, signal?: AbortSignal): Promise<string | undefined>;
  model: string;
};

/** A problem with the stored file, with a sentence that is safe to show a student. */
export class ReadFileError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "ReadFileError";
  }
}
export const READ_FAILED = "Your file could not be found. Please upload it again.";

/** One transient failure (a timeout or a 503) is tried again once. A 429 never is: asking again only makes it worse. */
export const MARKING_RETRY: RetryPolicy = {
  maxAttempts: 2,
  initialInterval: 1_000,
  maxInterval: 5_000,
  jitter: false,
  logWarning: false,
  retryOn: (error: unknown) => error instanceof GeminiError && (error.code === "timeout" || error.code === "unavailable"),
};

/** A backstop around the model call (the request itself times out at 55 s). */
const MARKING_NODE_TIMEOUT_MS = 90_000;

const promptInput = (subject: GradingSubject): GradingPromptInput => ({
  title: subject.title,
  instructions: subject.instructions,
  questions: subject.questions,
  referenceAnswers: subject.referenceAnswers,
  answerText: subject.extractedText ?? "",
});

const entry = (state: SubmissionStateValues, node: WorkflowNode, attempt = 1, result: TraceEntry["result"] = "ok"): TraceEntry[] => [
  { run: state.run, node, attempt, result },
];

// ---- The graph ---------------------------------------------------------------------------------------

export function buildSubmissionGraph(deps: SubmissionGraphDeps, saver: BaseCheckpointSaver) {
  const { store } = deps;
  const failed = (state: { failureReason: string | null }) => state.failureReason !== null;

  return new StateGraph(SubmissionState)
    .addNode("extract_text", async (state, config) => {
      const row = await store.loadSnapshot(state.submissionId);
      if (!row) throw new ReadFileError("Submission not found.");
      if (row.status !== "processing") return { outcome: "skipped" as const, trace: entry(state, "extract_text") };

      // Rerun safety: text that is already saved is reused, so a repeated step never reads or saves it twice.
      if (row.hasText && row.extraction) {
        return { fileType: row.fileType, pages: row.extraction.pages, trace: entry(state, "extract_text") };
      }
      let bytes: Uint8Array;
      try {
        bytes = await deps.download(row.filePath);
      } catch {
        throw new ReadFileError(READ_FAILED);
      }
      const { text, ...info } = await deps.extract(bytes, row.fileType, config.signal);
      await store.saveExtraction(state.submissionId, text, info);
      return { fileType: row.fileType, pages: info.pages, trace: entry(state, "extract_text") };
    })

    .addNode("check_readable", (state) => {
      const verdict = assessExtraction(state.pages, state.fileType ?? "pdf");
      return {
        readable: verdict.readable,
        readableReason: verdict.readable ? null : verdict.reason,
        trace: entry(state, "check_readable"),
      };
    })

    .addNode(
      "grade",
      async (state: SubmissionStateValues, config) => {
        const subject = await store.loadSubject(state.submissionId);
        if (!subject) throw new ReadFileError("Submission not found.");
        if (subject.status !== "processing" || subject.extractedText === null) {
          return { outcome: "skipped" as const, trace: entry(state, "grade", state.gradeAttempt + 1) };
        }
        const raw = await deps.requestGrading(promptInput(subject), state.gradeIssues ?? undefined, config.signal);
        const attempt = state.gradeAttempt + 1;
        return { rawGrading: raw ?? "", gradeAttempt: attempt, trace: entry(state, "grade", attempt) };
      },
      { retryPolicy: MARKING_RETRY, timeout: MARKING_NODE_TIMEOUT_MS },
    )

    .addNode("check_grade", async (state) => {
      const subject = await store.loadSubject(state.submissionId);
      if (!subject) throw new ReadFileError("Submission not found.");
      const checked = checkGrading(state.rawGrading ?? "", promptInput(subject), state.gradeAttempt);
      if (checked.ok) {
        return { aiResult: checked.value, rawGrading: null, gradeIssues: null, trace: entry(state, "check_grade", state.gradeAttempt) };
      }
      if (state.gradeAttempt < MAX_ATTEMPTS) {
        return { rawGrading: null, gradeIssues: checked.issues, trace: entry(state, "check_grade", state.gradeAttempt, "retry") };
      }
      return {
        rawGrading: null,
        failureCode: "marking_invalid" as const,
        failureReason: `Marking could not be completed. ${new GeminiError("invalid_response").message}`,
        trace: entry(state, "check_grade", state.gradeAttempt, "failed"),
      };
    })

    .addNode("save_result", async (state) => {
      if (!state.aiResult) throw new Error("save_result reached without a checked result");
      const saved = await store.saveResult(state.submissionId, state.aiResult, deps.model);
      if (saved === "skipped") return { outcome: "skipped" as const, trace: entry(state, "save_result") };
      return { trace: entry(state, "save_result") };
    })

    .addNode("await_faculty", async (state) => {
      // Everything before interrupt() runs again on resume, so it only reads. A decision made before the graph
      // got here (or while it was being resumed) is seen here, and nothing waits for it.
      if (!(await store.decisionExists(state.submissionId))) {
        interrupt({ kind: "faculty_review" });
      }
      // The decision itself is made by the database function; the graph only learns that it exists.
      const decided = await store.decisionExists(state.submissionId);
      return { decided, ...(decided ? { trace: entry(state, "await_faculty") } : {}) };
    })

    .addNode("finish", (state) => ({ outcome: "complete" as const, trace: entry(state, "finish") }))

    .addNode("needs_ocr", async (state) => {
      await store.markNeedsOcr(state.submissionId, state.readableReason ?? "This document has no readable text.");
      return { outcome: "needs_ocr" as const, trace: entry(state, "needs_ocr") };
    })

    .addNode("park_failed", async (state) => {
      await store.setFailed(state.submissionId, state.failureReason ?? "Marking could not be completed. Please try again.");
      return { outcome: "failed" as const, trace: entry(state, "park_failed") };
    })

    .addEdge(START, "extract_text")
    .addConditionalEdges("extract_text", (state) => (failed(state) ? "park_failed" : state.outcome === "skipped" ? END : "check_readable"), [
      "park_failed",
      "check_readable",
      END,
    ])
    .addConditionalEdges("check_readable", (state) => (state.readable ? "grade" : "needs_ocr"), ["grade", "needs_ocr"])
    .addConditionalEdges("grade", (state) => (failed(state) ? "park_failed" : state.outcome === "skipped" ? END : "check_grade"), [
      "park_failed",
      "check_grade",
      END,
    ])
    .addConditionalEdges(
      "check_grade",
      (state) => (failed(state) ? "park_failed" : state.aiResult ? "save_result" : "grade"),
      ["park_failed", "save_result", "grade"],
    )
    .addConditionalEdges("save_result", (state) => (failed(state) ? "park_failed" : state.outcome === "skipped" ? END : "await_faculty"), [
      "park_failed",
      "await_faculty",
      END,
    ])
    .addConditionalEdges("await_faculty", (state) => (state.decided ? "finish" : "await_faculty"), ["finish", "await_faculty"])
    .addEdge("finish", END)
    .addEdge("needs_ocr", END)
    .addEdge("park_failed", END)
    .compile({ checkpointer: saver });
}

export type SubmissionGraph = ReturnType<typeof buildSubmissionGraph>;
