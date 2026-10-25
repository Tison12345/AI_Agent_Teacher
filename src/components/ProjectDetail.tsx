"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
    <div className="space-y-4">
      <Link href="/student" className="text-sm text-indigo-700 hover:underline">
        ← Back to projects
      </Link>
      {state.status === "loading" && (
        <p role="status" className="text-slate-600">
          Loading project…
        </p>
      )}
      {state.status === "error" && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"
        >
          Could not load project: {state.message}
        </p>
      )}
      {state.status === "not_found" && (
        <p role="alert" className="text-slate-700">
          Project not found.
        </p>
      )}
      {state.status === "ready" && (
        <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">{state.project.title}</h1>
          <p className="mt-3 whitespace-pre-wrap text-slate-700">
            {state.project.description}
          </p>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-slate-500">GitHub repository</dt>
            <dd className="break-all">{state.project.repoUrl}</dd>
            <dt className="text-slate-500">Duration</dt>
            <dd>{state.project.durationWeeks} weeks</dd>
            <dt className="text-slate-500">Created</dt>
            <dd>{new Date(state.project.createdAt).toLocaleString()}</dd>
          </dl>
        </article>
      )}
    </div>
  );
}
