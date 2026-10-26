"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  DEFAULT_DURATION_WEEKS,
  MAX_DURATION_WEEKS,
  MIN_DURATION_WEEKS,
  validateProjectForm,
  type ProjectFormErrors,
  type ProjectFormField,
  type ProjectFormValues,
} from "@/lib/validation/project";

const emptyValues: Record<ProjectFormField, string> = {
  title: "",
  description: "",
  repoUrl: "",
  durationWeeks: String(DEFAULT_DURATION_WEEKS),
};

const inputClass = "field mt-1 block aria-[invalid=true]:border-danger";

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
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
      })}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-danger">
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
      className="space-y-5 rounded-2xl border border-line bg-card p-6 shadow-lg shadow-black/20"
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

      <Field
        id="durationWeeks"
        label="Project duration (weeks)"
        error={errors.durationWeeks}
        hint={`Choose from ${MIN_DURATION_WEEKS} to ${MAX_DURATION_WEEKS} weeks. The plan will have one entry per week.`}
      >
        {(a11y) => (
          <input
            {...a11y}
            name="durationWeeks"
            type="number"
            inputMode="numeric"
            min={MIN_DURATION_WEEKS}
            max={MAX_DURATION_WEEKS}
            step={1}
            className={inputClass}
            value={values.durationWeeks}
            onChange={(e) => update("durationWeeks", e.target.value)}
          />
        )}
      </Field>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create project"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg hover:bg-card-hover"
        >
          Reset
        </button>
      </div>

      {serverError && (
        <div
          role="alert"
          className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-fg"
        >
          {serverError}
        </div>
      )}

      {created && (
        <div
          role="status"
          className="rounded-2xl border border-success/40 bg-success/10 p-4 text-sm text-success"
        >
          <p className="font-medium">
            Project created: &ldquo;{created}&rdquo;
          </p>
        </div>
      )}
    </form>
  );
}
