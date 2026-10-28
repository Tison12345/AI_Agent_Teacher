// @vitest-environment node
// Live test of the workflow foundation against the real Supabase Postgres, connecting as the restricted
// `langgraph_app` role through the pooler (DATABASE_URL). Needs migration 0009, the role's password in
// DATABASE_URL and Supabase's CA certificate (certs/supabase-ca.crt). Skipped when DATABASE_URL is not set.
// It prints no credentials. Run with `npm run test:live`.
// Every database round trip crosses the internet, so timeouts are generous. The role allows 5 connections in
// all: one shared pool serves most tests, and the restart tests briefly use one more small pool.
import { Command } from "@langchain/langgraph";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHelloGraph, interruptsOf, newCounters } from "@/test/hello-graph";
import { FencedPostgresSaver } from "./checkpointer";
import { createWorkflowPool } from "./db";
import { LeaseHeldError, NoLeaseError, pgLeaseStore, runWithLease, type LeaseOptions } from "./lease";

const configured = Boolean(process.env.DATABASE_URL);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const uuid = () => crypto.randomUUID();
const until = async (condition: () => boolean, ms = 30_000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for the run to start");
    await sleep(50);
  }
};

let main: Pool;
const extra: Pool[] = [];
const extraPool = () => {
  const pool = createWorkflowPool({ max: 2 });
  extra.push(pool);
  return pool;
};
const closeExtra = async () => {
  await Promise.all(extra.splice(0).map((pool) => pool.end().catch(() => {})));
};

const options = (pool: Pool): LeaseOptions => ({ store: pgLeaseStore(pool), heartbeatMs: 1_000, selfAbortMs: 8_000, runDeadlineMs: 90_000 });
const config = (thread: string, signal?: AbortSignal) => ({ configurable: { thread_id: thread }, durability: "sync" as const, signal });
const threads: string[] = [];
const newThread = () => {
  const thread = `submission:${uuid()}`;
  threads.push(thread);
  return thread;
};

