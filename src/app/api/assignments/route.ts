import { handleUnexpected } from "@/lib/api/errors";
import { listStudentAssignments } from "@/lib/assignments/repository";

/** Student-safe: read from the view without reference answers. */
export async function GET() {
  try {
    return Response.json({ assignments: await listStudentAssignments() });
  } catch (error) {
    return handleUnexpected(error);
  }
}
