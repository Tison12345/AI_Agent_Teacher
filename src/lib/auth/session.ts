import { z } from "zod";

/*
 * DEMO-ONLY sign-in. One shared password for both roles, an email to say who is signing in, and a cookie that remembers it. There are no
 * accounts, nothing is stored in the database, and the cookie is not signed: anyone who knows the password (it is
 * printed on the sign-in page) can sign in as either role. It exists so a college demonstration can show the two
 * roles; it is NOT security. Real deployment needs real authentication (see docs/DEMO-LOGIN.md).
 *
 * This file is plain code with no server-only imports, so the proxy, the routes and the pages can all use it.
 */

export const ROLES = ["student", "faculty"] as const;
export type Role = (typeof ROLES)[number];
export type Session = { role: Role; email: string };

/** The shared demonstration password, for both roles. Not a secret. */
export const DEMO_PASSWORD = "1234";

export const SESSION_COOKIE = "colearn_demo_session";
/** The sign-in lasts this long, then the user signs in again. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export const ROLE_LABEL: Record<Role, string> = { student: "Student", faculty: "Faculty" };
export const ROLE_HOME: Record<Role, string> = { student: "/student", faculty: "/faculty" };

export const EMAIL_MAX = 254;

/** A name to show for an email: "asha.fictional+demo@gmail.com" becomes "Asha Fictional". Empty when nothing usable. */
export function displayName(email: string): string {
  const local = email.split("@")[0]?.split("+")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function serializeSession(session: Session): string {
  return encodeURIComponent(JSON.stringify({ role: session.role, email: session.email }));
}

const EmailSchema = z.string().trim().toLowerCase().max(EMAIL_MAX).pipe(z.email());
const StoredSchema = z.object({ role: z.enum(ROLES), email: EmailSchema });

/** The signed-in user from the cookie's value, or null when it is missing or not something we wrote. */
export function parseSession(raw: string | null | undefined): Session | null {
  if (!raw) return null;
  try {
    const parsed = StoredSchema.safeParse(JSON.parse(decodeURIComponent(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const LoginSchema = z.object({
  role: z.enum(ROLES, { error: "Choose Student or Faculty." }),
  email: z
    .string({ error: "Enter your email." })
    .trim()
    .toLowerCase()
    .min(1, "Enter your email.")
    .max(EMAIL_MAX, "That email is too long.")
    .pipe(z.email("Enter a valid email address, for example you@gmail.com.")),
  password: z.string({ error: "Enter the demo password." }).min(1, "Enter the demo password."),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export type LoginCheck = { ok: true; session: Session } | { ok: false; fields: Record<string, string> };

/** Checks a sign-in form. The only password is the demo one, shared by both roles. */
export function checkLogin(input: unknown): LoginCheck {
  const parsed = LoginSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, fields };
  }
  if (parsed.data.password !== DEMO_PASSWORD) return { ok: false, fields: { password: "Wrong password." } };
  return { ok: true, session: { role: parsed.data.role, email: parsed.data.email } };
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
