"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProjectForm, type ProjectSubmitResult } from "@/components/ProjectForm";
import { createProject, fetchProjects } from "@/lib/api/client";
import type { Project } from "@/lib/schemas/project";
import type { ProjectFormValues } from "@/lib/validation/project";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; projects: Project[] };

export function ProjectsPanel() {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchProjects().then(
      (projects) => {
        if (!cancelled) setList({ status: "ready", projects });
      },
      (error: unknown) => {
        if (cancelled) return;
        setList({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not load projects.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retry() {
    setList({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  async function handleCreate(
    values: ProjectFormValues,
  ): Promise<ProjectSubmitResult> {
    const { result, project } = await createProject(values);
    if (result.ok && project) {
      setList((prev) =>
        prev.status === "ready"
          ? { status: "ready", projects: [project, ...prev.projects] }
          : prev,
      );
      if (list.status !== "ready") retry();
    }
    return result;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <ProjectForm onSubmit={handleCreate} />
      <section aria-labelledby="projects-heading">
        <h2 id="projects-heading" className="text-lg font-semibold">
          Your projects
        </h2>
        <div className="mt-3">
          {list.status === "loading" && (
            <p role="status" className="text-slate-600">
              Loading projects…
            </p>
          )}
          {list.status === "error" && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"
            >
              <p>Could not load projects: {list.message}</p>
              <button
                type="button"
                onClick={retry}
                className="mt-2 rounded-md border border-red-400 px-3 py-1 font-medium hover:bg-red-100"
              >
                Try again
              </button>
            </div>
          )}
          {list.status === "ready" && list.projects.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-slate-600">
              No projects yet. Create your first project using the form.
            </p>
          )}
          {list.status === "ready" && list.projects.length > 0 && (
            <ul className="space-y-3">
              {list.projects.map((project) => (
                <li
                  key={project.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <Link
                    href={`/student/projects/${project.id}`}
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {project.title}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                    {project.description}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {project.durationWeeks} weeks ·{" "}
                    {new Date(project.createdAt).toLocaleDateString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
