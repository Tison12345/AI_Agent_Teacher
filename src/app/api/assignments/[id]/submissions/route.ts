import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { getStudentAssignment } from "@/lib/assignments/repository";
import { markInBackground } from "@/lib/grading/background";
import { checkUpload, MAX_UPLOAD_BYTES } from "@/lib/submissions/file";
import { submissionErrorResponse } from "@/lib/submissions/http";
import { defaultSubmissionDeps, getStudentSubmission, listStudentSubmissions } from "@/lib/submissions/repository";
import { submitAnswers } from "@/lib/submissions/service";

// Reading a file, and the AI marking that follows the response, can take a while.
export const maxDuration = 60;

const NameSchema = z
  .string()
  .trim()
  .min(2, "Enter your name (at least 2 characters).")
  .max(80, "Your name must be at most 80 characters.");

/** A student's own submissions, found by the name they typed. Demo build: the name is not a login. */
export async function GET(request: Request, ctx: RouteContext<"/api/assignments/[id]/submissions">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Assignment id must be a valid UUID.");
  const name = NameSchema.safeParse(new URL(request.url).searchParams.get("name") ?? "");
  if (!name.success) return errorResponse(400, "validation_failed", name.error.issues[0].message, { studentName: name.error.issues[0].message });
  try {
    return Response.json({ submissions: await listStudentSubmissions(id, name.data) });
  } catch (error) {
    return handleUnexpected(error);
  }
}

/** Receives the student's file (multipart: studentName, file), stores it and reads its text. */
export async function POST(request: Request, ctx: RouteContext<"/api/assignments/[id]/submissions">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Assignment id must be a valid UUID.");

  // Refuse an oversized body before reading it (a little slack for the form fields around the file).
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return errorResponse(413, "file_too_large", "The file is larger than 4 MB.", { file: "The file is larger than 4 MB." });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "invalid_form", "Send the name and file as a form upload.");
  }

  const name = NameSchema.safeParse(form.get("studentName") ?? "");
  const file = form.get("file");
  const fields: Record<string, string> = {};
  if (!name.success) fields.studentName = name.error.issues[0].message;
  if (!(file instanceof File)) fields.file = "Choose a PDF or Word file.";
  if (!name.success || !(file instanceof File)) {
    return errorResponse(400, "validation_failed", "Please fix the highlighted fields.", fields);
  }

  try {
    if (!(await getStudentAssignment(id))) return errorResponse(404, "not_found", "Assignment not found.");

    const upload = await checkUpload(file);
    if (!upload.ok) {
      return errorResponse(400, "invalid_file", upload.message, { file: upload.message });
    }

    const submissionId = await submitAnswers(
      { assignmentId: id, studentName: name.data, fileName: upload.fileName, bytes: upload.bytes, type: upload.type },
      defaultSubmissionDeps(),
    );
    const submission = await getStudentSubmission(submissionId);
    markInBackground(submissionId); // marks it only if the text was read; the student is not kept waiting
    return Response.json({ submission }, { status: 201 });
  } catch (error) {
    return submissionErrorResponse(error);
  }
}
