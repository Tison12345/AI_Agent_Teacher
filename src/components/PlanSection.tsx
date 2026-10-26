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
      <h2 id="plan-heading" className="text-xl font-semibold">
        {durationWeeks}-week plan
      </h2>

      {state.status === "loading" && (
        <p role="status" className="text-muted">
          Loading plan…
        </p>
      )}

      {state.status === "load_error" && (
        <div role="alert" className="alert-danger">
          <p>Could not load the plan: {state.message}</p>
          <button type="button" onClick={reload} className="btn-secondary btn-sm mt-3">
            Try again
          </button>
        </div>
      )}

      {(state.status === "empty" || state.status === "generate_error") && (
        <div className="card space-y-4 border-dashed p-6">
          <p className="text-muted">
            No plan yet. Generate a {durationWeeks}-week plan from your project description.
          </p>
          {state.status === "generate_error" && (
            <p role="alert" className="alert-danger">
              {state.message}
            </p>
          )}
          <button type="button" onClick={handleGenerate} className="btn-primary">
            {state.status === "generate_error" ? "Try again" : "Generate plan"}
          </button>
        </div>
      )}

      {state.status === "generating" && (
        <div role="status" className="card flex items-center gap-3 p-6 text-fg">
          <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Generating your plan with Gemini… this can take up to a minute.
        </div>
      )}

      {state.status === "ready" && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            AI-generated with {state.plan.model} on{" "}
            {new Date(state.plan.generatedAt).toLocaleString()}. Review it before relying on it.
          </p>
          <ol className="space-y-2">
            {state.plan.plan.map((week) => (
              <li key={week.weekNumber}>
                <details className="card group p-4 transition duration-150 open:border-primary/40">
                  <summary className="cursor-pointer list-none font-semibold [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true" className="mr-2 inline-block text-muted transition-transform group-open:rotate-90">
                      ▸
                    </span>
                    Week {week.weekNumber}: {week.title}
                  </summary>
                  <div className="mt-3 space-y-3 text-sm">
                    <PlanList title="Goal" items={week.objectives} />
                    <PlanList title="Tasks" items={week.tasks} />
                    <PlanList title="Expected result" items={week.deliverables} />
                    <div>
                      <h3 className="eyebrow">How it will be evaluated</h3>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-fg">
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
      <h3 className="eyebrow">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-fg">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
