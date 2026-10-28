"use client";

import { useRef, useState, type FormEvent } from "react";
import type { AssignmentSubmitResult } from "@/lib/api/client";
import {
  emptyQuestion,
  MAX_QUESTIONS,
  validateAssignmentForm,
  type AssignmentFormErrors,
  type AssignmentFormValues,
  type AssignmentInput,
  type QuestionField,
} from "@/lib/validation/assignment";
import { Icon } from "./ui";

const inputClass = "field mt-1 block aria-[invalid=true]:border-danger";

type Row = { key: number; values: AssignmentFormValues["questions"][number] };

/** Faculty: create an assignment from a title, instructions and one or more questions. */
export function AssignmentForm({ onSubmit }: { onSubmit: (input: AssignmentInput) => Promise<AssignmentSubmitResult> }) {
  const nextKey = useRef(2);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [rows, setRows] = useState<Row[]>([{ key: 1, values: emptyQuestion() }]);
  const [errors, setErrors] = useState<AssignmentFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = rows.reduce((sum, r) => {
    const n = Number(r.values.maxMarks);
    return r.values.maxMarks.trim() !== "" && Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);

  function setQuestion(index: number, field: QuestionField, value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, values: { ...r.values, [field]: value } } : r)));
  }

  function addQuestion() {
    setRows((prev) => (prev.length >= MAX_QUESTIONS ? prev : [...prev, { key: nextKey.current++, values: emptyQuestion() }]));
  }

  function removeQuestion(index: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    setErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setServerError(null);
    setCreated(null);
    const result = validateAssignmentForm({ title, instructions, questions: rows.map((r) => r.values) });
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
        setTitle("");
        setInstructions("");
        setRows([{ key: nextKey.current++, values: emptyQuestion() }]);
      } else {
        setServerError(outcome.message);
        if (outcome.errors) setErrors(outcome.errors);
      }
    } catch {
      setServerError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Create assignment" className="space-y-5">
      <div>
        <label htmlFor="assignment-title" className="block text-sm font-medium text-fg">
          Assignment title
        </label>
        <input
          id="assignment-title"
          type="text"
          className={inputClass}
          value={title}
          aria-invalid={Boolean(errors.title)}
          onChange={(e) => setTitle(e.target.value)}
        />
        {errors.title && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {errors.title}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="assignment-instructions" className="block text-sm font-medium text-fg">
          Instructions for students
        </label>
        <textarea
          id="assignment-instructions"
          rows={3}
          className={inputClass}
          value={instructions}
          aria-invalid={Boolean(errors.instructions)}
          onChange={(e) => setInstructions(e.target.value)}
        />
        {errors.instructions && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {errors.instructions}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {rows.map((row, index) => {
          const e = errors.question?.[index] ?? {};
          const id = (name: string) => `q${row.key}-${name}`;
          const invalid = (field: QuestionField) => Boolean(e[field]);
          return (
            <fieldset key={row.key} className="well space-y-3 p-4">
              <legend className="px-1 text-sm font-semibold">Question {index + 1}</legend>
              <div>
                <label htmlFor={id("text")} className="block text-sm font-medium text-fg">
                  Question {index + 1} text
                </label>
                <textarea
                  id={id("text")}
                  rows={2}
                  className={inputClass}
                  value={row.values.text}
                  aria-invalid={invalid("text")}
                  onChange={(ev) => setQuestion(index, "text", ev.target.value)}
                />
                {e.text && (
                  <p role="alert" className="mt-1 text-sm text-danger">
                    {e.text}
                  </p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                <div>
                  <label htmlFor={id("marks")} className="block text-sm font-medium text-fg">
                    Question {index + 1} maximum marks
                  </label>
                  <input
                    id={id("marks")}
                    type="text"
                    inputMode="decimal"
                    className={inputClass}
                    value={row.values.maxMarks}
                    aria-invalid={invalid("maxMarks")}
                    onChange={(ev) => setQuestion(index, "maxMarks", ev.target.value)}
                  />
                  {e.maxMarks && (
                    <p role="alert" className="mt-1 text-sm text-danger">
                      {e.maxMarks}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={id("rubric")} className="block text-sm font-medium text-fg">
                    Question {index + 1} marking rubric
                  </label>
                  <textarea
                    id={id("rubric")}
                    rows={2}
                    className={inputClass}
                    value={row.values.rubric}
                    aria-invalid={invalid("rubric")}
                    onChange={(ev) => setQuestion(index, "rubric", ev.target.value)}
                  />
                  {e.rubric && (
                    <p role="alert" className="mt-1 text-sm text-danger">
                      {e.rubric}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label htmlFor={id("ref")} className="block text-sm font-medium text-fg">
                  Question {index + 1} reference answer <span className="font-normal text-muted">(optional, faculty only)</span>
                </label>
                <textarea
                  id={id("ref")}
                  rows={2}
                  className={inputClass}
                  value={row.values.referenceAnswer}
                  aria-invalid={invalid("referenceAnswer")}
                  onChange={(ev) => setQuestion(index, "referenceAnswer", ev.target.value)}
                />
                {e.referenceAnswer && (
                  <p role="alert" className="mt-1 text-sm text-danger">
                    {e.referenceAnswer}
                  </p>
                )}
              </div>
              {rows.length > 1 && (
                <button type="button" onClick={() => removeQuestion(index)} className="btn-ghost btn-sm text-danger">
                  Remove question {index + 1}
                </button>
              )}
            </fieldset>
          );
        })}
        {errors.questions && (
          <p role="alert" className="text-sm text-danger">
            {errors.questions}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={addQuestion} disabled={rows.length >= MAX_QUESTIONS} className="btn-secondary btn-sm">
          <Icon name="plus" className="h-4 w-4" />
          Add question
        </button>
        <p className="text-sm text-muted">
          Total: <strong className="text-fg">{total}</strong> marks
        </p>
      </div>

      {serverError && (
        <p role="alert" className="alert-danger">
          {serverError}
        </p>
      )}
      {created && (
        <p role="status" className="alert-success">
          Assignment &ldquo;{created}&rdquo; was created. Students can see it now.
        </p>
      )}
      <button type="submit" disabled={submitting} className="btn-primary">
        {submitting ? "Creating…" : "Create assignment"}
      </button>
    </form>
  );
}
