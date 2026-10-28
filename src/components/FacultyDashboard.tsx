"use client";

import { useEffect, useState } from "react";
import { fetchProjects, fetchQueue } from "@/lib/api/client";
import type { Project } from "@/lib/schemas/project";
import type { QueueItem } from "@/lib/schemas/review";
import { FacultyAnalytics } from "./FacultyAnalytics";
import { FacultyProjects } from "./FacultyProjects";
import { FacultyQueue } from "./FacultyQueue";
import { FacultyStats } from "./FacultyStats";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: QueueItem[]; projects: Project[] };

/**
 * The faculty dashboard. It loads every evaluation and every project once; the summary cards,
 * charts, project list and the filtered queue are all worked out from that real data.
 */
export function FacultyDashboard() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchQueue("all"), fetchProjects()]).then(
      ([items, projects]) => {
        if (!cancelled) setLoad({ status: "ready", items, projects });
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the dashboard." });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (load.status === "loading") {
    return (
      <p role="status" className="text-muted">
        Loading dashboard…
      </p>
    );
  }
  if (load.status === "error") {
    return (
      <div role="alert" className="alert-danger">
        <p>Could not load the dashboard: {load.message}</p>
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
    );
  }

  const { items, projects } = load;
  return (
    <div className="space-y-10">
      <FacultyStats items={items} projects={projects} />
      <FacultyAnalytics items={items} />
      <FacultyProjects items={items} projects={projects} />
      <FacultyQueue items={items} />
    </div>
  );
}
