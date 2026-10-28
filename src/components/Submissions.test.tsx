import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FacultySubmission, FacultySubmissionSummary, StudentSubmission } from "@/lib/schemas/submission";

const api = vi.hoisted(() => ({
  uploadAnswers: vi.fn(),
  fetchMySubmissions: vi.fn(),
  retryProcessing: vi.fn(),
  fetchFacultySubmissions: vi.fn(),
  fetchFacultySubmission: vi.fn(),
  fetchFacultyAssignment: vi.fn(),
  runAiMarking: vi.fn(),
  decideSubmission: vi.fn(),
}));
vi.mock("@/lib/api/client", () => api);

import { FacultySubmissionDetail } from "./FacultySubmissionDetail";
import { FacultySubmissions } from "./FacultySubmissions";
import { StudentSubmitSection } from "./StudentSubmitSection";

const A = "123e4567-e89b-42d3-a456-426614174000";
const S = "223e4567-e89b-42d3-a456-426614174000";

const mine = (over: Partial<StudentSubmission> = {}): StudentSubmission => ({
  id: S,
  assignmentId: A,
  studentName: "Asha Fictional",
  fileName: "answers.pdf",
  fileType: "pdf",
  fileSize: 2048,
  status: "processing",
  error: null,
  createdAt: "2026-10-28T10:00:00+00:00",
  scores: null,
  finalTotal: null,
  feedback: null,
  decidedAt: null,
  ...over,
});
const pdf = (name = "answers.pdf", size = 100) => new File([new Uint8Array(size)], name, { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  api.fetchMySubmissions.mockResolvedValue([]);
});

