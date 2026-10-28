import { handleUnexpected } from "@/lib/api/errors";
import { listStudents } from "@/lib/students/repository";

/**
 * Faculty only (the proxy requires the faculty sign-in). The class overview and one summary per student, worked out
 * from the real records. It carries official scores only in the averages; the AI's recommendations are in the
 * per-student details.
 */
export async function GET() {
  try {
    return Response.json(await listStudents(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleUnexpected(error);
  }
}
