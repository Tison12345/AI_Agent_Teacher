import { StudentAssignments } from "@/components/StudentAssignments";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Student Assignments" };

export default function StudentAssignmentsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Student"
        title="Assignments"
        description="Read the instructions and marking rubric for each assignment."
      />
      <StudentAssignments />
    </div>
  );
}
