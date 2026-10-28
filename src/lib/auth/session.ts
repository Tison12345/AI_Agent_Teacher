import { z } from "zod";

/*
 * Lightweight sign-in and sign-up for the college MVP: an account is an email, a name, a role and a password
 * (stored hashed, in the app_users table), and signing in sets a signed cookie. There is no email verification,
 * password reset or provider: see docs/SIGN-IN.md for what this is and is not.
 *
 * This file is plain code with no server-only imports, so the pages, the forms and the routes can all use it.
 * Signing and checking the cookie is in token.ts (it needs Node's crypto), hashing passwords in password.ts.
 */

export const ROLES = ["student", "faculty"] as const;
export type Role = (typeof ROLES)[number];

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 100;

export const SessionSchema = z.object({
  /** The account's id (app_users.id): what projects and submissions are linked to. */
  id: z.uuid(),
  role: z.enum(ROLES),
  email: z.string().min(3).max(EMAIL_MAX),
  name: z.string().min(NAME_MIN).max(NAME_MAX),
});
/** Who is signed in: what the cookie holds and what the pages show. */
export type Session = z.infer<typeof SessionSchema>;

export const SESSION_COOKIE = "colearn_session";
/** A sign-in lasts this long, then the user signs in again. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export const ROLE_LABEL: Record<Role, string> = { student: "Student", faculty: "Faculty" };
export const ROLE_HOME: Record<Role, string> = { student: "/student", faculty: "/faculty" };

const RoleField = z.enum(ROLES, { error: "Choose Student or Faculty." });
const EmailField = z
  .string({ error: "Enter your email." })
  .trim()
  .toLowerCase()
  .min(1, "Enter your email.")
  .max(EMAIL_MAX, "That email is too long.")
  .pipe(z.email("Enter a valid email address, for example you@gmail.com."));

export const SignInSchema = z.object({
  role: RoleField,
  email: EmailField,
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(PASSWORD_MAX, "That password is too long."),
});
export type SignInInput = z.infer<typeof SignInSchema>;

export const SignUpSchema = z
  .object({
    role: RoleField,
    fullName: z
      .string({ error: "Enter your full name." })
      .trim()
      .min(NAME_MIN, `Enter your full name (at least ${NAME_MIN} characters).`)
      .max(NAME_MAX, `Your name must be at most ${NAME_MAX} characters.`),
    email: EmailField,
    password: z
      .string({ error: "Choose a password." })
      .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
      .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`),
    confirmPassword: z.string({ error: "Type the password again." }),
  })
  .refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], error: "The passwords do not match." });
export type SignUpInput = z.infer<typeof SignUpSchema>;

/** The first message for each field that failed, keyed by field name. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  return fields;
}

/** Which role a path belongs to: student pages, faculty pages, and the faculty API (AI scores and decisions). */
export function requiredRole(pathname: string): Role | null {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (under("/student")) return "student";
  if (under("/faculty") || under("/api/faculty")) return "faculty";
  return null;
}

/**
 * Where to go after signing in: the page the user was sent away from, but only if it is a page of their own role on
 * this site (never another site, never a protocol-relative URL). Otherwise their dashboard.
 */
export function safeNext(next: string | null | undefined, role: Role): string {
  if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
    const path = next.split(/[?#]/)[0];
    if (requiredRole(path) === role && !path.startsWith("/api/")) return next;
  }
  return ROLE_HOME[role];
}
