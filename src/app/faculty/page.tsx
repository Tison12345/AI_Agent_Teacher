import { FacultyQueue } from "@/components/FacultyQueue";
import { FacultyStats } from "@/components/FacultyStats";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Faculty Dashboard" };

export default function FacultyPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Faculty"
        title="Faculty Dashboard"
        description="Review each week's AI recommendation, check the student's quiz result and set the official score."
      />
      <FacultyStats />
      <FacultyQueue />
    </div>
  );
}
