// Runs the whole suite INCLUDING live tests (real Supabase / Gemini / GitHub calls).
// Live tests spend API quota, so they are excluded from the normal `npm test`.
import { spawnSync } from "node:child_process";

// One file at a time: the workflow role is limited to 5 database connections, which parallel live files would exceed.
const result = spawnSync("npx", ["vitest", "run", "--no-file-parallelism"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, RUN_LIVE_TESTS: "1" },
});
process.exit(result.status ?? 1);
