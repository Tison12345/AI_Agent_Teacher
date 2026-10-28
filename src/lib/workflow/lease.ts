import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool } from "pg";

/*
 * Run leases: at most one process runs a workflow thread at a time (migration 0009, langgraph.run_leases).
 * The database decides, with its own clock. A run that cannot prove it still owns its lease stops by itself:
 *  - a heartbeat renews the lease every HEARTBEAT_MS;
 *  - if no renewal has succeeded for SELF_ABORT_MS (60 s before the lease could be taken over), or a renewal
 *    says the lease is gone, the run aborts (and its AbortSignal stops Gemini, GitHub and extractor calls);
 *  - a whole run is capped at RUN_DEADLINE_MS.
 * An aborted run does NOT release its lease: it expires by itself, so nobody can start the same work while the
 * old code might still be running.
 */
export const LEASE_SECONDS = 180;
export const HEARTBEAT_MS = 30_000;
export const SELF_ABORT_MS = 120_000;
export const RUN_DEADLINE_MS = 10 * 60_000;
/**
 * assertOwned() skips the database call when a renewal succeeded this recently. Nobody can take a lease until
 * LEASE_SECONDS after its last renewal, so within 60 s of a successful renewal the run still owns it.
 * Once the heartbeat has stalled for longer, every check goes to the database.
 */
export const FRESH_MS = 60_000;

/** The lease operations. The Postgres version calls the functions from migration 0009; tests use a fake. */
export type LeaseStore = {
  claim(threadId: string, holder: string, seconds: number): Promise<boolean>;
  renew(threadId: string, holder: string, seconds: number): Promise<boolean>;
  release(threadId: string, holder: string): Promise<boolean>;
};

export function pgLeaseStore(pool: Pick<Pool, "query">): LeaseStore {
  const ok = async (sql: string, params: unknown[]) => {
    const result = await pool.query<{ ok: boolean }>(sql, params);
    return result.rows[0]?.ok === true;
  };
  return {
    claim: (threadId, holder, seconds) => ok("select langgraph.claim_run($1, $2, $3) as ok", [threadId, holder, seconds]),
    renew: (threadId, holder, seconds) => ok("select langgraph.renew_run($1, $2, $3) as ok", [threadId, holder, seconds]),
    release: (threadId, holder) => ok("select langgraph.release_run($1, $2) as ok", [threadId, holder]),
  };
}

/** True while some process holds an unexpired lease on the thread. Reads only (the role may select run_leases). */
export function pgLeaseActive(pool: Pick<Pool, "query">): (threadId: string) => Promise<boolean> {
  return async (threadId) => {
    const result = await pool.query("select 1 from langgraph.run_leases where thread_id = $1 and expires_at > now()", [threadId]);
    return (result.rowCount ?? 0) > 0;
  };
}

/** Someone else is already running this workflow. */
export class LeaseHeldError extends Error {
  constructor() {
    super("This workflow is already running.");
    this.name = "LeaseHeldError";
  }
}

/** The run could no longer prove it owned its lease, so it was stopped. */
export class LeaseLostError extends Error {
  constructor(reason: string) {
    super(`The run lost its lease (${reason}) and was stopped.`);
    this.name = "LeaseLostError";
  }
}

export class RunDeadlineError extends Error {
  constructor() {
    super("The run took longer than its time limit and was stopped.");
    this.name = "RunDeadlineError";
  }
}

/** Something tried to write workflow state without holding the run's lease. */
export class NoLeaseError extends Error {
  constructor() {
    super("Workflow state can only be written by the run that holds its lease.");
    this.name = "NoLeaseError";
  }
}

export type LeaseContext = {
  threadId: string;
  holder: string;
  /** Aborted when the lease is lost or the run's time limit passes. Pass it to every network call. */
  signal: AbortSignal;
  /** Confirms with the database that this run still owns its lease (and extends it); throws if not. */
  assertOwned(): Promise<void>;
};

