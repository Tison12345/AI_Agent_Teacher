"use client";

import { useState } from "react";
import { fetchRepoInfo } from "@/lib/api/client";
import type { RepoInfo } from "@/lib/schemas/repo-info";

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
      <h2 id="repo-heading" className="text-lg font-semibold">
        GitHub repository
      </h2>

      <button
        type="button"
        onClick={check}
        disabled={state.status === "loading"}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state.status === "loading" ? "Checking…" : "Check repository"}
      </button>

      {state.status === "error" && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
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
    <div role="status" className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <dl className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <dt className="text-slate-500">Repository</dt>
        <dd>
          <a href={repository.htmlUrl} className="text-indigo-700 hover:underline" target="_blank" rel="noreferrer">
            {repository.fullName}
          </a>{" "}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            {repository.isPrivate ? "Private" : "Public"}
          </span>
          {repository.archived && (
            <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">Archived</span>
          )}
        </dd>
        <dt className="text-slate-500">Default branch</dt>
        <dd>{repository.defaultBranch}</dd>
        <dt className="text-slate-500">Latest commit</dt>
        <dd>
          {info.isEmpty || !head ? (
            <span className="text-amber-800">No commits yet. Push some work first.</span>
          ) : (
            <>
              <code className="rounded bg-slate-100 px-1">{head.sha.slice(0, 7)}</code> {head.message}
            </>
          )}
        </dd>
      </dl>
      {info.rateLimit && (
        <p className="mt-3 text-xs text-slate-500">
          GitHub requests left this hour: {info.rateLimit.remaining} of {info.rateLimit.limit}
          {info.authenticated ? " (server token in use)" : " (no server token configured)"}.
        </p>
      )}
    </div>
  );
}
