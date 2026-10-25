"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  PROJECT_DURATION_WEEKS,
  validateProjectForm,
  type ProjectFormErrors,
  type ProjectFormField,
  type ProjectFormValues,
} from "@/lib/validation/project";

const emptyValues: Record<ProjectFormField, string> = {
  title: "",
  description: "",
  repoUrl: "",
};

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200 aria-[invalid=true]:border-red-600";

type ControlProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
};

type FieldProps = {
  id: ProjectFormField;
  label: string;
  error?: string;
  hint?: string;
  children: (props: ControlProps) => ReactNode;
};

function Field({ id, label, error, hint, children }: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
      })}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export type ProjectSubmitResult =
  | { ok: true }
  | { ok: false; message: string; fields?: ProjectFormErrors };

type ProjectFormProps = {
  onSubmit: (values: ProjectFormValues) => Promise<ProjectSubmitResult>;
};

export function ProjectForm({ onSubmit }: ProjectFormProps) {
  const [values, setValues] = useState(emptyValues);
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  function update(field: ProjectFormField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setServerError(null);
    setCreated(null);
    const result = validateProjectForm(values);
    if (!result.success) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const outcome = await onSubmit(result.data);
      if (outcome.ok) {
        setCreated(result.data.title);
        setValues(emptyValues);
      } else {
        setServerError(outcome.message);
        if (outcome.fields) setErrors(outcome.fields);
      }
    } catch {
      setServerError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setValues(emptyValues);
    setErrors({});
    setServerError(null);
    setCreated(null);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Create project"
      className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <Field id="title" label="Project title" error={errors.title}>
        {(a11y) => (
          <input
            {...a11y}
            name="title"
            type="text"
            className={inputClass}
            value={values.title}
            onChange={(e) => update("title", e.target.value)}
          />
        )}
      </Field>

      <Field
        id="description"
        label="Short project description"
        error={errors.description}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            name="description"
            rows={4}
            className={inputClass}
            value={values.description}
            onChange={(e) => update("description", e.target.value)}
          />
        )}
      </Field>

      <Field
        id="repoUrl"
        label="GitHub repository URL"
        error={errors.repoUrl}
        hint="Example: https://github.com/owner/repo"
      >
        {(a11y) => (
          <input
            {...a11y}
            name="repoUrl"
            type="url"
            inputMode="url"
            className={inputClass}
            value={values.repoUrl}
            onChange={(e) => update("repoUrl", e.target.value)}
          />
        )}
      </Field>

      <div>
        <label
          htmlFor="duration"
          className="block text-sm font-medium text-slate-800"
        >
          Project duration
        </label>
        <input
          id="duration"
          name="duration"
          type="text"
          readOnly
          value={`${PROJECT_DURATION_WEEKS} weeks`}
          className={`${inputClass} bg-slate-100 text-slate-600`}
        />
        <p className="mt-1 text-xs text-slate-500">
          Fixed at {PROJECT_DURATION_WEEKS} weeks for the MVP.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create project"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Reset
        </button>
      </div>

      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"
        >
          {serverError}
        </div>
      )}

      {created && (
        <div
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          <p className="font-medium">
            Project created: &ldquo;{created}&rdquo;
          </p>
        </div>
      )}
    </form>
  );
}
