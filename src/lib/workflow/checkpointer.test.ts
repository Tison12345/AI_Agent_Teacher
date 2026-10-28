// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { FencedPostgresSaver } from "./checkpointer";
import { LeaseLostError, NoLeaseError, runWithLease, type LeaseStore } from "./lease";

const THREAD = "evaluation:123e4567-e89b-42d3-a456-426614174000";

/** A pool that fails the test if anything reaches the database. */
const untouchedPool = () => {
  const fail = () => {
    throw new Error("the database must not be touched");
  };
  return { connect: vi.fn(fail), query: vi.fn(fail) } as unknown as Pool & { connect: ReturnType<typeof vi.fn> };
};
const store = (over: Partial<LeaseStore> = {}): LeaseStore => ({
  claim: async () => true,
  renew: async () => true,
  release: async () => true,
  ...over,
});
const options = { heartbeatMs: 10_000, selfAbortMs: 20_000, runDeadlineMs: 5_000, freshMs: 0 }; // freshMs 0: every write asks the database

const config = { configurable: { thread_id: THREAD, checkpoint_ns: "" } };
const checkpoint = { v: 4, id: "1", ts: "2026-01-01T00:00:00.000Z", channel_values: {}, channel_versions: {}, versions_seen: {} } as never;
const metadata = { source: "loop", step: 0, parents: {} } as never;

describe("FencedPostgresSaver", () => {
  it("refuses every write made outside a run that holds the lease, before touching the database", async () => {
    const pool = untouchedPool();
    const saver = new FencedPostgresSaver(pool);
    await expect(saver.put(config, checkpoint, metadata, {})).rejects.toBeInstanceOf(NoLeaseError);
    await expect(saver.putWrites(config, [["x", 1]], "task")).rejects.toBeInstanceOf(NoLeaseError);
    await expect(saver.deleteThread(THREAD)).rejects.toBeInstanceOf(NoLeaseError);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("refuses writes for a different thread than the one the run holds", async () => {
    const pool = untouchedPool();
    const saver = new FencedPostgresSaver(pool);
    await runWithLease(THREAD, async () => {
      const other = { configurable: { thread_id: "evaluation:00000000-0000-4000-8000-000000000000", checkpoint_ns: "" } };
      await expect(saver.put(other, checkpoint, metadata, {})).rejects.toBeInstanceOf(NoLeaseError);
    }, { store: store(), ...options });
  });

  it("re-checks the lease with the database right before writing, and refuses once it is gone", async () => {
    const pool = untouchedPool();
    const saver = new FencedPostgresSaver(pool);
    const renew = vi.fn(async () => false);
    await expect(
      runWithLease(THREAD, () => saver.put(config, checkpoint, metadata, {}), { store: store({ renew }), ...options }),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(renew).toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled(); // nothing was written
  });

  it("setup() is disabled: the tables come from migration 0009", async () => {
    await expect(new FencedPostgresSaver(untouchedPool()).setup()).rejects.toThrow(/migration 0009/);
  });
});
