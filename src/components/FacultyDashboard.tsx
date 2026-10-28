"use client";

import { useEffect, useState } from "react";
import { fetchProjects, fetchQueue, fetchStudents } from "@/lib/api/client";
import type { Project } from "@/lib/schemas/project";
import type { QueueItem } from "@/lib/schemas/review";
import type { StudentList as StudentListData } from "@/lib/students/types";
import { FacultyAnalytics } from "./FacultyAnalytics";
import { FacultyProjects } from "./FacultyProjects";
import { FacultyQueue } from "./FacultyQueue";
import { StudentList, StudentOverviewCards } from "./FacultyStudents";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; students: StudentListData; items: QueueItem[]; projects: Project[] };

/**
 * The faculty dashboard, student first: the class overview, then every student (searchable, each opening to their
 * details and a full profile), and below them the project overview and the review queue. Everything is worked out
 * from the real records.
 */
export function FacultyDashboard() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStudents(), fetchQueue("all"), fetchProjects()]).then(
      ([students, items, projects]) => {
        if (!cancelled) setLoad({ status: "ready", students, items, projects });
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

  const { students, items, projects } = load;
  return (
    <div className="space-y-10">
      <StudentOverviewCards overview={students.overview} />
      <StudentList students={students.students} />

      <div className="space-y-8 border-t border-line pt-10">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">Projects and reviews</h2>
          <p className="text-sm text-muted">The whole class by project: how each week was scored, and the evaluations waiting for you.</p>
        </div>
        <FacultyAnalytics items={items} />
        <FacultyProjects items={items} projects={projects} />
        <FacultyQueue items={items} />
      </div>
    </div>
  );
}
