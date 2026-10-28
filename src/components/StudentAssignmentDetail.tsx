"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchStudentAssignment } from "@/lib/api/client";
import type { StudentAssignment } from "@/lib/schemas/assignment";
import { QuestionList } from "./AssignmentParts";
import { StudentSubmitSection } from "./StudentSubmitSection";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "missing" }
  | { status: "ready"; assignment: StudentAssignment };

/** Student: the instructions, questions and rubric of one assignment. */
export function StudentAssignmentDetail({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchStudentAssignment(id).then(
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
      <Link href="/student/assignments" className="inline-flex text-sm font-medium text-link hover:text-fg">
        ← Back to assignments
      </Link>
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
      {load.status === "ready" && (
        <>
          <header className="space-y-2">
            <p className="eyebrow">Assignment</p>
            <h1 className="text-3xl font-bold tracking-tight">{load.assignment.title}</h1>
            <p className="flex flex-wrap gap-2">
              <span className="badge-neutral">
                {load.assignment.questions.length} {load.assignment.questions.length === 1 ? "question" : "questions"}
              </span>
              <span className="badge-primary">{load.assignment.maxMarks} marks in total</span>
            </p>
          </header>
          <section aria-labelledby="instructions-heading" className="card space-y-2 p-6">
            <h2 id="instructions-heading" className="text-lg font-semibold">
              Instructions
            </h2>
            <p className="whitespace-pre-line text-fg">{load.assignment.instructions}</p>
          </section>
          <section aria-labelledby="questions-heading" className="space-y-3">
            <h2 id="questions-heading" className="text-lg font-semibold">
              Questions and marking rubric
            </h2>
            <QuestionList questions={load.assignment.questions} />
          </section>
          <StudentSubmitSection assignmentId={load.assignment.id} maxMarks={load.assignment.maxMarks} questions={load.assignment.questions} />
        </>
      )}
    </div>
  );
}
