import { z } from "zod";
import { errorResponse, handleUnexpected } from "@/lib/api/errors";
import { listFacultySubmissions } from "@/lib/submissions/repository";

// Demo build: this faculty route needs the demo faculty sign-in (src/proxy.ts), which is not real security.
export async function GET(_request: Request, ctx: RouteContext<"/api/faculty/assignments/[id]/submissions">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "invalid_id", "Assignment id must be a valid UUID.");
  try {
    return Response.json({ submissions: await listFacultySubmissions(id) });
  } catch (error) {
    return handleUnexpected(error);
  }
}
