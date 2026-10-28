import "server-only";
import { z } from "zod";
import { getSupabase, StorageConfigError } from "@/lib/db/supabase";
import { ROLES } from "./session";
import { AccountsUnavailableError, EmailTakenError, type UserRecord, type UserStore } from "./service";

const COLUMNS = "id, email, role, full_name, password_hash";

const Row = z.object({ id: z.string(), email: z.string(), role: z.enum(ROLES), full_name: z.string(), password_hash: z.string() });
const toUser = (row: unknown): UserRecord => {
  const r = Row.parse(row);
  return { id: r.id, email: r.email, role: r.role, fullName: r.full_name, passwordHash: r.password_hash };
};

/** Postgres 42P01 / PostgREST PGRST205: the table does not exist, so migration 0010 has not been run. */
const tableMissing = (error: { code?: string; message?: string }) =>
  error.code === "42P01" || error.code === "PGRST205" || /app_users/.test(error.message ?? "") && /(does not exist|schema cache)/i.test(error.message ?? "");

function client() {
  try {
    return getSupabase();
  } catch (error) {
    if (error instanceof StorageConfigError) throw new AccountsUnavailableError();
    throw error;
  }
}

/** The accounts, in the app_users table (migration 0010). Only the server's secret key can read or write it. */
export const userStore: UserStore = {
  async findByEmail(email) {
    const { data, error } = await client().from("app_users").select(COLUMNS).eq("email", email).maybeSingle();
    if (error) {
      if (tableMissing(error)) throw new AccountsUnavailableError();
      throw new Error(`could not read accounts (${error.code ?? "unknown"})`);
    }
    return data ? toUser(data) : null;
  },

  async create(user) {
    const { data, error } = await client()
      .from("app_users")
      .insert({ email: user.email, role: user.role, full_name: user.fullName, password_hash: user.passwordHash })
      .select(COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") throw new EmailTakenError();
      if (tableMissing(error)) throw new AccountsUnavailableError();
      throw new Error(`could not create the account (${error.code ?? "unknown"})`);
    }
    return toUser(data);
  },
};
