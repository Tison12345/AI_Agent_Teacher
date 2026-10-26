import { ProjectsPanel } from "@/components/ProjectsPanel";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Student Dashboard" };

export default function StudentPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Student"
        title="Student Dashboard"
        description="Create a project, then record each week to get it evaluated. Your teacher's approved scores appear here."
      />
      <ProjectsPanel />
    </div>
  );
}
