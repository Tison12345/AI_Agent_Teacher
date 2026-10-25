import { ProjectsPanel } from "@/components/ProjectsPanel";

export const metadata = { title: "Student Dashboard" };

export default function StudentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Student Dashboard</h1>
        <p className="mt-1 text-slate-600">Create a new project.</p>
      </div>
      <ProjectsPanel />
    </div>
  );
}
