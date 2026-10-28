"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlanSection } from "@/components/PlanSection";
import { ProgressSection } from "@/components/ProgressSection";
import { RepoSection } from "@/components/RepoSection";
import { fetchProject } from "@/lib/api/client";
import type { Project } from "@/lib/schemas/project";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not_found" }
  | { status: "ready"; project: Project };

export function ProjectDetail({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchProject(id).then(
      (project) => {
        if (cancelled) return;
        setState(
          project ? { status: "ready", project } : { status: "not_found" },
        );
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "Could not load project.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="space-y-8">
      <Link href="/student" className="inline-flex text-sm font-medium text-link hover:text-fg">
        ← Back to projects
      </Link>
      {state.status === "loading" && (
        <p role="status" className="text-muted">
          Loading project…
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="alert-danger">
          Could not load project: {state.message}
        </p>
      )}
      {state.status === "not_found" && (
        <p role="alert" className="text-fg">
          Project not found.
        </p>
      )}
      {state.status === "ready" && (
        <article className="card p-6 sm:p-8">
          <p className="eyebrow">Project</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{state.project.title}</h1>
          <p className="mt-3 max-w-3xl whitespace-pre-wrap text-muted">
            {state.project.description}
          </p>
          <dl className="mt-6 grid gap-x-6 gap-y-3 border-t border-line pt-5 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted">GitHub repository</dt>
            <dd className="break-all font-medium">{state.project.repoUrl}</dd>
            <dt className="text-muted">Duration</dt>
            <dd className="font-medium">{state.project.durationWeeks} weeks</dd>
            <dt className="text-muted">Created</dt>
            <dd className="font-medium">{new Date(state.project.createdAt).toLocaleString()}</dd>
          </dl>
        </article>
      )}
      {state.status === "ready" && <ProgressSection projectId={state.project.id} durationWeeks={state.project.durationWeeks} />}
      {state.status === "ready" && <RepoSection projectId={state.project.id} />}
      {state.status === "ready" && <PlanSection projectId={state.project.id} durationWeeks={state.project.durationWeeks} />}
    </div>
  );
}
