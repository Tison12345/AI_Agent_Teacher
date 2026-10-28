// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  assertLeaseFor,
  currentLease,
  LeaseHeldError,
  LeaseLostError,
  NoLeaseError,
  pgLeaseActive,
  pgLeaseStore,
  RunDeadlineError,
  runWithLease,
  type LeaseStore,
} from "./lease";

const THREAD = "submission:123e4567-e89b-42d3-a456-426614174000";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const never = () => new Promise<never>(() => {});

function fakeStore(over: Partial<LeaseStore> = {}) {
  const base = {
    claim: vi.fn<LeaseStore["claim"]>(async () => true),
    renew: vi.fn<LeaseStore["renew"]>(async () => true),
    release: vi.fn<LeaseStore["release"]>(async () => true),
  };
  // Overrides are always vi.fn mocks in these tests, so the mock typing of the base is kept.
  return { ...base, ...over } as typeof base;
}
const fast = { heartbeatMs: 10, selfAbortMs: 60, runDeadlineMs: 2_000 };

describe("runWithLease", () => {
  it("claims the lease, runs the work, returns its result and gives the lease back", async () => {
    const store = fakeStore();
    const result = await runWithLease(THREAD, async (lease) => {
      expect(lease.threadId).toBe(THREAD);
      expect(lease.signal.aborted).toBe(false);
      return "done";
    }, { store, ...fast });
    expect(result).toBe("done");
    expect(store.claim).toHaveBeenCalledWith(THREAD, expect.any(String), 180);
    expect(store.release).toHaveBeenCalledTimes(1);
    expect(store.release.mock.calls[0][1]).toBe(store.claim.mock.calls[0][1]); // the same holder
  });

  it("gives the lease back when the work throws, and lets the error through", async () => {
    const store = fakeStore();
    await expect(runWithLease(THREAD, async () => { throw new Error("boom"); }, { store, ...fast })).rejects.toThrow("boom");
    expect(store.release).toHaveBeenCalledTimes(1);
  });

  it("refuses to run when someone else holds the lease", async () => {
    const store = fakeStore({ claim: vi.fn(async () => false) });
    const work = vi.fn();
    await expect(runWithLease(THREAD, work, { store, ...fast })).rejects.toBeInstanceOf(LeaseHeldError);
    expect(work).not.toHaveBeenCalled();
    expect(store.release).not.toHaveBeenCalled();
  });

  it("renews the lease on a heartbeat while the work runs", async () => {
    const store = fakeStore();
    await runWithLease(THREAD, () => sleep(70), { store, ...fast });
    expect(store.renew.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(store.renew).toHaveBeenCalledWith(THREAD, expect.any(String), 180);
  });

  it("stops a run whose lease was taken over, even if the work ignores the abort signal, and does not release", async () => {
    const store = fakeStore({ renew: vi.fn(async () => false) });
    let signal: AbortSignal | undefined;
    await expect(runWithLease(THREAD, (lease) => { signal = lease.signal; return never(); }, { store, ...fast })).rejects.toBeInstanceOf(LeaseLostError);
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBeInstanceOf(LeaseLostError);
    expect(store.release).not.toHaveBeenCalled(); // the lease expires by itself
  });

  it("stops itself when renewals keep failing, before the lease could be taken over", async () => {
    const store = fakeStore({ renew: vi.fn(async () => { throw new Error("database unreachable"); }) });
    const started = performance.now();
    await expect(runWithLease(THREAD, () => never(), { store, ...fast })).rejects.toThrow(/renewal overdue/);
    expect(performance.now() - started).toBeLessThan(500);
    expect(store.release).not.toHaveBeenCalled();
  });

  it("stops itself even while a renewal call hangs", async () => {
    const store = fakeStore({ renew: vi.fn(() => never()) });
    await expect(runWithLease(THREAD, () => never(), { store, ...fast })).rejects.toBeInstanceOf(LeaseLostError);
  });

  it("stops a run that exceeds its time limit, and does not release", async () => {
    const store = fakeStore();
    await expect(runWithLease(THREAD, () => never(), { store, heartbeatMs: 10, selfAbortMs: 5_000, runDeadlineMs: 40 })).rejects.toBeInstanceOf(RunDeadlineError);
    expect(store.release).not.toHaveBeenCalled();
  });

  it("assertOwned confirms with the database, and stops the run when ownership is gone", async () => {
    const slow = { heartbeatMs: 10_000, selfAbortMs: 20_000, runDeadlineMs: 5_000, freshMs: 0 }; // freshMs 0: always ask the database
    const ok = fakeStore();
    await runWithLease(THREAD, (lease) => lease.assertOwned(), { store: ok, ...slow });
    expect(ok.renew).toHaveBeenCalledTimes(1);

    const lost = fakeStore({ renew: vi.fn(async () => false) });
    let signal: AbortSignal | undefined;
    await expect(
      runWithLease(THREAD, async (lease) => { signal = lease.signal; await lease.assertOwned(); }, { store: lost, ...slow }),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(signal?.aborted).toBe(true);
  });

  it("assertOwned treats a database error as 'cannot prove ownership' and stops", async () => {
    const store = fakeStore({ renew: vi.fn(async () => { throw new Error("down"); }) });
    await expect(
      runWithLease(THREAD, (lease) => lease.assertOwned(), { store, heartbeatMs: 10_000, selfAbortMs: 20_000, runDeadlineMs: 5_000, freshMs: 0 }),
    ).rejects.toThrow(/could not confirm ownership/);
  });

  it("assertOwned does not call the database while the last renewal is fresh, and does once it is not", async () => {
    const store = fakeStore();
    await runWithLease(THREAD, async (lease) => {
      await lease.assertOwned();
      await lease.assertOwned();
      expect(store.renew).not.toHaveBeenCalled(); // the claim itself counts as the first renewal
      await sleep(60);
      await lease.assertOwned();
      expect(store.renew).toHaveBeenCalledTimes(1);
    }, { store, heartbeatMs: 10_000, selfAbortMs: 20_000, runDeadlineMs: 5_000, freshMs: 40 });
  });

  it("makes the lease available to code deeper in the same run, and to nobody else", async () => {
    expect(currentLease()).toBeUndefined();
    await runWithLease(THREAD, async (lease) => {
      await sleep(1);
      expect(currentLease()).toBe(lease);
      await Promise.resolve().then(() => expect(currentLease()?.holder).toBe(lease.holder));
    }, { store: fakeStore(), ...fast });
    expect(currentLease()).toBeUndefined();
  });
});

describe("assertLeaseFor", () => {
  it("rejects code that is not part of a run, or part of a run for another thread", async () => {
    await expect(assertLeaseFor(THREAD)).rejects.toBeInstanceOf(NoLeaseError);
    await runWithLease(THREAD, async () => {
      await expect(assertLeaseFor("submission:00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(NoLeaseError);
      await expect(assertLeaseFor(undefined)).rejects.toBeInstanceOf(NoLeaseError);
      await expect(assertLeaseFor(THREAD)).resolves.toBeUndefined();
    }, { store: fakeStore(), ...fast });
  });
});

describe("pgLeaseStore", () => {
  it("calls the three database functions with the thread, holder and seconds, and reads their boolean", async () => {
    const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: { ok: boolean }[] }>>(async () => ({ rows: [{ ok: true }] }));
    const store = pgLeaseStore({ query } as never);
    expect(await store.claim(THREAD, "h", 180)).toBe(true);
    expect(await store.renew(THREAD, "h", 180)).toBe(true);
    expect(await store.release(THREAD, "h")).toBe(true);
    expect(query.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "select langgraph.claim_run($1, $2, $3) as ok",
      "select langgraph.renew_run($1, $2, $3) as ok",
      "select langgraph.release_run($1, $2) as ok",
    ]);
    expect(query.mock.calls[0][1]).toEqual([THREAD, "h", 180]);
  });

  it("treats anything but true as 'not granted'", async () => {
    const store = pgLeaseStore({ query: vi.fn(async () => ({ rows: [{ ok: false }] })) } as never);
    expect(await store.claim(THREAD, "h", 180)).toBe(false);
    expect(await pgLeaseStore({ query: vi.fn(async () => ({ rows: [] })) } as never).renew(THREAD, "h", 180)).toBe(false);
  });
});

describe("pgLeaseActive", () => {
  it("asks the database, with its own clock, whether an unexpired lease exists for the thread", async () => {
    const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rowCount: number }>>(async () => ({ rowCount: 1 }));
    expect(await pgLeaseActive({ query } as never)(THREAD)).toBe(true);
    expect(query.mock.calls[0][0]).toBe("select 1 from langgraph.run_leases where thread_id = $1 and expires_at > now()");
    expect(query.mock.calls[0][1]).toEqual([THREAD]);
    expect(await pgLeaseActive({ query: vi.fn(async () => ({ rowCount: 0 })) } as never)(THREAD)).toBe(false);
  });
});
