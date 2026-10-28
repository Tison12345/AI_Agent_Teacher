"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchStudentAssignments } from "@/lib/api/client";
import type { StudentAssignment } from "@/lib/schemas/assignment";
import { Icon } from "./ui";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; assignments: StudentAssignment[] };

/** Student: the assignments faculty have created. */
export function StudentAssignments() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchStudentAssignments().then(
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

  return (
    <section aria-labelledby="assignments-heading" className="space-y-5">
      <h2 id="assignments-heading" className="text-xl font-semibold">
        Available assignments
      </h2>
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
      {load.status === "ready" && load.assignments.length === 0 && (
        <div className="card flex flex-col items-center gap-2 border-dashed p-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 text-accent">
            <Icon name="doc" className="h-6 w-6" />
          </span>
          <p className="font-medium">No assignments yet</p>
          <p className="text-sm text-muted">Your teacher has not created an assignment.</p>
        </div>
      )}
      {load.status === "ready" && load.assignments.length > 0 && (
        <ul className="grid gap-5 md:grid-cols-2">
          {load.assignments.map((a) => (
            <li key={a.id} className="min-w-0">
              <article className="card card-interactive group relative flex h-full flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold leading-snug">
                    <Link
                      href={`/student/assignments/${a.id}`}
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
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
