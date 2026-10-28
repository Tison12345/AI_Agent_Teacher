import { FacultyAssignments } from "@/components/FacultyAssignments";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Faculty Assignments" };

export default function FacultyAssignmentsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Faculty"
        title="Assignments"
        description="Create assignments with questions, marks and a rubric. Student submissions and AI-assisted marking are added in the next phases."
      />
      <FacultyAssignments />
    </div>
  );
}
