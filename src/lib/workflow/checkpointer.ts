import "server-only";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Pool } from "pg";
import { getWorkflowPool } from "./db";
import { assertLeaseFor } from "./lease";

/** The schema created by migration 0009. */
export const CHECKPOINT_SCHEMA = "langgraph";

/**
 * LangGraph's Postgres checkpointer with two guards:
 *  - every write needs the run's lease (and re-checks it with the database just before writing), so a run that
 *    lost its lease cannot save anything more;
 *  - setup() is disabled: the tables come from migration 0009, applied by a person, not by application code.
 */
export class FencedPostgresSaver extends PostgresSaver {
  constructor(pool: Pool) {
    super(pool, undefined, { schema: CHECKPOINT_SCHEMA });
  }

  override async setup(): Promise<void> {
    throw new Error("setup() is disabled: the checkpoint tables are created by migration 0009.");
  }

  override async put(...args: Parameters<PostgresSaver["put"]>): ReturnType<PostgresSaver["put"]> {
    await assertLeaseFor(args[0].configurable?.thread_id);
    return super.put(...args);
  }

  override async putWrites(...args: Parameters<PostgresSaver["putWrites"]>): Promise<void> {
    await assertLeaseFor(args[0].configurable?.thread_id);
    return super.putWrites(...args);
  }

  override async deleteThread(threadId: string): Promise<void> {
    await assertLeaseFor(threadId);
    return super.deleteThread(threadId);
  }
}

const SAVER_KEY = Symbol.for("coLearning.workflowSaver");
type WithSaver = typeof globalThis & { [SAVER_KEY]?: FencedPostgresSaver };

/** One saver per process, on the shared pool. */
export function getCheckpointer(): FencedPostgresSaver {
  const holder = globalThis as WithSaver;
  holder[SAVER_KEY] ??= new FencedPostgresSaver(getWorkflowPool());
  return holder[SAVER_KEY];
}
