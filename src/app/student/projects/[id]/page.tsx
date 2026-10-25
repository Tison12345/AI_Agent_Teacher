import { Suspense } from "react";
import { ProjectDetail } from "@/components/ProjectDetail";

export const metadata = { title: "Project" };

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectDetail id={id} />;
}

export default function ProjectPage({
  params,
}: PageProps<"/student/projects/[id]">) {
  return (
    <Suspense fallback={<p role="status">Loading project…</p>}>
      <Detail params={params} />
    </Suspense>
  );
}