describe.skipIf(!configured)("workflow foundation (live Postgres, restricted role)", { timeout: 120_000 }, () => {
  beforeAll(() => {
    main = createWorkflowPool({ max: 2 });
  });

  // Deletes every checkpoint these tests wrote. Each thread needs its lease, so this takes a few round trips each.
  afterAll(async () => {
    await closeExtra();
    const saver = new FencedPostgresSaver(main);
    await Promise.all(threads.map((thread) => runWithLease(thread, () => saver.deleteThread(thread), options(main)).catch(() => {})));
    await main.end().catch(() => {});
  }, 120_000);

  it("connects as langgraph_app over TLS whose certificate was verified against Supabase's CA", async () => {
    const client = await main.connect();
    try {
      const { rows } = await client.query<{ role: string }>("select current_user as role");
      expect(rows[0].role).toBe("langgraph_app");
      // This is OUR connection to the pooler (pg_stat_ssl would describe the pooler's own hop to Postgres).
      const socket = (client as unknown as { connection: { stream: { encrypted?: boolean; authorized?: boolean } } }).connection.stream;
      expect(socket.encrypted).toBe(true);
      expect(socket.authorized).toBe(true);
    } finally {
      client.release();
    }
  });

  describe("the role's privileges", () => {
    const denied = async (sql: string) => {
      await expect(main.query(sql)).rejects.toMatchObject({ message: expect.stringMatching(/permission denied|must be owner|cannot set role|not allowed/i) });
    };

    it("cannot read or change the application's tables or other schemas", async () => {
      await denied("select 1 from public.submissions limit 1");
      await denied("select 1 from public.projects limit 1");
      await denied("select 1 from public.evaluations limit 1");
      await denied("select 1 from public.student_submissions limit 1");
      await denied("select 1 from auth.users limit 1");
      await denied("select 1 from storage.objects limit 1");
      await denied("update public.projects set id = id");
      await denied("delete from public.assignments");
    });

    it("cannot create objects, escalate, or touch what the saver does not need", async () => {
      await denied("create table public.langgraph_probe (a int)");
      await denied("create table langgraph.probe (a int)");
      await denied("create schema langgraph_probe");
      await denied("set role postgres");
      await denied("select 1 from langgraph.checkpoint_migrations");
      await denied("update langgraph.checkpoint_blobs set type = type");
      await denied("insert into langgraph.run_leases (thread_id, holder, expires_at) values ('submission:00000000-0000-4000-8000-000000000000', gen_random_uuid(), now())");
      await denied("update langgraph.run_leases set expires_at = now()");
      await denied("delete from langgraph.run_leases");
    });

    it("can read the leases and use the three lease functions", async () => {
      await expect(main.query("select count(*) from langgraph.run_leases")).resolves.toBeTruthy();
      const thread = newThread();
      const holder = uuid();
      expect((await main.query("select langgraph.claim_run($1, $2, 10) as ok", [thread, holder])).rows[0].ok).toBe(true);
      expect((await main.query("select langgraph.release_run($1, $2) as ok", [thread, holder])).rows[0].ok).toBe(true);
    });
  });

  describe("leases", () => {
    it("20 simultaneous claims for one thread: exactly one wins", async () => {
      const store = pgLeaseStore(main);
      const thread = newThread();
      const holders = Array.from({ length: 20 }, uuid);
      const results = await Promise.all(holders.map((holder) => store.claim(thread, holder, 30)));
      expect(results.filter(Boolean)).toHaveLength(1);
      const winner = holders[results.indexOf(true)];
      const other = holders.find((h) => h !== winner)!;
      expect(await store.renew(thread, other, 30)).toBe(false); // a non-holder cannot renew
      expect(await store.release(thread, other)).toBe(false); // or release
      expect(await store.renew(thread, winner, 30)).toBe(true);
      expect(await store.release(thread, winner)).toBe(true);
      expect(await store.claim(thread, uuid(), 30)).toBe(true); // free again (released by its holder)
    });

    it("a second run of the same thread is refused while the first is running", async () => {
      const thread = newThread();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let started = false;
      const first = runWithLease(thread, async () => { started = true; await gate; }, options(main));
      await until(() => started);
      await expect(runWithLease(thread, async () => "second", options(main))).rejects.toBeInstanceOf(LeaseHeldError);
      release();
      await first;
      await expect(runWithLease(thread, async () => "third", options(main))).resolves.toBe("third");
    });

    it("an expired lease can be taken over, and the old holder can no longer renew it", { timeout: 60_000 }, async () => {
      const store = pgLeaseStore(main);
      const thread = newThread();
      const oldHolder = uuid();
      const newHolder = uuid();
      expect(await store.claim(thread, oldHolder, 10)).toBe(true);
      expect(await store.claim(thread, newHolder, 10)).toBe(false); // still valid
      await sleep(10_500);
      expect(await store.renew(thread, oldHolder, 10)).toBe(false); // strict: an expired lease cannot be revived
      expect(await store.claim(thread, newHolder, 10)).toBe(true);
      expect(await store.renew(thread, oldHolder, 10)).toBe(false); // and the old holder is out for good
      expect(await store.release(thread, newHolder)).toBe(true);
    });

    it("the heartbeat keeps a long run's lease alive past its own length", { timeout: 60_000 }, async () => {
      const store = pgLeaseStore(main);
      const thread = newThread();
      // A 10-second lease renewed every second survives a 12-second run; another process cannot claim it meanwhile.
      let started = false;
      const run = runWithLease(thread, async () => { started = true; await sleep(12_000); }, { ...options(main), leaseSeconds: 10, heartbeatMs: 1_000 });
      await until(() => started);
      await sleep(11_000);
      expect(await store.claim(thread, uuid(), 10)).toBe(false);
      await run;
    });
  });

  describe("checkpoints in Postgres", () => {
    it("a run pauses for faculty, survives a restart, and resumes where it stopped", async () => {
      const thread = newThread();

      const poolA = extraPool();
      const before = newCounters();
      const paused = await runWithLease(thread, (lease) => buildHelloGraph(new FencedPostgresSaver(poolA), before).invoke({ value: 0 }, config(thread, lease.signal)), options(poolA));
      expect(interruptsOf(paused)[0].value).toEqual({ kind: "faculty_review" });
      await closeExtra(); // the "restart": a new pool, a new saver, a new graph object

      const poolB = extraPool();
      const after = newCounters();
      const graphB = buildHelloGraph(new FencedPostgresSaver(poolB), after);
      const peek = await graphB.getState(config(thread)); // reading needs no lease
      expect(peek.next).toEqual(["await_faculty"]);
      expect(peek.values.trace).toEqual(["prepare#1", "work#1"]);

      const done = await runWithLease(thread, (lease) => graphB.invoke(new Command({ resume: "approved" }), config(thread, lease.signal)), options(poolB));
      expect(done.decision).toBe("approved");
      expect(done.trace).toEqual(["prepare#1", "work#1", "decided#1"]);
      expect(after.prepare).toBe(0);
      expect(after.work).toBe(0);
      expect((await graphB.getState(config(thread))).next).toEqual([]);
      const history = [];
      for await (const snapshot of graphB.getStateHistory(config(thread))) history.push(snapshot);
      expect(history.length).toBeGreaterThan(3);
      await closeExtra();
    });

    it("after a failure (and a restart), the run continues from the node that failed, not from the start", async () => {
      const thread = newThread();
      const poolA = extraPool();
      const first = newCounters();
      const graphA = buildHelloGraph(new FencedPostgresSaver(poolA), first, { failWorkOnce: true });
      await expect(runWithLease(thread, (lease) => graphA.invoke({ value: 0 }, config(thread, lease.signal)), options(poolA))).rejects.toThrow("boom");
      await closeExtra();

      const poolB = extraPool();
      const second = newCounters();
      const graphB = buildHelloGraph(new FencedPostgresSaver(poolB), second);
      expect((await graphB.getState(config(thread))).next).toEqual(["work"]);
      const paused = await runWithLease(thread, (lease) => graphB.invoke(null, config(thread, lease.signal)), options(poolB));
      expect(interruptsOf(paused)).toHaveLength(1);
      expect(second.prepare).toBe(0); // not re-run
      expect(second.work).toBe(1); // only the failed node
      await closeExtra();
    });

    it("refuses to write checkpoints without holding the lease", async () => {
      const thread = newThread();
      const graph = buildHelloGraph(new FencedPostgresSaver(main), newCounters());
      await expect(graph.invoke({ value: 0 }, config(thread))).rejects.toBeInstanceOf(NoLeaseError);
      expect((await graph.getState(config(thread))).next).toEqual([]); // nothing was saved
    });

    it("a run that loses its lease mid-way stops, and writes no further checkpoints", { timeout: 90_000 }, async () => {
      const thread = newThread();
      const counters = newCounters();
      const graph = buildHelloGraph(new FencedPostgresSaver(main), counters, { workDelayMs: 40_000 });
      let holder = "";
      const run = runWithLease(
        thread,
        async (lease) => {
          holder = lease.holder;
          return graph.invoke({ value: 0 }, config(thread, lease.signal));
        },
        { ...options(main), leaseSeconds: 30, heartbeatMs: 500 },
      );
      run.catch(() => {}); // asserted below; avoids a spurious unhandled rejection while we simulate the takeover
      await until(() => counters.work > 0 && holder !== ""); // the run is now inside the long 'work' node
      // Simulate a takeover, as after an expiry: the lease is released and claimed by someone else.
      const intruder = uuid();
      await main.query("select langgraph.release_run($1, $2)", [thread, holder]);
      expect((await main.query("select langgraph.claim_run($1, $2, 60) as ok", [thread, intruder])).rows[0].ok).toBe(true);
      await expect(run).rejects.toThrow(/lost its lease/);
      await main.query("select langgraph.release_run($1, $2)", [thread, intruder]);
      const after = await buildHelloGraph(new FencedPostgresSaver(main), newCounters()).getState(config(thread));
      expect(after.next).toEqual(["work"]); // stopped inside 'work'; nothing after it was saved
      expect(counters.review).toBe(0);
    });
  });
});
