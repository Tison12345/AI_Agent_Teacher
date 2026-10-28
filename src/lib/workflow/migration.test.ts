// @vitest-environment node
// Guards the checkpoint tables in migration 0009 against drift from the PINNED saver package: if an upgrade changes
// the saver's schema, this fails and a new migration is needed. The app never calls the saver's setup().
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const packageDir = path.join(root, "node_modules", "@langchain", "langgraph-checkpoint-postgres");
const sqlFile = readFileSync(path.join(root, "supabase", "migrations", "0009_langgraph_checkpoints.sql"), "utf8");

const normalize = (sql: string) => sql.replace(/--.*$/gm, "").replace(/"/g, "").replace(/;/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The package's own migration statements for schema "langgraph", straight from its published source. */
function packageMigrations(): string[] {
  const source = readFileSync(path.join(packageDir, "dist", "migrations.js"), "utf8");
  const body = source.slice(source.indexOf("return ["));
  const statements = [...body.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1].replace(/\$\{SCHEMA_TABLES\.(\w+)\}/g, "langgraph.$1"));
  return statements;
}

/** The checkpoint statements in 0009: from the first CREATE TABLE to the marker insert. */
function ourStatements(): string[] {
  const start = sqlFile.indexOf("CREATE TABLE IF NOT EXISTS langgraph.checkpoint_migrations");
  const end = sqlFile.indexOf("-- What setup() would have recorded");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return sqlFile.slice(start, end).split(";").map((s) => s.trim()).filter((s) => normalize(s) !== "");
}

describe("migration 0009 against the pinned LangGraph Postgres saver", () => {
  it("pins the exact saver version the migration was written for", () => {
    const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe("1.1.2");
    expect(sqlFile).toContain("langgraph-checkpoint-postgres 1.1.2");
    const root = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(root.dependencies["@langchain/langgraph-checkpoint-postgres"]).toBe("1.1.2"); // exact, no ^ or ~
  });

  it("creates exactly the tables and columns of the package's migrations, in order", () => {
    const expected = packageMigrations().map(normalize);
    expect(expected).toHaveLength(6);
    expect(ourStatements().map(normalize)).toEqual(expected);
  });

  it("records exactly the migration versions the package would have recorded", () => {
    const count = packageMigrations().length;
    expect(sqlFile).toContain(`generate_series(0, ${count - 1})`);
    expect(sqlFile).toMatch(new RegExp(`array\\[${Array.from({ length: count }, (_, i) => i).join(",\\s*")}\\]`));
  });

  it("uses the same table names as the saver's own queries", () => {
    const sql = readFileSync(path.join(packageDir, "dist", "sql.js"), "utf8");
    for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"]) {
      expect(sql).toContain(`"${table}"`);
      expect(sqlFile).toContain(`langgraph.${table}`);
    }
  });
});
