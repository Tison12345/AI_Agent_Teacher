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
    // Makes SUPABASE_* from .env.local available to the optional live test.
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
