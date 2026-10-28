import { Suspense } from "react";
import { StudentAssignmentDetail } from "@/components/StudentAssignmentDetail";

export const metadata = { title: "Assignment" };

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudentAssignmentDetail id={id} />;
}

export default function StudentAssignmentPage({ params }: PageProps<"/student/assignments/[id]">) {
  return (
    <Suspense fallback={<p role="status">Loading assignment…</p>}>
      <Detail params={params} />
    </Suspense>
  );
}
