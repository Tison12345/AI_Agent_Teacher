import { Suspense } from "react";
import { FacultyStudentDetail } from "@/components/FacultyStudentDetail";

export const metadata = { title: "Student" };

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FacultyStudentDetail id={id} />;
}

export default function FacultyStudentPage({ params }: PageProps<"/faculty/students/[id]">) {
  return (
    <Suspense fallback={<p role="status">Loading student…</p>}>
      <Detail params={params} />
    </Suspense>
  );
}
