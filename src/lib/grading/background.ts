import "server-only";
import { after } from "next/server";
import { defaultGradingDeps } from "./repository";
import { gradeSubmission } from "./service";

/**
 * Marks a submission after the response has been sent, so the student's upload does not wait for the AI.
 * Nothing here can fail the request: problems are logged, and the submission keeps its own status.
 */
export function markInBackground(submissionId: string): void {
  after(async () => {
    try {
      await gradeSubmission(submissionId, defaultGradingDeps());
    } catch (error) {
      console.error("[grading] background marking failed:", error instanceof Error ? error.name : "unknown");
    }
  });
}
