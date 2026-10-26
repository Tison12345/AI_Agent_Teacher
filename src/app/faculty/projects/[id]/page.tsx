import { Suspense } from "react";
import { ProjectOverview } from "@/components/ProjectOverview";

export const metadata = { title: "Project overview" };

async function Overview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectOverview id={id} />;
}

export default function ProjectOverviewPage({ params }: PageProps<"/faculty/projects/[id]">) {
  return (
    <Suspense fallback={<p role="status">Loading project…</p>}>
      <Overview params={params} />
    </Suspense>
  );
}
