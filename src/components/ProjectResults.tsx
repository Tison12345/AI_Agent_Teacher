"use client";

import { useEffect, useState } from "react";
import { fetchResults } from "@/lib/api/client";
import type { StudentResult } from "@/lib/schemas/review";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; results: StudentResult[] };

/**
 * A project's official, teacher-approved results for the student dashboard.
 * It shows nothing until a teacher has decided a week, and never an AI score.
 */
export function ProjectResults({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchResults(projectId).then(
      (results) => {
        if (!cancelled) setState({ status: "ready", results });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (state.status === "loading") return null;
  if (state.status === "error") {
    return <p className="mt-2 text-xs text-muted">Teacher results could not be loaded.</p>;
  }
  if (state.results.length === 0) return null;
  return (
    <div className="mt-4 border-t border-line pt-3 text-sm">
      <p className="eyebrow">Teacher-approved results</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {state.results.map((r) => (
          <li key={r.weekNumber} className={r.officialScore === null ? "badge-neutral" : "badge-success"}>
            Week {r.weekNumber}: {r.officialScore === null ? "reviewed, no mark" : `${r.officialScore}/100`}
          </li>
        ))}
      </ul>
    </div>
  );
}
