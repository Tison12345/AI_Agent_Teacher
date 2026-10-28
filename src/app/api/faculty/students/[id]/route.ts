import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { getStudent } from "@/lib/students/repository";
import { UNASSIGNED_ID } from "@/lib/students/types";

/**
 * Faculty only (the proxy requires the faculty sign-in). One student's projects, weekly checkpoints, AI-recommended
 * and faculty-approved scores, quiz results and assignment submissions. `unassigned` is the group of work made
 * before accounts existed.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/faculty/students/[id]">) {
  const { id } = await ctx.params;
  if (id !== UNASSIGNED_ID && !z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Student id must be a valid UUID.");
  try {
    const student = await getStudent(id);
    if (!student) return errorResponse(404, "not_found", "Student not found.");
    return Response.json({ student }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleUnexpected(error);
  }
}
