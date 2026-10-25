import { configDefaults } from "vitest/config";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      // `server-only` throws outside the Next.js server bundle; stub it for tests.
      "server-only": fromRoot("./src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Live tests call real services and spend quota: run them with `npm run test:live`.
    exclude: process.env.RUN_LIVE_TESTS
      ? configDefaults.exclude
      : [...configDefaults.exclude, "**/*.live.test.ts"],
    // Live tests make several network round-trips to Supabase/Gemini.
    testTimeout: 20_000,
    // Makes SUPABASE_* from .env.local available to the optional live test.
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
