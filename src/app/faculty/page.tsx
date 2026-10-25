import { FacultyQueue } from "@/components/FacultyQueue";

export const metadata = { title: "Faculty Dashboard" };

export default function FacultyPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Faculty Dashboard</h1>
      <FacultyQueue />
    </div>
  );
}
