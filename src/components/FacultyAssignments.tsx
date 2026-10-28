"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createAssignment, fetchFacultyAssignments } from "@/lib/api/client";
import type { FacultyAssignmentSummary } from "@/lib/schemas/assignment";
import type { AssignmentInput } from "@/lib/validation/assignment";
import { AssignmentForm } from "./AssignmentForm";
import { OpenAccessNotice } from "./AssignmentParts";
import { Icon, StatCard } from "./ui";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; assignments: FacultyAssignmentSummary[] };

/** Faculty: the assignments with their submission counts, and a form to create one. */
export function FacultyAssignments() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFacultyAssignments().then(
      (assignments) => {
        if (!cancelled) setLoad({ status: "ready", assignments });
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load assignments." });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function handleCreate(input: AssignmentInput) {
    const { result, assignment } = await createAssignment(input);
    if (result.ok && assignment) {
      setLoad((prev) => {
        if (prev.status !== "ready") return prev;
        const { referenceAnswers: _ignored, ...summary } = assignment;
        void _ignored;
        return { status: "ready", assignments: [summary, ...prev.assignments] };
      });
    }
    return result;
  }

  const assignments = load.status === "ready" ? load.assignments : [];
  const empty = load.status === "ready" && assignments.length === 0;
  const formOpen = creating ?? empty;
  const questionCount = assignments.reduce((n, a) => n + a.questions.length, 0);
  const submissionCount = assignments.reduce((n, a) => n + a.submissionCount, 0);

  return (
    <div className="space-y-8">
      <OpenAccessNotice />

      {load.status === "ready" && (
        <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon="doc" label="Assignments" value={assignments.length} hint="created by faculty" />
          <StatCard icon="check" label="Questions" value={questionCount} hint="across all assignments" />
          <StatCard icon="student" label="Submissions" value={submissionCount} hint="uploaded by students" />
        </section>
      )}

      <section aria-labelledby="assignments-heading" className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="assignments-heading" className="text-xl font-semibold">
            Assignments
          </h2>
          {load.status === "ready" && (
            <button
              type="button"
              aria-expanded={formOpen}
              aria-controls="create-assignment"
              onClick={() => setCreating(!formOpen)}
              className={formOpen ? "btn-secondary btn-sm" : "btn-primary btn-sm"}
            >
              <Icon name="plus" className={`h-4 w-4 transition-transform ${formOpen ? "rotate-45" : ""}`} />
              {formOpen ? "Close" : "New assignment"}
            </button>
          )}
        </div>

        <div id="create-assignment" hidden={!formOpen} className="card p-6">
          <h3 className="mb-4 text-lg font-semibold">Create an assignment</h3>
          <AssignmentForm onSubmit={handleCreate} />
        </div>

        {load.status === "loading" && (
          <p role="status" className="text-muted">
            Loading assignments…
          </p>
        )}
        {load.status === "error" && (
          <div role="alert" className="alert-danger">
            <p>Could not load assignments: {load.message}</p>
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
        {empty && (
          <p className="card border-dashed p-8 text-center text-muted">
            No assignments yet. Create the first one with the form above.
          </p>
        )}
        {load.status === "ready" && assignments.length > 0 && (
          <ul className="grid gap-5 md:grid-cols-2">
            {assignments.map((a) => (
              <li key={a.id} className="min-w-0">
                <article className="card card-interactive group relative flex h-full flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-semibold leading-snug">
                      <Link
                        href={`/faculty/assignments/${a.id}`}
                        className="text-fg after:absolute after:inset-0 after:rounded-2xl hover:text-link"
                      >
                        {a.title}
                        <span className="sr-only"> (open assignment)</span>
                      </Link>
                    </h3>
                    <Icon
                      name="arrow"
                      className="mt-1 h-5 w-5 shrink-0 text-muted transition duration-150 group-hover:translate-x-1 group-hover:text-accent"
                    />
                  </div>
                  <p className="line-clamp-2 text-sm text-muted">{a.instructions}</p>
                  <p className="mt-auto flex flex-wrap gap-2 pt-1">
                    <span className="badge-neutral">
                      {a.questions.length} {a.questions.length === 1 ? "question" : "questions"}
                    </span>
                    <span className="badge-primary">{a.maxMarks} marks</span>
                    <span className={a.submissionCount > 0 ? "badge-info" : "badge-neutral"}>
                      {a.submissionCount} {a.submissionCount === 1 ? "submission" : "submissions"}
                    </span>
                    {a.hasReferenceAnswers && <span className="badge-neutral">Has reference answers</span>}
                  </p>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
