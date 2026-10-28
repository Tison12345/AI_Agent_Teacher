import { describe, expect, it } from "vitest";
import { buildStudentDetail, buildStudentList, type ClassData } from "./aggregate";
import { UNASSIGNED_ID } from "./types";

const ASHA = "11111111-1111-4111-8111-111111111111";
const BALA = "22222222-2222-4222-8222-222222222222";
const NEW = "33333333-3333-4333-8333-333333333333"; // signed up, has done nothing yet
const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T10:00:00+00:00`;

/**
 * Asha: project P1 (weeks 1-3: official 80, AI 90 pending, rejected), project P2 (week 1 official 60).
 *   Assignments: A1 approved 12/15, A2 awaiting review, A3 not submitted.
 * Bala: project P3 (week 1 edited official 50, AI 95). A1 rejected, A2 failed.
 * Old work with no owner: project P4 (week 1 pending), submission to A1 awaiting review.
 */
function fixture(): ClassData {
  return {
    students: [
      { id: BALA, fullName: "Bala Fictional", email: "bala@gmail.com", createdAt: at(2) },
      { id: ASHA, fullName: "Asha Fictional", email: "asha@gmail.com", createdAt: at(1) },
      { id: NEW, fullName: "Chitra Fictional", email: "chitra@gmail.com", createdAt: at(3) },
    ],
    projects: [
      { id: "p1", title: "Library app", repoUrl: "https://github.com/asha/library", durationWeeks: 12, ownerId: ASHA, createdAt: at(5) },
      { id: "p2", title: "Chat app", repoUrl: "https://github.com/asha/chat", durationWeeks: 4, ownerId: ASHA, createdAt: at(6) },
      { id: "p3", title: "Quiz app", repoUrl: "https://github.com/bala/quiz", durationWeeks: 12, ownerId: BALA, createdAt: at(7) },
      { id: "p4", title: "Old project", repoUrl: "https://github.com/old/project", durationWeeks: 12, ownerId: null, createdAt: at(4) },
    ],
    checkpoints: [
      { id: "c1", projectId: "p1", weekNumber: 1, recordedAt: at(10), filesChanged: 4, additions: 40, deletions: 5 },
      { id: "c2", projectId: "p1", weekNumber: 2, recordedAt: at(17), filesChanged: 2, additions: 10, deletions: 1 },
      { id: "c3", projectId: "p1", weekNumber: 3, recordedAt: at(24), filesChanged: 1, additions: 3, deletions: 0 },
      { id: "c4", projectId: "p2", weekNumber: 1, recordedAt: at(11), filesChanged: 3, additions: 30, deletions: 2 },
      { id: "c5", projectId: "p3", weekNumber: 1, recordedAt: at(12), filesChanged: 5, additions: 50, deletions: 9 },
      { id: "c6", projectId: "p4", weekNumber: 1, recordedAt: at(13), filesChanged: 1, additions: 1, deletions: 1 },
    ],
    evaluations: [
      { id: "e1", projectId: "p1", checkpointId: "c1", weekNumber: 1, status: "approved", suggestedScore: 85, confidence: "high" },
      { id: "e2", projectId: "p1", checkpointId: "c2", weekNumber: 2, status: "pending_review", suggestedScore: 90, confidence: "medium" },
      { id: "e3", projectId: "p1", checkpointId: "c3", weekNumber: 3, status: "rejected", suggestedScore: 70, confidence: "low" },
      { id: "e4", projectId: "p2", checkpointId: "c4", weekNumber: 1, status: "edited", suggestedScore: 75, confidence: "high" },
      { id: "e5", projectId: "p3", checkpointId: "c5", weekNumber: 1, status: "edited", suggestedScore: 95, confidence: "high" },
      { id: "e6", projectId: "p4", checkpointId: "c6", weekNumber: 1, status: "pending_review", suggestedScore: 60, confidence: "low" },
    ],
    decisions: [
      { evaluationId: "e1", approvedScore: 80, decidedAt: at(11) },
      { evaluationId: "e3", approvedScore: null, decidedAt: at(25) },
      { evaluationId: "e4", approvedScore: 60, decidedAt: at(12) },
      { evaluationId: "e5", approvedScore: 50, decidedAt: at(13) },
    ],
    quizzes: [
      { checkpointId: "c1", correctCount: 4, total: 5 },
      { checkpointId: "c2", correctCount: null, total: null }, // created, not taken
    ],
    assignments: [
      { id: "a1", title: "Loops and arrays", maxMarks: 15 },
      { id: "a2", title: "Functions", maxMarks: 10 },
      { id: "a3", title: "Recursion", maxMarks: 20 },
    ],
    submissions: [
      { id: "s1", assignmentId: "a1", studentId: ASHA, fileName: "asha-a1.pdf", status: "approved", aiTotal: 14, error: null, createdAt: at(20) },
      { id: "s2", assignmentId: "a2", studentId: ASHA, fileName: "asha-a2.docx", status: "awaiting_review", aiTotal: 8, error: null, createdAt: at(21) },
      { id: "s3", assignmentId: "a1", studentId: BALA, fileName: "bala-a1.pdf", status: "rejected", aiTotal: 3, error: null, createdAt: at(22) },
      { id: "s4", assignmentId: "a2", studentId: BALA, fileName: "bala-a2.pdf", status: "failed", aiTotal: null, error: "Marking could not be completed.", createdAt: at(23) },
      { id: "s5", assignmentId: "a1", studentId: null, fileName: "old.pdf", status: "awaiting_review", aiTotal: 9, error: null, createdAt: at(8) },
    ],
    submissionDecisions: [
      { submissionId: "s1", finalTotal: 12, feedback: "Good work.", decidedAt: at(22) },
      { submissionId: "s3", finalTotal: null, feedback: null, decidedAt: at(24) },
    ],
  };
}

describe("buildStudentList: the class overview", () => {
  const { overview } = buildStudentList(fixture());

  it("counts every student account, project and submission, including old unassigned work", () => {
    expect(overview.totalStudents).toBe(3);
    expect(overview.totalProjects).toBe(4);
    expect(overview.assignmentsSubmitted).toBe(5);
  });

  it("counts what is waiting for review: weekly evaluations and assignment submissions separately", () => {
    expect(overview.weeklyAwaitingReview).toBe(2); // e2 (Asha) and e6 (unassigned)
    expect(overview.assignmentsAwaitingReview).toBe(2); // s2 (Asha) and s5 (unassigned)
  });

  it("averages each student's own official average (never the AI's), leaving out students with no score", () => {
    // Asha: official 80 and 60 (weeks) and 80% (12 of 15) -> (80+60+80)/3 = 73.3. Bala: week 50 only -> 50.
    // Chitra has no official score and the unassigned group is not a student. (73.3 + 50) / 2 = 61.7
    expect(overview.overallAverage).toBe(61.7);
    expect(overview.studentsWithScores).toBe(2);
  });
});

describe("buildStudentList: the student summaries", () => {
  const { students } = buildStudentList(fixture());
  const byName = (name: string) => students.find((s) => s.name === name)!;

  it("lists every account (sorted by name) with the unassigned group last", () => {
    expect(students.map((s) => s.name)).toEqual(["Asha Fictional", "Bala Fictional", "Chitra Fictional", "Unassigned (before accounts)"]);
    expect(students[3].id).toBe(UNASSIGNED_ID);
    expect(students[3].email).toBeNull();
  });

  it("gives Asha her own projects, weeks, assignments and pending reviews, linked by account id", () => {
    expect(byName("Asha Fictional")).toMatchObject({
      id: ASHA,
      email: "asha@gmail.com",
      projectCount: 2,
      weeksRecorded: 4,
      assignmentsSubmitted: 2,
      weeklyPending: 1,
      assignmentPending: 1,
    });
  });

  it("averages only faculty-approved results: AI scores and rejections never count", () => {
    const asha = byName("Asha Fictional");
    expect(asha.projectAverage).toBe(70); // weeks 80 and 60; the AI's 85/90/75 and the rejected week do not count
    expect(asha.assignmentAverage).toBe(80); // 12 of 15
    expect(asha.averageOfficial).toBe(73.3);
    const bala = byName("Bala Fictional");
    expect(bala.projectAverage).toBe(50); // official 50, not the AI's 95
    expect(bala.assignmentAverage).toBeNull(); // rejected: no marks
    expect(bala.averageOfficial).toBe(50);
  });

  it("a student who has done nothing yet shows zeros and no average, not invented numbers", () => {
    expect(byName("Chitra Fictional")).toMatchObject({ projectCount: 0, weeksRecorded: 0, assignmentsSubmitted: 0, weeklyPending: 0, assignmentPending: 0, averageOfficial: null, projectAverage: null, assignmentAverage: null });
  });

  it("keeps old work with no owner in its own group", () => {
    expect(byName("Unassigned (before accounts)")).toMatchObject({ projectCount: 1, weeksRecorded: 1, assignmentsSubmitted: 1, weeklyPending: 1, assignmentPending: 1 });
  });

  it("has no unassigned group when everything has an owner", () => {
    const data = fixture();
    data.projects = data.projects.filter((p) => p.ownerId !== null);
    data.submissions = data.submissions.filter((s) => s.studentId !== null);
    expect(buildStudentList(data).students.map((s) => s.id)).not.toContain(UNASSIGNED_ID);
  });
});

describe("buildStudentDetail", () => {
  const data = fixture();
  const asha = buildStudentDetail(data, ASHA)!;

  it("returns null for an unknown student, and for an empty unassigned group", () => {
    expect(buildStudentDetail(data, "99999999-9999-4999-8999-999999999999")).toBeNull();
    const clean = fixture();
    clean.projects = clean.projects.filter((p) => p.ownerId !== null);
    clean.submissions = clean.submissions.filter((s) => s.studentId !== null);
    expect(buildStudentDetail(clean, UNASSIGNED_ID)).toBeNull();
  });

  it("shows the student's projects with their repositories, newest first, and only their own", () => {
    expect(asha.projects.map((p) => [p.title, p.repoUrl])).toEqual([
      ["Chat app", "https://github.com/asha/chat"],
      ["Library app", "https://github.com/asha/library"],
    ]);
  });

  it("keeps the AI's recommendation apart from the official score, week by week", () => {
    const library = asha.projects.find((p) => p.id === "p1")!;
    expect(library.weeks.map((w) => [w.weekNumber, w.evaluation?.status, w.evaluation?.aiScore, w.evaluation?.officialScore])).toEqual([
      [1, "approved", 85, 80], // the AI said 85, the faculty made it 80
      [2, "pending_review", 90, null], // not official yet
      [3, "rejected", 70, null], // rejected: no official score
    ]);
    expect(library.averageOfficial).toBe(80);
    expect(library.pending).toBe(1);
  });

  it("an edited week's official score is the faculty's, not the AI's", () => {
    const chat = asha.projects.find((p) => p.id === "p2")!;
    expect(chat.weeks[0].evaluation).toMatchObject({ status: "edited", aiScore: 75, officialScore: 60 });
  });

  it("reports each week's checkpoint history and quiz: taken, created but not taken, or none", () => {
    const [w1, w2, w3] = asha.projects.find((p) => p.id === "p1")!.weeks;
    expect(w1).toMatchObject({ recordedAt: at(10), filesChanged: 4, additions: 40, deletions: 5, quizCreated: true, quiz: { correctCount: 4, total: 5 } });
    expect(w2).toMatchObject({ quizCreated: true, quiz: null });
    expect(w3).toMatchObject({ quizCreated: false, quiz: null });
  });

  it("lists every assignment: each submission with AI vs official marks, and a Not submitted row", () => {
    expect(asha.assignments.map((a) => [a.assignmentTitle, a.status, a.aiTotal, a.officialTotal])).toEqual([
      ["Functions", "awaiting_review", 8, null],
      ["Loops and arrays", "approved", 14, 12],
      ["Recursion", "not_submitted", null, null],
    ]);
    const approved = asha.assignments.find((a) => a.status === "approved")!;
    expect(approved).toMatchObject({ submissionId: "s1", feedback: "Good work.", maxMarks: 15, fileName: "asha-a1.pdf" });
    expect(asha.assignments.find((a) => a.status === "not_submitted")).toMatchObject({ submissionId: null, fileName: null, submittedAt: null });
  });

  it("shows failed and rejected submissions with their status, a reason when there is one, and no marks", () => {
    const bala = buildStudentDetail(data, BALA)!;
    expect(bala.assignments.find((a) => a.assignmentTitle === "Functions")).toMatchObject({ status: "failed", error: "Marking could not be completed.", officialTotal: null, feedback: null });
    expect(bala.assignments.find((a) => a.assignmentTitle === "Loops and arrays")).toMatchObject({ status: "rejected", aiTotal: 3, officialTotal: null, feedback: null });
  });

  it("an unassigned group has its old work and no Not submitted rows", () => {
    const old = buildStudentDetail(data, UNASSIGNED_ID)!;
    expect(old.projects.map((p) => p.title)).toEqual(["Old project"]);
    expect(old.assignments.map((a) => a.status)).toEqual(["awaiting_review"]);
  });

  it("never mixes in another student's work", () => {
    const bala = buildStudentDetail(data, BALA)!;
    expect(bala.projects.map((p) => p.id)).toEqual(["p3"]);
    expect(bala.assignments.filter((a) => a.submissionId).map((a) => a.submissionId).sort()).toEqual(["s3", "s4"]);
  });
});
