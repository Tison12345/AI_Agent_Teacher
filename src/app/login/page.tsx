import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Sign in · Human–AI Co-Learning Agent" };

export default function LoginPage() {
  // The form reads the query string (where the user was sent from), which needs a Suspense boundary.
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <AuthForm />
    </Suspense>
  );
}
