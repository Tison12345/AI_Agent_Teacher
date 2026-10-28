import { Suspense } from "react";
import { FacultySubmissionDetail } from "@/components/FacultySubmissionDetail";

export const metadata = { title: "Submission" };

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FacultySubmissionDetail id={id} />;
}

export default function FacultySubmissionPage({ params }: PageProps<"/faculty/submissions/[id]">) {
  return (
    <Suspense fallback={<p role="status">Loading submission…</p>}>
      <Detail params={params} />
    </Suspense>
  );
}
