import { z } from "zod";

export const MIN_QUESTIONS = 1;
export const MAX_QUESTIONS = 20;
/** Per question. With 20 questions the total stays well inside the database column. */
export const MAX_QUESTION_MARKS = 100;

const marksSchema = z
  .number({ error: "Enter the maximum marks." })
  .positive("Maximum marks must be more than 0.")
  .max(MAX_QUESTION_MARKS, `Maximum marks must be at most ${MAX_QUESTION_MARKS}.`)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, "Use at most 2 decimal places.");

/** One question as the faculty member writes it. The number is assigned by position. */
export const questionInputSchema = z.object({
  text: z.string().trim().min(1, "Write the question.").max(2000, "The question must be at most 2000 characters."),
  maxMarks: marksSchema,
  rubric: z
    .string()
    .trim()
    .min(1, "Write a short marking rubric.")
    .max(1000, "The rubric must be at most 1000 characters."),
  /** Optional. An empty string means none. */
  referenceAnswer: z
    .string()
    .trim()
    .max(4000, "The reference answer must be at most 4000 characters.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const assignmentInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .min(3, "The title must be at least 3 characters.")
    .max(120, "The title must be at most 120 characters."),
  instructions: z
    .string()
    .trim()
    .min(1, "Instructions are required.")
    .max(4000, "The instructions must be at most 4000 characters."),
  questions: z
    .array(questionInputSchema)
    .min(MIN_QUESTIONS, "Add at least one question.")
    .max(MAX_QUESTIONS, `An assignment can have at most ${MAX_QUESTIONS} questions.`),
});

export type AssignmentInput = z.output<typeof assignmentInputSchema>;
export type QuestionInput = AssignmentInput["questions"][number];

/** What the form holds: everything is text until it is validated. */
export type QuestionFormValues = { text: string; maxMarks: string; rubric: string; referenceAnswer: string };
export type AssignmentFormValues = { title: string; instructions: string; questions: QuestionFormValues[] };

export type QuestionField = keyof QuestionFormValues;
export type AssignmentFormErrors = {
  title?: string;
  instructions?: string;
  /** About the list as a whole, e.g. "Add at least one question." */
  questions?: string;
  /** By question position (0-based). */
  question?: Record<number, Partial<Record<QuestionField, string>>>;
};

export const emptyQuestion = (): QuestionFormValues => ({ text: "", maxMarks: "", rubric: "", referenceAnswer: "" });

export type AssignmentValidationResult =
  | { success: true; data: AssignmentInput }
  | { success: false; errors: AssignmentFormErrors };

/** Turns the form's text into numbers and checks it. Used by the form and, as a schema, by the server. */
export function validateAssignmentForm(values: AssignmentFormValues): AssignmentValidationResult {
  const parsed = assignmentInputSchema.safeParse({
    title: values.title,
    instructions: values.instructions,
    questions: values.questions.map((q) => ({
      text: q.text,
      maxMarks: q.maxMarks.trim() === "" ? undefined : Number(q.maxMarks),
      rubric: q.rubric,
      referenceAnswer: q.referenceAnswer,
    })),
  });
  if (parsed.success) return { success: true, data: parsed.data };
  return { success: false, errors: issuesToErrors(parsed.error.issues) };
}

/** Maps Zod issues to form errors; also used to build the server's field-error response. */
export function issuesToErrors(issues: readonly z.core.$ZodIssue[]): AssignmentFormErrors {
  const errors: AssignmentFormErrors = {};
  for (const issue of issues) {
    const [first, index, field] = issue.path;
    if (first === "title" || first === "instructions") {
      errors[first] ??= issue.message;
    } else if (first === "questions" && typeof index === "number" && typeof field === "string") {
      const rows = (errors.question ??= {});
      (rows[index] ??= {})[field as QuestionField] ??= issue.message;
    } else if (first === "questions") {
      errors.questions ??= issue.message;
    }
  }
  return errors;
}

/** Flat keys for the API's `fields` map: "title", "questions", "questions.0.maxMarks". */
export function flattenErrors(errors: AssignmentFormErrors): Record<string, string> {
  const flat: Record<string, string> = {};
  if (errors.title) flat.title = errors.title;
  if (errors.instructions) flat.instructions = errors.instructions;
  if (errors.questions) flat.questions = errors.questions;
  for (const [index, row] of Object.entries(errors.question ?? {})) {
    for (const [field, message] of Object.entries(row)) flat[`questions.${index}.${field}`] = message;
  }
  return flat;
}

/** The reverse of flattenErrors: turns the API's `fields` map back into form errors. */
export function unflattenErrors(fields: Record<string, string>): AssignmentFormErrors {
  const errors: AssignmentFormErrors = {};
  for (const [key, message] of Object.entries(fields)) {
    if (key === "title" || key === "instructions" || key === "questions") {
      errors[key] = message;
      continue;
    }
    const match = /^questions\.(\d+)\.(text|maxMarks|rubric|referenceAnswer)$/.exec(key);
    if (match) {
      const rows = (errors.question ??= {});
      (rows[Number(match[1])] ??= {})[match[2] as QuestionField] = message;
    }
  }
  return errors;
}
