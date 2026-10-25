import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export class StorageConfigError extends Error {
  constructor() {
    super("Storage is not configured.");
    this.name = "StorageConfigError";
  }
}

let client: SupabaseClient | null = null;

/** Server-only Supabase client using the secret key. Never import from client code. */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const env = envSchema.safeParse(process.env);
  if (!env.success) throw new StorageConfigError();
  client = createClient(env.data.SUPABASE_URL, env.data.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
