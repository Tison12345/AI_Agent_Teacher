// @vitest-environment node
// Proves, in memory, the LangGraph behaviour the workflows are built on (the same graph runs against Postgres in
// foundation.live.test.ts). No production code here: these tests pin down what we rely on.
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { buildHelloGraph, interruptsOf, newCounters } from "@/test/hello-graph";

const config = (id: string) => ({ configurable: { thread_id: `submission:${id}` }, durability: "sync" as const });
const ID = "123e4567-e89b-42d3-a456-426614174000";

describe("graph pause and resume (interrupt)", () => {
  it("stops at the human step, keeps its state, and finishes only when resumed", async () => {
    const saver = new MemorySaver();
    const counters = newCounters();
    const graph = buildHelloGraph(saver, counters);

    const paused = await graph.invoke({ value: 0 }, config(ID));
    expect(interruptsOf(paused)[0].value).toEqual({ kind: "faculty_review" });
    expect(paused.decision).toBeNull();

    const snapshot = await graph.getState(config(ID));
    expect(snapshot.next).toEqual(["await_faculty"]);
    expect(snapshot.tasks[0].interrupts).toHaveLength(1);
    expect(snapshot.values.trace).toEqual(["prepare#1", "work#1"]);

    const done = await graph.invoke(new Command({ resume: "approved" }), config(ID));
    expect(done.decision).toBe("approved");
    expect(done.trace).toEqual(["prepare#1", "work#1", "decided#1"]);
    expect((await graph.getState(config(ID))).next).toEqual([]);
    // Nodes before the pause did not run again; the paused node ran twice (first to pause, then to finish).
    expect(counters).toEqual({ prepare: 1, work: 1, review: 2 });
  });

  it("a fresh graph object on the same saver (a 'restart') continues from where the first one stopped", async () => {
    const saver = new MemorySaver();
    await buildHelloGraph(saver, newCounters()).invoke({ value: 0 }, config(ID));

    const afterRestart = newCounters();
    const done = await buildHelloGraph(saver, afterRestart).invoke(new Command({ resume: "edited" }), config(ID));
    expect(done.decision).toBe("edited");
    expect(afterRestart.prepare).toBe(0);
    expect(afterRestart.work).toBe(0);
  });
});

describe("recovery after a failure", () => {
  it("re-running the thread re-runs only the node that failed", async () => {
    const saver = new MemorySaver();
    const counters = newCounters();
    const graph = buildHelloGraph(saver, counters, { failWorkOnce: true });

    await expect(graph.invoke({ value: 0 }, config(ID))).rejects.toThrow("boom");
    expect(counters).toEqual({ prepare: 1, work: 1, review: 0 });
    expect((await graph.getState(config(ID))).next).toEqual(["work"]);

    const paused = await graph.invoke(null, config(ID));
    expect(interruptsOf(paused)).toHaveLength(1);
    expect(counters).toEqual({ prepare: 1, work: 2, review: 1 }); // work again, prepare not again
  });
});

describe("per-node time limit", () => {
  it("stops a node that runs too long with a timeout error", async () => {
    const graph = buildHelloGraph(new MemorySaver(), newCounters(), { workTimeoutMs: 40, workDelayMs: 2_000 });
    await expect(graph.invoke({ value: 0 }, config(ID))).rejects.toMatchObject({ name: "NodeTimeoutError" });
  });
});

describe("reducer", () => {
  it("a trace entry written twice (a re-run node) is kept once", async () => {
    const saver = new MemorySaver();
    const graph = buildHelloGraph(saver, newCounters());
    await graph.invoke({ value: 0, trace: ["prepare#1"] }, config(ID));
    const state = await graph.getState(config(ID));
    expect(state.values.trace.filter((t: string) => t === "prepare#1")).toHaveLength(1);
  });
});
