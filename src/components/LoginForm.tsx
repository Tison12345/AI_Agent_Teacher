"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { login } from "@/lib/api/client";
import { DEMO_PASSWORD, displayName, ROLE_LABEL, ROLES, type Role } from "@/lib/auth/session";
import { NAME_KEY } from "./StudentSubmitSection";
import { Icon, type IconName } from "./ui";

const ICON: Record<Role, IconName> = { student: "student", faculty: "faculty" };
const BLURB: Record<Role, string> = {
  student: "Create projects, record weeks, upload assignment answers and see the marks your teacher approves.",
  faculty: "Review AI recommendations, create assignments and make the official decisions.",
};

const asRole = (value: string | null): Role | null => (ROLES.find((role) => role === value) ?? null);

/**
 * DEMO-ONLY sign-in: pick a role, type an email, enter the shared demo password. There are no accounts. See
 * docs/DEMO-LOGIN.md.
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const need = asRole(params.get("need"));

  const [role, setRole] = useState<Role>(() => asRole(params.get("role")) ?? "student");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setFields({});
    try {
      const result = await login({ role, email, password, next });
      if (result.ok) {
        if (result.session.role === "student") {
          // The student pages start from a name (their submissions are found by it): a readable one from the email.
          const name = displayName(result.session.email);
          if (name.length >= 2) {
            try {
              window.localStorage.setItem(NAME_KEY, name);
            } catch {
              /* storage can be blocked; the pages work without it */
            }
          }
        }
        router.replace(result.redirect);
        router.refresh();
        return;
      }
      setFields(result.fields ?? {});
      if (!result.fields || Object.keys(result.fields).length === 0) setMessage(result.message);
    } catch {
      setMessage("Could not reach the server. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">Demo sign-in</p>
        <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
        <p className="text-muted">Choose your role to continue to your dashboard.</p>
      </header>

      {need && (
        <p role="alert" className="alert-warning">
          That page is for {ROLE_LABEL[need].toLowerCase()} users. Sign in as {ROLE_LABEL[need].toLowerCase()} to open it.
        </p>
      )}
      {!need && next && (
        <p role="status" className="alert-info">
          Sign in to open that page.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate aria-label="Sign in" className="card space-y-5 p-6">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-fg">Sign in as</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {ROLES.map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-card/40 p-4 transition duration-150 hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary/15 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary"
              >
                <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} className="sr-only" />
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-accent">
                  <Icon name={ICON[value]} className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-semibold">{ROLE_LABEL[value]}</span>
                  <span className="mt-0.5 block text-xs text-muted">{BLURB[value]}</span>
                </span>
              </label>
            ))}
          </div>
          {fields.role && (
            <p role="alert" className="text-sm text-danger">
              {fields.role}
            </p>
          )}
        </fieldset>

        <div>
          <label htmlFor="login-email" className="block text-sm font-medium text-fg">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@gmail.com"
            className="field mt-1 block aria-[invalid=true]:border-danger"
            value={email}
            aria-invalid={Boolean(fields.email)}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">Gmail or any email address. No account is created and no email is sent.</p>
          {fields.email && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {fields.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="login-password" className="block text-sm font-medium text-fg">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="off"
            className="field mt-1 block aria-[invalid=true]:border-danger"
            value={password}
            aria-invalid={Boolean(fields.password)}
            onChange={(e) => setPassword(e.target.value)}
          />
          {fields.password && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {fields.password}
            </p>
          )}
          <p className="mt-1 text-xs text-muted">
            Demonstration only: the password for both roles is <strong className="text-fg">{DEMO_PASSWORD}</strong>. This is not real security.
          </p>
        </div>

        {message && (
          <p role="alert" className="alert-danger">
            {message}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
          <Icon name="lock" className="h-4 w-4" />
          {busy ? "Signing in…" : `Sign in as ${ROLE_LABEL[role].toLowerCase()}`}
        </button>
      </form>
    </div>
  );
}