describe("StudentSubmitSection", () => {
  const setup = () => ({ user: userEvent.setup(), ...render(<StudentSubmitSection assignmentId={A} maxMarks={15} />) });

  it("asks for the name first and says the name is not a login", () => {
    setup();
    expect(screen.getByText(/this is typed text, not a login/i)).toBeInTheDocument();
    expect(screen.getByText("Enter your name above to see your submissions.")).toBeInTheDocument();
    expect(api.fetchMySubmissions).not.toHaveBeenCalled();
  });

  it("shows the submissions for the typed name once the name is entered, and remembers it", async () => {
    api.fetchMySubmissions.mockResolvedValue([mine({ status: "awaiting_review" })]);
    const { user } = setup();
    await user.type(screen.getByLabelText("Your name"), "Asha Fictional");
    await user.tab();
    expect(await screen.findByText("answers.pdf")).toBeInTheDocument();
    expect(api.fetchMySubmissions).toHaveBeenCalledWith(A, "Asha Fictional");
    expect(screen.getByText("Awaiting faculty review", { selector: "span" })).toBeInTheDocument();
    expect(window.localStorage.getItem("coLearning.studentName")).toBe("Asha Fictional");
  });

  it("uses the remembered name straight away", async () => {
    window.localStorage.setItem("coLearning.studentName", "Asha Fictional");
    api.fetchMySubmissions.mockResolvedValue([mine()]);
    setup();
    expect(screen.getByLabelText("Your name")).toHaveValue("Asha Fictional");
    expect(await screen.findByText("answers.pdf")).toBeInTheDocument();
  });

  it("says when nothing has been submitted under the name", async () => {
    window.localStorage.setItem("coLearning.studentName", "Asha Fictional");
    setup();
    expect(await screen.findByText(/No submissions under/)).toBeInTheDocument();
  });

  it("checks the name and the file before sending anything", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(screen.getByText("Enter your name (at least 2 characters).")).toBeInTheDocument();
    expect(screen.getByText("Choose a PDF or Word file.")).toBeInTheDocument();
    expect(api.uploadAnswers).not.toHaveBeenCalled();
  });

  it("refuses a wrong file type and an oversize file on the page", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<StudentSubmitSection assignmentId={A} maxMarks={15} />);
    await user.type(screen.getByLabelText("Your name"), "Asha Fictional");
    const input = screen.getByLabelText("Your answers (PDF or DOCX)");
    await user.upload(input, new File(["x"], "notes.txt"));
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(screen.getByText("Upload a PDF or Word (.docx) file.")).toBeInTheDocument();
    await user.upload(input, pdf("big.pdf", 4 * 1024 * 1024 + 1));
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(screen.getByText("The file is larger than 4 MB.")).toBeInTheDocument();
    expect(api.uploadAnswers).not.toHaveBeenCalled();
  });

  it("uploads, shows a progress message, then adds the new submission to the list", async () => {
    let finish: (value: unknown) => void = () => {};
    api.uploadAnswers.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user } = setup();
    await user.type(screen.getByLabelText("Your name"), "Asha Fictional");
    await user.upload(screen.getByLabelText("Your answers (PDF or DOCX)"), pdf());
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(screen.getByRole("status")).toHaveTextContent("Uploading and reading your file");
    expect(screen.getByRole("button", { name: "Uploading…" })).toBeDisabled();
    api.fetchMySubmissions.mockResolvedValue([mine({ status: "awaiting_review" })]);
    finish({ ok: true, submission: mine() });
    expect(await screen.findByText(/was received/)).toBeInTheDocument();
    expect(await screen.findByText("Awaiting faculty review", { selector: "span" })).toBeInTheDocument();
    expect(api.uploadAnswers).toHaveBeenCalledWith(A, "Asha Fictional", expect.any(File));
  });

  it("shows the server's file error next to the file field", async () => {
    api.uploadAnswers.mockResolvedValue({ ok: false, message: "x", fields: { file: "This file is not a real PDF." } });
    const { user } = setup();
    await user.type(screen.getByLabelText("Your name"), "Asha Fictional");
    await user.upload(screen.getByLabelText("Your answers (PDF or DOCX)"), pdf());
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(await screen.findByText("This file is not a real PDF.")).toBeInTheDocument();
  });

  it("explains a network failure", async () => {
    api.uploadAnswers.mockRejectedValue(new Error("network"));
    const { user } = setup();
    await user.type(screen.getByLabelText("Your name"), "Asha Fictional");
    await user.upload(screen.getByLabelText("Your answers (PDF or DOCX)"), pdf());
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
  });

  it("shows each status with its message: needs OCR and failed show the reason, failed can be retried", async () => {
    window.localStorage.setItem("coLearning.studentName", "Asha Fictional");
    api.fetchMySubmissions.mockResolvedValue([
      mine({ id: "a1111111-1111-4111-8111-111111111111", status: "needs_ocr", error: "This looks like a scanned or image-only PDF." }),
      mine({ id: "b1111111-1111-4111-8111-111111111111", status: "failed", error: "The text-reading service is not running." }),
    ]);
    api.retryProcessing.mockResolvedValue({ ok: true, submission: mine({ id: "b1111111-1111-4111-8111-111111111111", status: "awaiting_review" }) });
    const { user } = setup();
    expect(await screen.findByText("Needs OCR", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("This looks like a scanned or image-only PDF.")).toBeInTheDocument();
    expect(screen.getByText("The text-reading service is not running.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1); // only the failed one
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.retryProcessing).toHaveBeenCalledWith("b1111111-1111-4111-8111-111111111111");
    expect(await screen.findByText("Awaiting faculty review", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("The text-reading service is not running.")).not.toBeInTheDocument();
  });

  it("the official result appears only when there are final marks", async () => {
    window.localStorage.setItem("coLearning.studentName", "Asha Fictional");
    api.fetchMySubmissions.mockResolvedValue([
      mine({ status: "approved", finalTotal: 12.5, feedback: "Well explained.", scores: [{ number: 1, marks: 12.5 }] }),
    ]);
    setup();
    const card = (await screen.findByText("answers.pdf")).closest("li")!;
    expect(within(card).getByText("Approved", { selector: "span" })).toHaveClass("badge-official");
    expect(card).toHaveTextContent("Final marks: 12.5 / 15");
    expect(card).toHaveTextContent("Well explained.");
  });

  it("a rejected submission shows no marks", async () => {
    window.localStorage.setItem("coLearning.studentName", "Asha Fictional");
    api.fetchMySubmissions.mockResolvedValue([mine({ status: "rejected" })]);
    setup();
    const card = (await screen.findByText("answers.pdf")).closest("li")!;
    expect(card).toHaveTextContent("did not give a mark");
    expect(card.textContent).not.toMatch(/Final marks/);
  });
});

describe("FacultySubmissions", () => {
  const row = (over: Partial<FacultySubmissionSummary> = {}): FacultySubmissionSummary => ({
    id: S,
    assignmentId: A,
    studentName: "Asha Fictional",
    fileName: "answers.pdf",
    fileType: "pdf",
    fileSize: 2048,
    status: "processing",
    error: null,
    createdAt: "2026-10-28T10:00:00+00:00",
    aiTotal: null,
    hasText: true,
    ...over,
  });

  it("lists submissions with status badges and a link to each", async () => {
    api.fetchFacultySubmissions.mockResolvedValue([row(), row({ id: "323e4567-e89b-42d3-a456-426614174000", status: "needs_ocr", error: "Scanned." })]);
    render(<FacultySubmissions assignmentId={A} />);
    const link = (await screen.findAllByRole("link", { name: /Open/ }))[0];
    expect(link).toHaveAttribute("href", `/faculty/submissions/${S}`);
    expect(screen.getByText("Needs OCR", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Scanned.")).toBeInTheDocument();
    expect(screen.getByText("2", { selector: ".badge-neutral" })).toBeInTheDocument();
  });

  it("shows an empty state and an error with retry", async () => {
    api.fetchFacultySubmissions.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce([]);
    const { unmount } = render(<FacultySubmissions assignmentId={A} />);
    expect(await screen.findByText("No student has submitted an answer yet.")).toBeInTheDocument();
    unmount();
    const user = userEvent.setup();
    render(<FacultySubmissions assignmentId={A} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("down");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No student has submitted an answer yet.")).toBeInTheDocument();
  });
});

describe("FacultySubmissionDetail", () => {
  const detail = (over: Partial<FacultySubmission> = {}): FacultySubmission => ({
    id: S,
    assignmentId: A,
    studentName: "Asha Fictional",
    fileName: "answers.pdf",
    fileType: "pdf",
    fileSize: 2048,
    status: "processing",
    error: null,
    createdAt: "2026-10-28T10:00:00+00:00",
    aiTotal: null,
    hasText: true,
    extractedText: "Page 1:\nA loop repeats code.",
    extraction: { pages: [{ number: 1, chars: 600 }], warnings: ["Page 2 has no readable text (it may be a scan or an image)."] },
    downloadUrl: "https://example.test/signed",
    aiResult: null,
    aiModel: null,
    decision: null,
    ...over,
  });

  beforeEach(() => {
    api.fetchFacultyAssignment.mockResolvedValue({
      id: A,
      title: "Loops",
      instructions: "Answer all.",
      questions: [{ number: 1, text: "What is a loop?", maxMarks: 5, rubric: "Repetition." }],
      maxMarks: 5,
      createdAt: "2026-10-27T10:00:00+00:00",
      submissionCount: 1,
      hasReferenceAnswers: false,
      referenceAnswers: null,
    });
  });

  it("shows the original file link, reading warnings, and the extracted text collapsed by default", async () => {
    api.fetchFacultySubmission.mockResolvedValue(detail());
    const user = userEvent.setup();
    render(<FacultySubmissionDetail id={S} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Asha Fictional" })).toBeInTheDocument();
    expect(screen.getByText(/Demo build, no login/)).toBeInTheDocument();
    const download = screen.getByRole("link", { name: /Download the original/ });
    expect(download).toHaveAttribute("href", "https://example.test/signed");
    expect(download).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Page 2 has no readable text/)).toBeInTheDocument();
    expect(screen.getByText("600 characters")).toBeInTheDocument();
    expect(screen.getByText(/A loop repeats code/)).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show the extracted text" }));
    expect(screen.getByText(/A loop repeats code/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Run AI marking" })).toBeInTheDocument(); // text read, not marked yet
  });

  it("says plainly when no text was read, and shows the failure reason", async () => {
    api.fetchFacultySubmission.mockResolvedValue(
      detail({ status: "failed", error: "The text-reading service is not running.", extractedText: null, extraction: null, downloadUrl: null }),
    );
    render(<FacultySubmissionDetail id={S} />);
    expect(await screen.findByText("No text has been read from this file.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The text-reading service is not running.");
    expect(screen.getByText("The original file link could not be created.")).toBeInTheDocument();
  });

  it("a student sees per-question marks and feedback only once the teacher has approved", async () => {
    const questions = [
      { number: 1, text: "What is a loop?", maxMarks: 5, rubric: "r" },
      { number: 2, text: "What is an array?", maxMarks: 2.5, rubric: "r" },
    ];
    api.fetchMySubmissions.mockResolvedValue([
      mine({ id: "aaaaaaaa-e89b-42d3-a456-426614174000", status: "awaiting_review", fileName: "waiting.pdf" }),
      mine({
        status: "approved",
        fileName: "done.pdf",
        scores: [{ number: 1, marks: 4 }, { number: 2, marks: 2 }],
        finalTotal: 6,
        feedback: "Good start.",
        decidedAt: "2026-10-28T11:00:00+00:00",
      }),
    ]);
    window.localStorage.setItem("coLearning.studentName", "Asha Fictional");
    render(<StudentSubmitSection assignmentId={A} maxMarks={7.5} questions={questions} />);
    expect(await screen.findByText("Final marks: 6 / 7.5")).toBeInTheDocument();
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
    expect(screen.getByText("2 / 2.5")).toBeInTheDocument();
    expect(screen.getByText("Good start.")).toBeInTheDocument();
    // The submission still waiting for the teacher shows no marks at all.
    expect(screen.getAllByText(/Final marks/)).toHaveLength(1);
    expect(screen.getByText(/Waiting for your teacher to review/)).toBeInTheDocument();
  });

  it("says when the submission does not exist", async () => {
    api.fetchFacultySubmission.mockResolvedValue(null);
    render(<FacultySubmissionDetail id={S} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This submission does not exist.");
  });
});
