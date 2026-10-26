"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProjectForm, type ProjectSubmitResult } from "@/components/ProjectForm";
import { ProjectResults } from "@/components/ProjectResults";
import { Icon } from "@/components/ui";
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
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section aria-labelledby="new-project-heading" className="space-y-3">
        <h2 id="new-project-heading" className="text-lg font-semibold">
          Start a new project
        </h2>
        <ProjectForm onSubmit={handleCreate} />
      </section>
      <section aria-labelledby="projects-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="projects-heading" className="text-lg font-semibold">
            Your projects
          </h2>
          {list.status === "ready" && list.projects.length > 0 && (
            <span className="badge-neutral">
              {list.projects.length} {list.projects.length === 1 ? "project" : "projects"}
            </span>
          )}
        </div>
        <div>
          {list.status === "loading" && (
            <p role="status" className="text-muted">
              Loading projects…
            </p>
          )}
          {list.status === "error" && (
            <div role="alert" className="alert-danger">
              <p>Could not load projects: {list.message}</p>
              <button type="button" onClick={retry} className="btn-secondary btn-sm mt-3">
                Try again
              </button>
            </div>
          )}
          {list.status === "ready" && list.projects.length === 0 && (
            <div className="card flex flex-col items-center gap-2 border-dashed p-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 text-accent">
                <Icon name="folder" className="h-6 w-6" />
              </span>
              <p className="font-medium">No projects yet</p>
              <p className="text-sm text-muted">Create your first project using the form.</p>
            </div>
          )}
          {list.status === "ready" && list.projects.length > 0 && (
            <ul className="space-y-4">
              {list.projects.map((project) => (
                <li key={project.id} className="card card-interactive group relative p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/student/projects/${project.id}`}
                      className="text-lg font-semibold text-fg after:absolute after:inset-0 hover:text-link"
                    >
                      {project.title}
                    </Link>
                    <Icon
                      name="arrow"
                      className="mt-1 h-5 w-5 shrink-0 text-muted transition duration-150 group-hover:translate-x-1 group-hover:text-accent"
                    />
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-muted">{project.description}</p>
                  <p className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="badge-neutral">
                      {project.durationWeeks} {project.durationWeeks === 1 ? "week" : "weeks"}
                    </span>
                    <span className="text-xs text-muted">Created {new Date(project.createdAt).toLocaleDateString()}</span>
                  </p>
                  <ProjectResults projectId={project.id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
