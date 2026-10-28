import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = { title: "Sign in · Human–AI Co-Learning Agent" };

/** Demo sign-in (a shared password; see docs/DEMO-LOGIN.md). */
export default function LoginPage() {
  // The form reads the query string (where the user was sent from), which needs a Suspense boundary.
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
