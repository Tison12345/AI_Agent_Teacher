import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { createAssignment, listFacultyAssignments } from "@/lib/assignments/repository";
import { assignmentInputSchema, flattenErrors, issuesToErrors } from "@/lib/validation/assignment";

// Demo build: faculty routes need the demo faculty sign-in (shared password; src/proxy.ts), which is not real security.

export async function GET() {
  try {
    return Response.json({ assignments: await listFacultyAssignments() });
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
  const parsed = assignmentInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "validation_failed",
      "Please fix the highlighted fields.",
      flattenErrors(issuesToErrors(parsed.error.issues)),
    );
  }
  try {
    return Response.json({ assignment: await createAssignment(parsed.data) }, { status: 201 });
  } catch (error) {
    return handleUnexpected(error);
  }
}
