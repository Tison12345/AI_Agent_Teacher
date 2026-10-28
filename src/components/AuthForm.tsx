"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { login, signup, type AuthResult } from "@/lib/api/client";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/auth/session";
import { NAME_KEY } from "./StudentSubmitSection";
import { Icon, type IconName } from "./ui";

type Mode = "signin" | "signup";

const ICON: Record<Role, IconName> = { student: "student", faculty: "faculty" };
const asRole = (value: string | null): Role | null => ROLES.find((role) => role === value) ?? null;

/** Sign in or sign up with an email and a password, as a student or as faculty. */
export function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const need = asRole(params.get("need"));

  const [mode, setMode] = useState<Mode>(() => (params.get("mode") === "signup" ? "signup" : "signin"));
  const [role, setRole] = useState<Role>(() => asRole(params.get("role")) ?? "student");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signingUp = mode === "signup";

  function switchTo(value: Mode) {
    if (value === mode || busy) return;
    setMode(value);
    setFields({});
    setMessage(null);
    setPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setFields({});
    try {
      const result: AuthResult = signingUp
        ? await signup({ role, fullName, email, password, confirmPassword, next })
        : await login({ role, email, password, next });
      if (result.ok) {
        if (result.session.role === "student") {
          try {
            window.localStorage.setItem(NAME_KEY, result.session.name); // the student pages start from this name
          } catch {
            /* storage can be blocked; the pages work without it */
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

  const error = (name: string) =>
    fields[name] ? (
      <p role="alert" className="mt-1 text-sm text-danger">
        {fields[name]}
      </p>
    ) : null;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{signingUp ? "Sign up" : "Sign in"}</h1>

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

      <div className="card space-y-5 p-6">
        <div role="tablist" aria-label="Sign in or sign up" className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-card/60 p-1">
          {(["signin", "signup"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`auth-tab-${value}`}
              aria-selected={mode === value}
              aria-controls="auth-panel"
              onClick={() => switchTo(value)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                mode === value ? "bg-primary text-white shadow-md shadow-primary/30" : "text-muted hover:text-fg"
              }`}
            >
              {value === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <form id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${mode}`} onSubmit={handleSubmit} noValidate className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="sr-only">Role</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {ROLES.map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-card/40 p-4 transition duration-150 hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary/15 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary"
                >
                  <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} className="sr-only" />
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-accent">
                    <Icon name={ICON[value]} className="h-5 w-5" />
                  </span>
                  <span className="font-semibold">{ROLE_LABEL[value]}</span>
                </label>
              ))}
            </div>
            {error("role")}
          </fieldset>

          {signingUp && (
            <div>
              <label htmlFor="auth-name" className="block text-sm font-medium text-fg">
                Full name
              </label>
              <input
                id="auth-name"
                type="text"
                autoComplete="name"
                className="field mt-1 block aria-[invalid=true]:border-danger"
                value={fullName}
                aria-invalid={Boolean(fields.fullName)}
                onChange={(e) => setFullName(e.target.value)}
              />
              {error("fullName")}
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-sm font-medium text-fg">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className="field mt-1 block aria-[invalid=true]:border-danger"
              value={email}
              aria-invalid={Boolean(fields.email)}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error("email")}
          </div>

          <div>
            <label htmlFor="auth-password" className="block text-sm font-medium text-fg">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={signingUp ? "new-password" : "current-password"}
              className="field mt-1 block aria-[invalid=true]:border-danger"
              value={password}
              aria-invalid={Boolean(fields.password)}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error("password")}
          </div>

          {signingUp && (
            <div>
              <label htmlFor="auth-confirm" className="block text-sm font-medium text-fg">
                Confirm password
              </label>
              <input
                id="auth-confirm"
                type="password"
                autoComplete="new-password"
                className="field mt-1 block aria-[invalid=true]:border-danger"
                value={confirmPassword}
                aria-invalid={Boolean(fields.confirmPassword)}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {error("confirmPassword")}
            </div>
          )}

          {message && (
            <p role="alert" className="alert-danger">
              {message}
            </p>
          )}
          <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
            <Icon name="lock" className="h-4 w-4" />
            {busy ? (signingUp ? "Creating account…" : "Signing in…") : signingUp ? "Sign up" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
