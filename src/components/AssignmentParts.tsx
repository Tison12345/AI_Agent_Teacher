import type { Question } from "@/lib/schemas/assignment";
import { Disclosure } from "./ui";

/** Said on every faculty assignment page: the demo has no login. */
export function OpenAccessNotice() {
  return (
    <p className="alert-warning text-sm">
      <strong>Demo build, no login.</strong> Anyone who can open this site can create assignments and, later, approve
      marks. The student name is just typed text, not an account. This is for demonstration only.
    </p>
  );
}

/** The questions with their marks and rubric. Reference answers are shown only when the caller passes them (faculty). */
export function QuestionList({
  questions,
  referenceAnswers,
}: {
  questions: Question[];
  referenceAnswers?: Record<string, string> | null;
}) {
  return (
    <ol className="space-y-3">
      {questions.map((q) => {
        const reference = referenceAnswers?.[String(q.number)];
        return (
          <li key={q.number} className="well p-3 text-sm">
            <Disclosure
              summary={
                <span className="flex flex-wrap items-start justify-between gap-2 p-1">
                  <span className="min-w-0 flex-1 text-base font-semibold">
                    {q.number}. {q.text}
                  </span>
                  <span className="badge-primary shrink-0">{q.maxMarks} marks</span>
                </span>
              }
            >
              <div className="space-y-2 px-1 pb-1">
                <div>
                  <p className="eyebrow">Marking rubric</p>
                  <p className="whitespace-pre-line text-fg">{q.rubric}</p>
                </div>
                {reference && (
                  <div className="border-t border-line pt-2">
                    <p className="eyebrow">Reference answer (faculty only)</p>
                    <p className="whitespace-pre-line text-fg">{reference}</p>
                  </div>
                )}
              </div>
            </Disclosure>
          </li>
        );
      })}
    </ol>
  );
}