export type LeaseOptions = {
  store: LeaseStore;
  leaseSeconds?: number;
  heartbeatMs?: number;
  selfAbortMs?: number;
  runDeadlineMs?: number;
  /** How recent a successful renewal must be for assertOwned() to trust it without asking the database. */
  freshMs?: number;
  /** A monotonic clock in milliseconds. */
  now?: () => number;
};

const leaseStorage = new AsyncLocalStorage<LeaseContext>();

/** The lease of the run this code is part of, if any. */
export const currentLease = (): LeaseContext | undefined => leaseStorage.getStore();

/** Checks that the code is part of the run that holds `threadId`'s lease, and that the lease is still ours. */
export async function assertLeaseFor(threadId: string | undefined): Promise<void> {
  const lease = leaseStorage.getStore();
  if (!lease || !threadId || lease.threadId !== threadId) throw new NoLeaseError();
  await lease.assertOwned();
}

/**
 * Runs `fn` as the only runner of `threadId`. Throws LeaseHeldError when someone else has it, and rejects with
 * LeaseLostError or RunDeadlineError (without waiting for `fn`) when the run must stop.
 */
export async function runWithLease<T>(threadId: string, fn: (lease: LeaseContext) => Promise<T>, options: LeaseOptions): Promise<T> {
  const { store } = options;
  const leaseSeconds = options.leaseSeconds ?? LEASE_SECONDS;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const selfAbortMs = options.selfAbortMs ?? SELF_ABORT_MS;
  const runDeadlineMs = options.runDeadlineMs ?? RUN_DEADLINE_MS;
  const freshMs = options.freshMs ?? FRESH_MS;
  const now = options.now ?? (() => performance.now());

  const holder = crypto.randomUUID();
  if (!(await store.claim(threadId, holder, leaseSeconds))) throw new LeaseHeldError();

  const controller = new AbortController();
  const abort = (reason: Error) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  let lastRenewOk = now();
  let renewing = false;

  const renew = async (): Promise<boolean> => {
    const ok = await store.renew(threadId, holder, leaseSeconds);
    if (ok) lastRenewOk = now();
    return ok;
  };

  const heartbeat = setInterval(() => {
    // Checked on every tick, even while a renewal is still in flight: a hung database call cannot keep us running.
    if (now() - lastRenewOk > selfAbortMs) return abort(new LeaseLostError("renewal overdue"));
    if (renewing) return;
    renewing = true;
    renew()
      .then(
        (ok) => {
          if (!ok) abort(new LeaseLostError("taken over or expired"));
        },
        () => {
          /* a transient failure: the overdue check above stops the run in time if it persists */
        },
      )
      .finally(() => {
        renewing = false;
      });
  }, heartbeatMs);
  const deadline = setTimeout(() => abort(new RunDeadlineError()), runDeadlineMs);

  const ctx: LeaseContext = {
    threadId,
    holder,
    signal: controller.signal,
    async assertOwned() {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (now() - lastRenewOk < freshMs) return; // renewed recently: the lease cannot have been taken over yet
      let ok = false;
      try {
        ok = await renew();
      } catch {
        // Cannot prove ownership: stop rather than guess.
        const error = new LeaseLostError("could not confirm ownership");
        abort(error);
        throw error;
      }
      if (!ok) {
        const error = new LeaseLostError("taken over or expired");
        abort(error);
        throw error;
      }
    },
  };

  const stopped = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  stopped.catch(() => {});
  const work = leaseStorage.run(ctx, () => fn(ctx));
  work.catch(() => {}); // a late failure after the run was stopped must not become an unhandled rejection

  try {
    return await Promise.race([work, stopped]);
  } finally {
    clearInterval(heartbeat);
    clearTimeout(deadline);
    // Only a run that finished on its own gives the lease back. A stopped run lets it expire.
    if (!controller.signal.aborted) await store.release(threadId, holder).catch(() => {});
  }
}
