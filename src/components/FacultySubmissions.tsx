"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchFacultySubmissions } from "@/lib/api/client";
import type { FacultySubmissionSummary } from "@/lib/schemas/submission";
import { FACULTY_STATUS } from "./submission-labels";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: FacultySubmissionSummary[] };

/** Faculty: every submission for one assignment with its processing status. */
export function FacultySubmissions({ assignmentId }: { assignmentId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchFacultySubmissions(assignmentId).then(
      (items) => {
        if (!cancelled) setLoad({ status: "ready", items });
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load submissions." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [assignmentId, attempt]);

  return (
    <section aria-labelledby="submissions-heading" className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 id="submissions-heading" className="text-lg font-semibold">
          Submissions
        </h2>
        {load.status === "ready" && <span className="badge-neutral">{load.items.length}</span>}
      </div>
      {load.status === "loading" && (
        <p role="status" className="text-muted">
          Loading submissions…
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="alert-danger">
          <p>Could not load submissions: {load.message}</p>
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
      {load.status === "ready" && load.items.length === 0 && (
        <p className="card border-dashed p-6 text-center text-muted">No student has submitted an answer yet.</p>
      )}
      {load.status === "ready" && load.items.length > 0 && (
        <ul className="space-y-3">
          {load.items.map((s) => {
            const status = FACULTY_STATUS[s.status];
            return (
              <li key={s.id} className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div className="min-w-0 space-y-1">
                  <p className="text-base font-semibold">{s.studentName}</p>
                  <p className="break-all text-muted">
                    {s.fileName} · {(s.fileSize / 1024).toFixed(0)} KB · {new Date(s.createdAt).toLocaleString()}
                  </p>
                  {s.error && <p className="text-warning">{s.error}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={status.badge}>{status.label}</span>
                  <Link href={`/faculty/submissions/${s.id}`} className="btn-secondary btn-sm">
                    Open
                    <span className="sr-only"> submission by {s.studentName}</span>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
