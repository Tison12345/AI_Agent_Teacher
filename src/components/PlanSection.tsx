"use client";

import { useEffect, useState } from "react";
import { fetchPlan, generatePlan } from "@/lib/api/client";
import type { StoredPlan } from "@/lib/schemas/weekly-plan";

type State =
  | { status: "loading" }
  | { status: "load_error"; message: string }
  | { status: "empty" }
  | { status: "generating" }
  | { status: "generate_error"; message: string }
  | { status: "ready"; plan: StoredPlan };

export function PlanSection({ projectId, durationWeeks }: { projectId: string; durationWeeks: number }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchPlan(projectId).then(
      (plan) => {
        if (!cancelled) setState(plan ? { status: "ready", plan } : { status: "empty" });
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({
          status: "load_error",
          message: error instanceof Error ? error.message : "Could not load the plan.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, attempt]);

  async function handleGenerate() {
    if (state.status === "generating") return;
    setState({ status: "generating" });
    try {
      setState({ status: "ready", plan: await generatePlan(projectId) });
    } catch (error) {
      setState({
        status: "generate_error",
        message: error instanceof Error ? error.message : "Could not generate the plan.",
      });
    }
  }

  function reload() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  return (
    <section aria-labelledby="plan-heading" className="space-y-3">
      <h2 id="plan-heading" className="text-lg font-semibold">
        {durationWeeks}-week plan
      </h2>

      {state.status === "loading" && (
        <p role="status" className="text-slate-600">
          Loading plan…
        </p>
      )}

      {state.status === "load_error" && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p>Could not load the plan: {state.message}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-2 rounded-md border border-red-400 px-3 py-1 font-medium hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      )}

      {(state.status === "empty" || state.status === "generate_error") && (
        <div className="space-y-3 rounded-lg border border-dashed border-slate-300 bg-white p-6">
          <p className="text-slate-600">
            No plan yet. Generate a {durationWeeks}-week plan from your project description.
          </p>
          {state.status === "generate_error" && (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              {state.message}
            </p>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            {state.status === "generate_error" ? "Try again" : "Generate plan"}
          </button>
        </div>
      )}

      {state.status === "generating" && (
        <div role="status" className="rounded-lg border border-slate-200 bg-white p-6 text-slate-700">
          Generating your plan with Gemini… this can take up to a minute.
        </div>
      )}

      {state.status === "ready" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            AI-generated with {state.plan.model} on{" "}
            {new Date(state.plan.generatedAt).toLocaleString()}. Review it before relying on it.
          </p>
          <ol className="space-y-2">
            {state.plan.plan.map((week) => (
              <li key={week.weekNumber}>
                <details className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <summary className="cursor-pointer font-medium">
                    Week {week.weekNumber}: {week.title}
                  </summary>
                  <div className="mt-3 space-y-3 text-sm">
                    <PlanList title="Goal" items={week.objectives} />
                    <PlanList title="Tasks" items={week.tasks} />
                    <PlanList title="Expected result" items={week.deliverables} />
                    <div>
                      <h3 className="font-medium text-slate-800">How it will be evaluated</h3>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
                        {week.evaluationCriteria.map((c) => (
                          <li key={c.name}>
                            <span className="font-medium">{c.name}</span> ({c.maxPoints} pts):{" "}
                            {c.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function PlanList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="font-medium text-slate-800">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
