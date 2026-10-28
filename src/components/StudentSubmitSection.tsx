"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchMySubmissions, retryProcessing, uploadAnswers } from "@/lib/api/client";
import type { Question } from "@/lib/schemas/assignment";
import type { StudentSubmission } from "@/lib/schemas/submission";
import { STUDENT_STATUS } from "./submission-labels";
import { Icon } from "./ui";
import { WorkflowProgress } from "./WorkflowProgress";

const NAME_KEY = "coLearning.studentName";
const MAX_BYTES = 4 * 1024 * 1024;
const POLL_MS = 5000;

function readStoredName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return ""; // storage can be blocked; the page works without it
  }
}

function storeName(name: string) {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

type List = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: StudentSubmission[] };

/**
 * Student: upload answers as a PDF or DOCX, and see the submissions made under the typed name.
 * Demo build: the name is just text, so anyone typing it sees those submissions.
 */
export function StudentSubmitSection({
  assignmentId,
  maxMarks,
  questions = [],
}: {
  assignmentId: string;
  maxMarks: number;
  questions?: Question[];
}) {
  // This component only mounts after the assignment has loaded in the browser, so reading the stored name
  // here cannot disagree with the server-rendered page.
  const [name, setName] = useState(readStoredName);
  const [shownName, setShownName] = useState(() => (readStoredName().trim().length >= 2 ? readStoredName().trim() : "")); // the name the list below is for
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<{ studentName?: string; file?: string }>({});
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [list, setList] = useState<List>(() => (readStoredName().trim().length >= 2 ? { status: "loading" } : { status: "idle" }));
  const [reload, setReload] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (shownName.length < 2) return;
    let cancelled = false;
    fetchMySubmissions(assignmentId, shownName).then(
      (items) => {
        if (!cancelled) setList({ status: "ready", items });
      },
      (error: unknown) => {
        if (!cancelled) setList({ status: "error", message: error instanceof Error ? error.message : "Could not load your submissions." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [assignmentId, shownName, reload]);

  // While a submission is still being read or marked, look again every few seconds.
  const stillWorking = list.status === "ready" && list.items.some((s) => s.status === "processing");
  useEffect(() => {
    if (!stillWorking) return;
    const timer = setTimeout(() => setReload((n) => n + 1), POLL_MS);
    return () => clearTimeout(timer);
  }, [stillWorking, reload]);

  function showSubmissionsFor(value: string) {
    const trimmed = value.trim();
    if (trimmed.length >= 2 && trimmed !== shownName) {
      storeName(trimmed);
      setList({ status: "loading" });
      setShownName(trimmed);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    setMessage(null);
    const problems: { studentName?: string; file?: string } = {};
    if (name.trim().length < 2) problems.studentName = "Enter your name (at least 2 characters).";
    if (!file) problems.file = "Choose a PDF or Word file.";
    else if (!/\.(pdf|docx)$/i.test(file.name)) problems.file = "Upload a PDF or Word (.docx) file.";
    else if (file.size > MAX_BYTES) problems.file = "The file is larger than 4 MB.";
    setFields(problems);
    if (problems.studentName || problems.file || !file) return;

    setUploading(true);
    try {
      const result = await uploadAnswers(assignmentId, name.trim(), file);
      if (result.ok) {
        setMessage(`Your file "${result.submission.fileName}" was received.`);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        storeName(name.trim());
        if (name.trim() !== shownName) {
          setList({ status: "loading" });
          setShownName(name.trim());
        } else setReload((n) => n + 1);
      } else {
        setFields(result.fields ?? {});
        if (!result.fields?.file && !result.fields?.studentName) setMessage(result.message);
      }
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRetry(id: string) {
    const result = await retryProcessing(id).catch(() => null);
    if (result?.ok) {
      setList((prev) =>
        prev.status === "ready" ? { status: "ready", items: prev.items.map((s) => (s.id === id ? result.submission : s)) } : prev,
      );
    } else {
      setMessage(result ? result.message : "Could not reach the server. Please try again.");
    }
  }

  return (
    <section aria-labelledby="submit-heading" className="space-y-6">
      <div className="card space-y-4 p-6">
        <h2 id="submit-heading" className="text-lg font-semibold">
          Submit your answers
        </h2>
        <p className="text-sm text-muted">
          Upload one PDF or Word (.docx) file with typed answers, up to 4 MB. You can submit more than once; each
          upload is reviewed separately. Scanned or handwritten documents can&apos;t be read yet.
        </p>
        <form onSubmit={handleSubmit} noValidate aria-label="Submit answers" className="space-y-4">
          <div>
            <label htmlFor="student-name" className="block text-sm font-medium text-fg">
              Your name
            </label>
            <input
              id="student-name"
              type="text"
              autoComplete="name"
              className="field mt-1 block aria-[invalid=true]:border-danger"
              value={name}
              aria-invalid={Boolean(fields.studentName)}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => showSubmissionsFor(name)}
            />
            <p className="mt-1 text-xs text-muted">
              Demo only: this is typed text, not a login. Use the same name each time to see your submissions.
            </p>
            {fields.studentName && (
              <p role="alert" className="mt-1 text-sm text-danger">
                {fields.studentName}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="answers-file" className="block text-sm font-medium text-fg">
              Your answers (PDF or DOCX)
            </label>
            <input
              id="answers-file"
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="field mt-1 block file:mr-3 file:rounded-lg file:border-0 file:bg-primary/20 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg"
              aria-invalid={Boolean(fields.file)}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {fields.file && (
              <p role="alert" className="mt-1 text-sm text-danger">
                {fields.file}
              </p>
            )}
          </div>
          {uploading && (
            <p role="status" className="text-sm text-link">
              Uploading your file…
            </p>
          )}
          {message && !uploading && (
            <p role="status" className="alert-info">
              {message}
            </p>
          )}
          <button type="submit" disabled={uploading} className="btn-primary">
            <Icon name="plus" className="h-4 w-4" />
            {uploading ? "Uploading…" : "Submit answers"}
          </button>
        </form>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">My submissions</h2>
        {shownName.length < 2 && (
          <p className="card border-dashed p-6 text-center text-muted">Enter your name above to see your submissions.</p>
        )}
        {shownName.length >= 2 && list.status === "loading" && (
          <p role="status" className="text-muted">
            Loading your submissions…
          </p>
        )}
        {list.status === "error" && (
          <div role="alert" className="alert-danger">
            <p>Could not load your submissions: {list.message}</p>
            <button type="button" onClick={() => setReload((n) => n + 1)} className="btn-secondary btn-sm mt-3">
              Try again
            </button>
          </div>
        )}
        {shownName.length >= 2 && list.status === "ready" && list.items.length === 0 && (
          <p className="card border-dashed p-6 text-center text-muted">
            No submissions under &ldquo;{shownName}&rdquo; yet.
          </p>
        )}
        {shownName.length >= 2 && list.status === "ready" && list.items.length > 0 && (
          <ul className="space-y-3">
            {list.items.map((s) => (
              <SubmissionCard
                key={s.id}
                submission={s}
                maxMarks={maxMarks}
                questions={questions}
                onRetry={() => handleRetry(s.id)}
                onWorkflowChange={() => setReload((n) => n + 1)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SubmissionCard({
  submission: s,
  maxMarks,
  questions,
  onRetry,
  onWorkflowChange,
}: {
  submission: StudentSubmission;
  maxMarks: number;
  questions: Question[];
  onRetry: () => void;
  onWorkflowChange: () => void;
}) {
  const status = STUDENT_STATUS[s.status];
  return (
    <li className="card space-y-2 p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-all font-semibold">{s.fileName}</p>
        <span className={status.badge}>{status.label}</span>
      </div>
      <p className="text-xs text-muted">Submitted {new Date(s.createdAt).toLocaleString()}</p>

      {(s.status === "processing" || s.status === "awaiting_review") && (
        <WorkflowProgress submissionId={s.id} status={s.status} onStateChange={onWorkflowChange} />
      )}
      {s.status === "awaiting_review" && <p className="text-muted">Waiting for your teacher to review. You will see your marks once they have.</p>}
      {(s.status === "needs_ocr" || s.status === "failed") && s.error && (
        <p role="alert" className="alert-warning">
          {s.error}
        </p>
      )}
      {s.status === "failed" && (
        <button type="button" onClick={onRetry} className="btn-secondary btn-sm">
          Try again
        </button>
      )}
      {s.status === "rejected" && <p className="text-muted">Your teacher reviewed this submission but did not give a mark.</p>}
      {s.finalTotal !== null && (
        <div className="well space-y-1 p-3">
          <p className="text-base font-semibold">
            Final marks: {s.finalTotal} / {maxMarks}
          </p>
          {s.scores && s.scores.length > 0 && (
            <ul className="space-y-0.5 text-muted">
              {s.scores.map((score) => {
                const q = questions.find((x) => x.number === score.number);
                return (
                  <li key={score.number} className="flex justify-between gap-3">
                    <span>Question {score.number}</span>
                    <span className="tabular-nums">
                      {score.marks}
                      {q ? ` / ${q.maxMarks}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {s.feedback && <p className="whitespace-pre-line text-fg">{s.feedback}</p>}
        </div>
      )}
    </li>
  );
}
