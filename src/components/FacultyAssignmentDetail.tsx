"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchFacultyAssignment } from "@/lib/api/client";
import type { FacultyAssignment } from "@/lib/schemas/assignment";
import { OpenAccessNotice, QuestionList } from "./AssignmentParts";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "missing" }
  | { status: "ready"; assignment: FacultyAssignment };

/** Faculty: one assignment with its questions, rubric and reference answers. */
export function FacultyAssignmentDetail({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchFacultyAssignment(id).then(
      (assignment) => {
        if (!cancelled) setLoad(assignment ? { status: "ready", assignment } : { status: "missing" });
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the assignment." });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  return (
    <div className="space-y-6">
      <Link href="/faculty/assignments" className="inline-flex text-sm font-medium text-link hover:text-fg">
        ← Back to assignments
      </Link>
      <OpenAccessNotice />
      {load.status === "loading" && <p role="status">Loading assignment…</p>}
      {load.status === "missing" && (
        <p role="alert" className="card p-5">
          This assignment does not exist.
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="alert-danger">
          <p>Could not load the assignment: {load.message}</p>
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
      {load.status === "ready" && <Detail assignment={load.assignment} />}
    </div>
  );
}

function Detail({ assignment: a }: { assignment: FacultyAssignment }) {
  return (
    <>
      <header className="space-y-2">
        <p className="eyebrow">Assignment</p>
        <h1 className="text-3xl font-bold tracking-tight">{a.title}</h1>
        <p className="flex flex-wrap gap-2">
          <span className="badge-neutral">
            {a.questions.length} {a.questions.length === 1 ? "question" : "questions"}
          </span>
          <span className="badge-primary">{a.maxMarks} marks in total</span>
          <span className={a.submissionCount > 0 ? "badge-info" : "badge-neutral"}>
            {a.submissionCount} {a.submissionCount === 1 ? "submission" : "submissions"}
          </span>
        </p>
      </header>

      <section aria-labelledby="instructions-heading" className="card space-y-2 p-6">
        <h2 id="instructions-heading" className="text-lg font-semibold">
          Instructions
        </h2>
        <p className="whitespace-pre-line text-fg">{a.instructions}</p>
      </section>

      <section aria-labelledby="questions-heading" className="space-y-3">
        <h2 id="questions-heading" className="text-lg font-semibold">
          Questions and rubric
        </h2>
        <QuestionList questions={a.questions} referenceAnswers={a.referenceAnswers} />
      </section>

      <section aria-labelledby="submissions-heading" className="space-y-3">
        <h2 id="submissions-heading" className="text-lg font-semibold">
          Submissions
        </h2>
        {a.submissionCount === 0 ? (
          <p className="card border-dashed p-6 text-center text-muted">No student has submitted an answer yet.</p>
        ) : (
          <p className="card p-6 text-muted">
            {a.submissionCount} {a.submissionCount === 1 ? "submission" : "submissions"} received.
          </p>
        )}
      </section>
    </>
  );
}
