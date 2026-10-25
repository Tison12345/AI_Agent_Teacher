import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { createProject, listProjects } from "@/lib/projects/repository";
import {
  DEFAULT_DURATION_WEEKS,
  projectFormSchema,
} from "@/lib/validation/project";

export async function GET() {
  try {
    return Response.json({ projects: await listProjects() });
  } catch (error) {
    return handleUnexpected(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
  }

  // Server-side validation. The duration is validated like every other field; when it
  // is omitted, the default applies.
  const raw = typeof body === "object" && body !== null ? body : {};
  const parsed = projectFormSchema.safeParse({
    ...raw,
    // Only a missing value gets the default; null, text and the like are errors.
    durationWeeks:
      (raw as { durationWeeks?: unknown }).durationWeeks === undefined
        ? DEFAULT_DURATION_WEEKS
        : (raw as { durationWeeks?: unknown }).durationWeeks,
  });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fields[key]) fields[key] = issue.message;
    }
    return errorResponse(400, "validation_failed", "Please fix the highlighted fields.", fields);
  }

  try {
    const project = await createProject(parsed.data);
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return handleUnexpected(error);
  }
}
