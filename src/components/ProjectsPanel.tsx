"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProjectForm, type ProjectSubmitResult } from "@/components/ProjectForm";
import { Icon, ProgressBar, StatCard } from "@/components/ui";
import { createProject, fetchProgress, fetchProjects, fetchResults } from "@/lib/api/client";
import { repoName, summarizeProject, summarizeStudent, type ProjectSummary } from "@/lib/dashboard/summary";
import type { Project } from "@/lib/schemas/project";
import type { ProjectFormValues } from "@/lib/validation/project";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; projects: Project[] };

/** What is known about one project's progress: loading, failed on its own, or summarised. */
type Detail = { status: "loading" } | { status: "error" } | { status: "ready"; summary: ProjectSummary };

/**
 * One project's summary. Official results are only requested once a teacher has decided a week;
 * if they were needed and cannot be fetched this fails, so the project is never shown as ungraded
 * when it may not be.
 */
async function load(project: Project): Promise<ProjectSummary> {
  const progress = await fetchProgress(project.id);
  const decided = progress.evaluations.some((e) => e.status !== "pending_review");
  const results = decided ? await fetchResults(project.id) : [];
  return summarizeProject(project, progress, results);
}

export function ProjectsPanel() {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState<boolean | null>(null);

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
          message: error instanceof Error ? error.message : "Could not load projects.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Each project's progress and official results, loaded independently so one failure
  // never hides the others. Results are only requested once a teacher has decided a week.
  const projectKey = list.status === "ready" ? list.projects.map((p) => p.id).join(",") : "";
  useEffect(() => {
    if (list.status !== "ready") return;
    let cancelled = false;
    for (const project of list.projects) {
      load(project).then(
        (summary) => {
          if (!cancelled) setDetails((d) => ({ ...d, [project.id]: { status: "ready", summary } }));
        },
        () => {
          if (!cancelled) setDetails((d) => ({ ...d, [project.id]: { status: "error" } }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
    // The list only changes when the set of project ids does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  function retry() {
    setList({ status: "loading" });
    setDetails({});
    setAttempt((n) => n + 1);
  }

  async function handleCreate(values: ProjectFormValues): Promise<ProjectSubmitResult> {
    const { result, project } = await createProject(values);
    if (result.ok && project) {
      setList((prev) =>
        prev.status === "ready" ? { status: "ready", projects: [project, ...prev.projects] } : prev,
      );
      if (list.status !== "ready") retry();
    }
    return result;
  }

  const projects = list.status === "ready" ? list.projects : [];
  const empty = list.status === "ready" && projects.length === 0;
  // The form is out of the way once there are projects, but is open for a first project.
  const formOpen = creating ?? empty;

  return (
    <div className="space-y-10">
      {list.status === "ready" && <Overview projects={projects} details={details} />}

      <section aria-labelledby="projects-heading" className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 id="projects-heading" className="text-xl font-semibold">
              My projects
            </h2>
            {list.status === "ready" && projects.length > 0 && (
              <span className="badge-neutral">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </span>
            )}
          </div>
          {list.status === "ready" && (
            <button
              type="button"
              aria-expanded={formOpen}
              aria-controls="create-project"
              onClick={() => setCreating(!formOpen)}
              className={formOpen ? "btn-secondary btn-sm" : "btn-primary btn-sm"}
            >
              <Icon name="plus" className={`h-4 w-4 transition-transform ${formOpen ? "rotate-45" : ""}`} />
              {formOpen ? "Close" : "Create project"}
            </button>
          )}
        </div>

        <div id="create-project" hidden={!formOpen} className="card p-6">
          <h3 className="mb-4 text-lg font-semibold">Start a new project</h3>
          <ProjectForm onSubmit={handleCreate} />
        </div>

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
        {empty && (
          <div className="card flex flex-col items-center gap-2 border-dashed p-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 text-accent">
              <Icon name="folder" className="h-6 w-6" />
            </span>
            <p className="font-medium">No projects yet</p>
            <p className="text-sm text-muted">Create your first project to start recording weeks.</p>
          </div>
        )}
        {list.status === "ready" && projects.length > 0 && (
          <ul className="grid gap-5 md:grid-cols-2">
            {projects.map((project) => (
              <li key={project.id} className="min-w-0">
                <ProjectCard project={project} detail={details[project.id] ?? { status: "loading" }} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The numbers across every project, worked out only from projects whose progress loaded. */
function Overview({ projects, details }: { projects: Project[]; details: Record<string, Detail> }) {
  const loaded = projects.flatMap((p) => {
    const d = details[p.id];
    return d?.status === "ready" ? [d.summary] : [];
  });
  const failed = projects.filter((p) => details[p.id]?.status === "error").length;
  const loading = projects.length - loaded.length - failed;
  const totals = summarizeStudent(loaded);
  const value = (n: number) => (loading > 0 ? "…" : n);

  return (
    <section aria-labelledby="overview-heading" className="space-y-4">
      <h2 id="overview-heading" className="sr-only">
        Overview
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon="folder" label="Total projects" value={projects.length} hint="created by you" />
        <StatCard
          icon="chart"
          label="Average official score"
          value={loading > 0 ? "…" : totals.average === null ? "–" : totals.average}
          hint={
            totals.average === null
              ? "No approved weeks yet"
              : `across ${totals.scoredWeeks} teacher-approved ${totals.scoredWeeks === 1 ? "week" : "weeks"}`
          }
        />
        <StatCard
          icon="repo"
          label="Weeks recorded"
          value={value(totals.recorded)}
          hint={totals.totalWeeks === 0 ? "No weeks planned yet" : `of ${totals.totalWeeks} planned`}
        />
        <StatCard icon="clock" label="Awaiting review" value={value(totals.pendingReview)} hint="with your teacher" />
        <StatCard icon="check" label="Approved weeks" value={value(totals.approved)} hint="approved or edited" />
      </div>
      {failed > 0 && (
        <p role="alert" className="alert-warning">
          Progress could not be loaded for {failed} {failed === 1 ? "project" : "projects"}, so the totals above leave{" "}
          {failed === 1 ? "it" : "them"} out. Refresh the page to try again.
        </p>
      )}
    </section>
  );
}

function ProjectCard({ project, detail }: { project: Project; detail: Detail }) {
  return (
    <article className="card card-interactive group relative flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-lg font-semibold leading-snug">
            <Link
              href={`/student/projects/${project.id}`}
              className="text-fg after:absolute after:inset-0 after:rounded-2xl hover:text-link"
            >
              {project.title}
              <span className="sr-only"> (view project)</span>
            </Link>
          </h3>
          <p className="line-clamp-2 text-sm text-muted">{project.description}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-link" aria-hidden="true">
          View
          <Icon name="arrow" className="h-4 w-4 transition duration-150 group-hover:translate-x-1" />
        </span>
      </div>

      <p className="flex flex-wrap items-center gap-2">
        <span className="badge-neutral">
          <Icon name="repo" className="h-3.5 w-3.5" />
          <span className="max-w-[16rem] truncate">{repoName(project.repoUrl)}</span>
        </span>
        <span className="badge-neutral">
          {project.durationWeeks} {project.durationWeeks === 1 ? "week" : "weeks"}
        </span>
      </p>

      {detail.status === "loading" && (
        <p role="status" className="mt-auto text-sm text-muted">
          Loading progress…
        </p>
      )}
      {detail.status === "error" && (
        <p className="mt-auto text-sm text-muted">Progress could not be loaded. Open the project to see it.</p>
      )}
      {detail.status === "ready" && <CardNumbers summary={detail.summary} title={project.title} />}
    </article>
  );
}

function CardNumbers({ summary, title }: { summary: ProjectSummary; title: string }) {
  const { average, recorded, durationWeeks } = summary;
  return (
    <div className="mt-auto space-y-4 border-t border-line pt-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Overall official score</p>
          {average === null ? (
            <p className="mt-1 text-lg font-semibold text-muted">Not graded yet</p>
          ) : (
            <p className="mt-0.5 flex items-baseline gap-1" aria-label={`${title} overall official score ${average} out of 100`}>
              <span className="text-4xl font-bold tabular-nums tracking-tight">{average}</span>
              <span className="text-base font-medium text-muted">/100</span>
            </p>
          )}
        </div>
        <p className="text-right text-sm text-muted">
          <span className="text-lg font-semibold tabular-nums text-fg">{recorded}</span> of {durationWeeks}{" "}
          {durationWeeks === 1 ? "week" : "weeks"} recorded
        </p>
      </div>
      <ProgressBar percent={(recorded / durationWeeks) * 100} label={`${title}: weeks recorded`} />
      <p className="flex flex-wrap gap-2">
        <span className="badge-success">{summary.approved} approved</span>
        <span className="badge-warning">{summary.pendingReview} pending review</span>
        <span className="badge-neutral">{summary.unrecorded} not recorded</span>
      </p>
    </div>
  );
}
