import { Suspense } from "react";
import { FacultyAssignmentDetail } from "@/components/FacultyAssignmentDetail";

export const metadata = { title: "Assignment" };

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FacultyAssignmentDetail id={id} />;
}

export default function FacultyAssignmentPage({ params }: PageProps<"/faculty/assignments/[id]">) {
  return (
    <Suspense fallback={<p role="status">Loading assignment…</p>}>
      <Detail params={params} />
    </Suspense>
  );
}
