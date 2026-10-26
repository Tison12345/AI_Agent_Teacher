"use client";

import { useState } from "react";
import { fetchRepoInfo } from "@/lib/api/client";
import type { RepoInfo } from "@/lib/schemas/repo-info";
import { Icon } from "./ui";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; info: RepoInfo };

export function RepoSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function check() {
    if (state.status === "loading") return;
    setState({ status: "loading" });
    try {
      setState({ status: "ready", info: await fetchRepoInfo(projectId) });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not reach GitHub.",
      });
    }
  }

  return (
    <section aria-labelledby="repo-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="repo-heading" className="text-xl font-semibold">
          GitHub repository
        </h2>
        <button type="button" onClick={check} disabled={state.status === "loading"} className="btn-secondary">
          <Icon name="repo" className="h-4 w-4" />
          {state.status === "loading" ? "Checking…" : "Check repository"}
        </button>
      </div>

      {state.status === "error" && (
        <p role="alert" className="alert-danger">
          {state.message}
        </p>
      )}

      {state.status === "ready" && <RepoDetails info={state.info} />}
    </section>
  );
}

function RepoDetails({ info }: { info: RepoInfo }) {
  const { repository, head } = info;
  return (
    <div role="status" className="card p-5 text-sm">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted">Repository</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <a href={repository.htmlUrl} className="font-medium text-link hover:underline" target="_blank" rel="noreferrer">
            {repository.fullName}
          </a>
          <span className="badge-neutral">{repository.isPrivate ? "Private" : "Public"}</span>
          {repository.archived && <span className="badge-warning">Archived</span>}
        </dd>
        <dt className="text-muted">Default branch</dt>
        <dd>{repository.defaultBranch}</dd>
        <dt className="text-muted">Latest commit</dt>
        <dd>
          {info.isEmpty || !head ? (
            <span className="text-warning">No commits yet. Push some work first.</span>
          ) : (
            <>
              <code className="rounded-md bg-canvas/70 px-1.5 py-0.5 font-mono text-xs">{head.sha.slice(0, 7)}</code> {head.message}
            </>
          )}
        </dd>
      </dl>
      {info.rateLimit && (
        <p className="mt-3 text-xs text-muted">
          GitHub requests left this hour: {info.rateLimit.remaining} of {info.rateLimit.limit}
          {info.authenticated ? " (server token in use)" : " (no server token configured)"}.
        </p>
      )}
    </div>
  );
}
