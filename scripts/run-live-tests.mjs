// Runs the whole suite INCLUDING live tests (real Supabase / Gemini / GitHub calls).
// Live tests spend API quota, so they are excluded from the normal `npm test`.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["vitest", "run"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, RUN_LIVE_TESTS: "1" },
});
process.exit(result.status ?? 1);
