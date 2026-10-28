// A tiny graph used only by tests to prove the LangGraph behaviour the workflows rely on: typed state with a
// reducer, a pause for a human (interrupt) and resume, and re-running only the node that failed.
import { END, interrupt, ReducedValue, START, StateGraph, StateSchema, type BaseCheckpointSaver } from "@langchain/langgraph";
import { z } from "zod";

export const HelloState = new StateSchema({
  value: z.number().default(0),
  decision: z.string().nullable().default(null),
  /** Append-only, and keyed so that a node re-run after a crash cannot add its entry twice. */
  trace: new ReducedValue(z.array(z.string()).default(() => []), {
    reducer: (current, next) => [...current, ...next.filter((entry) => !current.includes(entry))],
  }),
});

/** The pending human-step payloads on the result of invoke(), which is where LangGraph reports a pause. */
export const interruptsOf = (result: unknown): { value: unknown }[] => (result as { __interrupt__?: { value: unknown }[] }).__interrupt__ ?? [];

export type Counters ={ prepare: number; work: number; review: number };
export const newCounters = (): Counters => ({ prepare: 0, work: 0, review: 0 });

export function buildHelloGraph(saver: BaseCheckpointSaver, counters: Counters, options: { failWorkOnce?: boolean; workTimeoutMs?: number; workDelayMs?: number } = {}) {
  return new StateGraph(HelloState)
    .addNode("prepare", () => {
      counters.prepare += 1;
      return { value: 1, trace: ["prepare#1"] };
    })
    .addNode(
      "work",
      async (_state, config) => {
        counters.work += 1;
        if (options.failWorkOnce && counters.work === 1) throw new Error("boom");
        if (options.workDelayMs) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, options.workDelayMs);
            config?.signal?.addEventListener("abort", () => (clearTimeout(timer), reject(config.signal?.reason)), { once: true });
          });
        }
        return { value: 2, trace: ["work#1"] };
      },
      options.workTimeoutMs ? { timeout: options.workTimeoutMs } : undefined,
    )
    .addNode("await_faculty", () => {
      counters.review += 1;
      // Everything before interrupt() runs again on resume, so it must have no side effects.
      const answer = interrupt({ kind: "faculty_review" });
      return { decision: String(answer), trace: ["decided#1"] };
    })
    .addEdge(START, "prepare")
    .addEdge("prepare", "work")
    .addEdge("work", "await_faculty")
    .addEdge("await_faculty", END)
    .compile({ checkpointer: saver });
}
