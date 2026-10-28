"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchFacultyAssignment, fetchFacultySubmission, runAiMarking } from "@/lib/api/client";
import type { FacultyAssignment, Question } from "@/lib/schemas/assignment";
import type { FacultySubmission } from "@/lib/schemas/submission";
import { OpenAccessNotice } from "./AssignmentParts";
import { FACULTY_STATUS } from "./submission-labels";
import { AiRecommendation, DecisionPanel, OfficialResult } from "./SubmissionReview";
import { Disclosure } from "./ui";
import { WorkflowProgress } from "./WorkflowProgress";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "missing" }
  | { status: "ready"; submission: FacultySubmission; assignment: FacultyAssignment };

/** Faculty: one submission with the file, the text read from it, the AI recommendation and the official decision. */
export function FacultySubmissionDetail({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchFacultySubmission(id)
      .then(async (submission) => {
        if (!submission) return null;
        const assignment = await fetchFacultyAssignment(submission.assignmentId);
        if (!assignment) throw new Error("The assignment for this submission could not be found.");
        return { submission, assignment };
      })
      .then(
      (found) => {
        if (!cancelled) setLoad(found ? { status: "ready", ...found } : { status: "missing" });
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the submission." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  return (
    <div className="space-y-6">
      {load.status === "ready" ? (
        <Link href={`/faculty/assignments/${load.submission.assignmentId}`} className="inline-flex text-sm font-medium text-link hover:text-fg">
          ← Back to the assignment
        </Link>
      ) : (
        <Link href="/faculty/assignments" className="inline-flex text-sm font-medium text-link hover:text-fg">
          ← Back to assignments
        </Link>
      )}
      <OpenAccessNotice />
      {load.status === "loading" && <p role="status">Loading submission…</p>}
      {load.status === "missing" && (
        <p role="alert" className="card p-5">
          This submission does not exist.
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="alert-danger">
          <p>Could not load the submission: {load.message}</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className="btn-secondary btn-sm mt-3"
          >
            Try again
          </button>
        </div>
      )}
      {load.status === "ready" && (
        <Detail
          submission={load.submission}
          questions={load.assignment.questions}
          maxMarks={load.assignment.maxMarks}
          onChange={(submission) => setLoad({ ...load, submission })}
        />
      )}
    </div>
  );
}

function Detail({
  submission: s,
  questions,
  maxMarks,
  onChange,
}: {
  submission: FacultySubmission;
  questions: Question[];
  maxMarks: number;
  onChange: (submission: FacultySubmission) => void;
}) {
  const status = FACULTY_STATUS[s.status];
  const totalChars = s.extraction?.pages.reduce((sum, p) => sum + p.chars, 0) ?? 0;
  return (
    <>
      <header className="space-y-2">
        <p className="eyebrow">Submission</p>
        <h1 className="text-3xl font-bold tracking-tight">{s.studentName}</h1>
        <p className="flex flex-wrap items-center gap-2">
          <span className={status.badge}>{status.label}</span>
          <span className="badge-neutral">{s.fileType.toUpperCase()}</span>
          <span className="badge-neutral">{(s.fileSize / 1024).toFixed(0)} KB</span>
          <span className="badge-neutral">Submitted {new Date(s.createdAt).toLocaleString()}</span>
        </p>
      </header>

      {s.error && (
        <p role="alert" className="alert-warning">
          {s.error}
        </p>
      )}

      <section aria-labelledby="workflow-heading" className="card space-y-3 p-6">
        <h2 id="workflow-heading" className="text-lg font-semibold">
          Workflow
        </h2>
        <WorkflowProgress submissionId={s.id} status={s.status} />
      </section>

      <section aria-labelledby="original-heading" className="card space-y-2 p-6">
        <h2 id="original-heading" className="text-lg font-semibold">
          Original file
        </h2>
        <p className="break-all text-sm text-muted">{s.fileName}</p>
        {s.downloadUrl ? (
          <a href={s.downloadUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
            Download the original
            <span className="sr-only"> ({s.fileName}, opens in a new tab)</span>
          </a>
        ) : (
          <p className="text-sm text-muted">The original file link could not be created.</p>
        )}
        <p className="text-xs text-muted">The link stops working after a few minutes; reload this page for a new one.</p>
      </section>

      <section aria-labelledby="text-heading" className="card space-y-3 p-6">
        <h2 id="text-heading" className="text-lg font-semibold">
          Text read from the file
        </h2>
        {s.extractedText === null ? (
          <p className="text-sm text-muted">No text has been read from this file.</p>
        ) : (
          <>
            <p className="flex flex-wrap gap-2">
              <span className="badge-neutral">
                {s.extraction?.pages.length ?? 0} {s.extraction?.pages.length === 1 ? "page" : "pages"}
              </span>
              <span className="badge-neutral">{totalChars.toLocaleString()} characters</span>
            </p>
            {s.extraction && s.extraction.warnings.length > 0 && (
              <div className="alert-warning text-sm">
                <p className="font-semibold">Reading warnings</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {s.extraction.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <Disclosure className="well p-3" summary={<span className="px-1 py-1 text-sm font-semibold">Show the extracted text</span>}>
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas/70 p-4 text-sm text-fg">
                {s.extractedText}
              </pre>
            </Disclosure>
          </>
        )}
      </section>

      {s.decision && <OfficialResult submission={s} questions={questions} maxMarks={maxMarks} />}

      {s.aiResult ? (
        <AiRecommendation submission={s} questions={questions} maxMarks={maxMarks} />
      ) : (
        <MarkingPrompt submission={s} onMarked={onChange} />
      )}

      {s.status === "awaiting_review" && !s.decision && (
        <DecisionPanel key={s.id} submission={s} questions={questions} maxMarks={maxMarks} onDecided={onChange} />
      )}
    </>
  );
}

/** Where the AI recommendation will appear. Offers to run the marking when it has not happened yet. */
function MarkingPrompt({ submission: s, onMarked }: { submission: FacultySubmission; onMarked: (submission: FacultySubmission) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canRun = s.status === "processing" && s.hasText;

  async function run() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await runAiMarking(s.id);
      if (result.ok) onMarked(result.submission);
      else setMessage(result.message);
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ai-heading" className="card space-y-3 p-6">
      <h2 id="ai-heading" className="text-lg font-semibold">
        AI recommendation
      </h2>
      <p className="text-sm text-muted">
        {canRun
          ? "The text has been read. The AI marks it automatically after the upload; if it has not finished, you can run it now. It only gives a recommendation."
          : "No AI marking has been done for this submission."}
      </p>
      {canRun && (
        <button type="button" onClick={run} disabled={busy} className="btn-primary btn-sm">
          {busy ? "Marking… this can take up to a minute" : "Run AI marking"}
        </button>
      )}
      {message && (
        <p role="alert" className="alert-danger">
          {message}
        </p>
      )}
    </section>
  );
}
