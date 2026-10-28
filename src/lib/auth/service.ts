import { decoyHash, hashPassword, verifyPassword } from "./password";
import { fieldErrors, ROLE_LABEL, SignInSchema, SignUpSchema, type Role, type Session } from "./session";

/*
 * Sign in and sign up. Pure logic on top of a small user store (the Supabase version is in users.ts; tests use a
 * memory one), so the rules can be tested without a database.
 */

export type UserRecord = { id: string; email: string; role: Role; fullName: string; passwordHash: string };
export type NewUser = Omit<UserRecord, "id">;

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "EmailTakenError";
  }
}

/** The accounts table is missing (migration 0010 not run) or the database is not configured. */
export class AccountsUnavailableError extends Error {
  constructor() {
    super("Accounts are not set up on the server.");
    this.name = "AccountsUnavailableError";
  }
}

export type UserStore = {
  findByEmail(email: string): Promise<UserRecord | null>;
  /** Throws EmailTakenError when the email already has an account. */
  create(user: NewUser): Promise<UserRecord>;
};

export type AuthResult =
  | { ok: true; session: Session }
  | { ok: false; status: 400 | 401 | 409 | 503; code: string; message: string; fields: Record<string, string> };

const fail = (status: 400 | 401 | 409 | 503, code: string, message: string, fields: Record<string, string> = {}): AuthResult => ({
  ok: false,
  status,
  code,
  message,
  fields,
});

const toSession = (user: Pick<UserRecord, "id" | "role" | "email" | "fullName">): Session => ({ id: user.id, role: user.role, email: user.email, name: user.fullName });

export async function signUp(input: unknown, store: UserStore): Promise<AuthResult> {
  const parsed = SignUpSchema.safeParse(input);
  if (!parsed.success) return fail(400, "validation_failed", "Please fix the highlighted fields.", fieldErrors(parsed.error));
  const { role, fullName, email, password } = parsed.data;

  try {
    if (await store.findByEmail(email)) return fail(409, "email_taken", "That email already has an account.", { email: "An account with this email already exists. Sign in instead." });
    const user = await store.create({ email, role, fullName, passwordHash: await hashPassword(password) });
    return { ok: true, session: toSession(user) };
  } catch (error) {
    // Two sign-ups at once for one email: the database's unique index lets only one through.
    if (error instanceof EmailTakenError) return fail(409, "email_taken", "That email already has an account.", { email: "An account with this email already exists. Sign in instead." });
    if (error instanceof AccountsUnavailableError) return fail(503, "accounts_unavailable", "Accounts are not set up on the server yet.");
    throw error;
  }
}

export async function signIn(input: unknown, store: UserStore): Promise<AuthResult> {
  const parsed = SignInSchema.safeParse(input);
  if (!parsed.success) return fail(400, "validation_failed", "Please fix the highlighted fields.", fieldErrors(parsed.error));
  const { role, email, password } = parsed.data;

  let user: UserRecord | null;
  try {
    user = await store.findByEmail(email);
  } catch (error) {
    if (error instanceof AccountsUnavailableError) return fail(503, "accounts_unavailable", "Accounts are not set up on the server yet.");
    throw error;
  }

  // An unknown email costs the same time as a wrong password, and gets the same answer.
  const correct = await verifyPassword(password, user?.passwordHash ?? (await decoyHash()));
  if (!user || !correct) return fail(401, "invalid_credentials", "Wrong email or password.", { password: "Wrong email or password." });
  if (user.role !== role) {
    return fail(401, "wrong_role", `This email is registered as a ${ROLE_LABEL[user.role].toLowerCase()} account.`, {
      role: `This email is registered as a ${ROLE_LABEL[user.role].toLowerCase()} account. Choose ${ROLE_LABEL[user.role]}.`,
    });
  }
  return { ok: true, session: toSession(user) };
}
