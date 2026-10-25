import { Suspense } from "react";
import { EvaluationReview } from "@/components/EvaluationReview";

export const metadata = { title: "Review evaluation" };

async function Review({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EvaluationReview id={id} />;
}

export default function ReviewPage({ params }: PageProps<"/faculty/evaluations/[id]">) {
  return (
    <Suspense fallback={<p role="status">Loading evaluation…</p>}>
      <Review params={params} />
    </Suspense>
  );
}
