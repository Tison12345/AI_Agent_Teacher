import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/** A problem with the workflow database settings. The message never contains the connection URL or password. */
export class WorkflowConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowConfigError";
  }
}

export type PoolSettings = { connectionString: string; ssl: pg.ClientConfig["ssl"] };

/** Connection-string parameters that would override the TLS settings chosen here. */
const SSL_PARAMS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "sslcrl"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
export const DEFAULT_CA_PATH = "certs/supabase-ca.crt";

/**
 * Turns DATABASE_URL (the restricted `langgraph_app` role, through Supabase's pooler) into pool settings.
 * Remote databases always get a VERIFIED TLS connection using Supabase's public CA certificate; verification is
 * never switched off. Pure, so it can be tested without a database.
 */
export function workflowPoolSettings(
  env: { DATABASE_URL?: string; DATABASE_CA_PATH?: string },
  readCa: (file: string) => string | null,
  cwd = process.cwd(),
): PoolSettings {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new WorkflowConfigError("DATABASE_URL is not set. See .env.example.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WorkflowConfigError("DATABASE_URL is not a valid connection URL.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new WorkflowConfigError("DATABASE_URL must start with postgresql://.");
  }
  for (const param of SSL_PARAMS) url.searchParams.delete(param);

  if (LOCAL_HOSTS.has(url.hostname)) return { connectionString: url.toString(), ssl: false };

  const configured = env.DATABASE_CA_PATH?.trim() || DEFAULT_CA_PATH;
  const file = path.resolve(cwd, configured);
  const ca = readCa(file);
  if (!ca) {
    throw new WorkflowConfigError(
      `The database certificate was not found at ${configured}. Download Supabase's CA certificate (Database settings, SSL configuration) and save it there.`,
    );
  }
  return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
}

const readFileOrNull = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/** A new pool. The role allows 5 connections in total, so each process keeps at most 3 (tests use fewer). */
export function createWorkflowPool(options: { max?: number } = {}, env: NodeJS.ProcessEnv = process.env): pg.Pool {
  const { connectionString, ssl } = workflowPoolSettings(
    { DATABASE_URL: env.DATABASE_URL, DATABASE_CA_PATH: env.DATABASE_CA_PATH },
    readFileOrNull,
  );
  const pool = new pg.Pool({
    connectionString,
    ssl,
    max: options.max ?? 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: "co-learning-workflow",
  });
  // An idle connection dropping must not crash the process.
  pool.on("error", (error) => console.error("[workflow] idle database client error:", error.name));
  return pool;
}

const POOL_KEY = Symbol.for("coLearning.workflowPool");
type WithPool = typeof globalThis & { [POOL_KEY]?: pg.Pool };

/** One shared pool per process, kept across dev hot-reloads so they cannot pile up connections. */
export function getWorkflowPool(): pg.Pool {
  const holder = globalThis as WithPool;
  holder[POOL_KEY] ??= createWorkflowPool();
  return holder[POOL_KEY];
}

export async function closeWorkflowPool(): Promise<void> {
  const holder = globalThis as WithPool;
  const pool = holder[POOL_KEY];
  holder[POOL_KEY] = undefined;
  await pool?.end();
}
