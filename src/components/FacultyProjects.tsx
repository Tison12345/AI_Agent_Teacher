import Link from "next/link";
import { average, repoName } from "@/lib/dashboard/summary";
import type { Project } from "@/lib/schemas/project";
import type { QueueItem } from "@/lib/schemas/review";
import { Icon } from "./ui";

/** One compact card per project, with its numbers worked out from that project's evaluations. */
export function FacultyProjects({ items, projects }: { items: QueueItem[]; projects: Project[] }) {
  return (
    <section aria-labelledby="projects-heading" className="space-y-4">
      <h2 id="projects-heading" className="text-xl font-semibold">
        Projects
      </h2>
      {projects.length === 0 ? (
        <p className="card border-dashed p-8 text-center text-muted">No projects have been created yet.</p>
      ) : (
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const own = items.filter((i) => i.projectId === project.id);
            const reviewed = own.filter((i) => i.status !== "pending_review").length;
            const pending = own.length - reviewed;
            const mean = average(own.flatMap((i) => (i.status !== "pending_review" && i.officialScore !== null ? [i.officialScore] : [])));
            return (
              <li key={project.id} className="min-w-0">
                <article className="card card-interactive group relative flex h-full flex-col gap-4 p-5">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold leading-snug">
                      <Link
                        href={`/faculty/projects/${project.id}`}
                        className="text-fg after:absolute after:inset-0 after:rounded-2xl hover:text-link"
                      >
                        {project.title}
                        <span className="sr-only"> (open project)</span>
                      </Link>
                    </h3>
                    <p className="flex flex-wrap gap-2">
                      <span className="badge-neutral">
                        <Icon name="repo" className="h-3.5 w-3.5" />
                        <span className="max-w-[14rem] truncate">{repoName(project.repoUrl)}</span>
                      </span>
                      <span className="badge-neutral">
                        {project.durationWeeks} {project.durationWeeks === 1 ? "week" : "weeks"}
                      </span>
                    </p>
                  </div>

                  <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-line pt-4">
                    <div>
                      <dt className="eyebrow">Avg score</dt>
                      <dd className="mt-0.5 text-2xl font-bold tabular-nums">{mean === null ? "–" : mean}</dd>
                    </div>
                    <div>
                      <dt className="eyebrow">Reviewed</dt>
                      <dd className="mt-0.5 text-2xl font-bold tabular-nums">
                        {reviewed}
                        <span className="text-sm font-medium text-muted">/{own.length}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="eyebrow">Pending</dt>
                      <dd className={`mt-0.5 text-2xl font-bold tabular-nums ${pending > 0 ? "text-warning" : ""}`}>{pending}</dd>
                    </div>
                  </dl>

                  <p className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted">
                      {own.length === 0
                        ? "No evaluated weeks yet"
                        : `${own.length} evaluated ${own.length === 1 ? "week" : "weeks"}`}
                    </span>
                    <span aria-hidden="true" className="flex items-center gap-1 font-medium text-link">
                      Open
                      <Icon name="arrow" className="h-4 w-4 transition duration-150 group-hover:translate-x-1" />
                    </span>
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
