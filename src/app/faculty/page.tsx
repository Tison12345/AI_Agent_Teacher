import { FacultyDashboard } from "@/components/FacultyDashboard";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Faculty Dashboard" };

export default function FacultyPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Faculty"
        title="Faculty Dashboard"
        description="See how each student is doing across projects, weekly evaluations, quizzes and assignments, and review what is waiting for you."
      />
      <FacultyDashboard />
    </div>
  );
}
