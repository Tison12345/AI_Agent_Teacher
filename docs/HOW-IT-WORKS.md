# How the project works, from start to finish

This guide explains the whole project in plain words: what it is for, who uses it, what happens at each step, and where
everything is kept. You do not need to be a programmer to read it. For setup and technical detail, see the
[README](../README.md).

## 1. What is this project?

**Human–AI Co-Learning Agent** is a web app for a college. It helps teachers review student work faster, using AI as
an assistant, **while the teacher stays in charge**.

It does two things:

1. **Weekly project reviews.** A student builds a project over several weeks and keeps the code on GitHub. Each week the
   app looks at what changed in the code and an AI writes a suggested review. The teacher decides the real score.
2. **Assignment marking.** A teacher writes an assignment with questions and marking rules. Students upload their
   answers as a PDF or Word file. An AI reads the file and suggests marks. The teacher decides the real marks.

> **The golden rule:** the AI only *suggests*. The teacher's decision is the **official** result. Students never see the
> AI's score. They only see what the teacher approved.

## 2. Who uses it

| Person | What they do |
| --- | --- |
| **Student** | Signs in, creates a project, records their weekly progress, takes a short quiz each week, uploads assignment answers, and reads the teacher-approved results. |
| **Faculty (teacher)** | Signs in, creates assignments, reviews the AI's suggestions, and approves, edits or rejects them. Uses a dashboard that shows every student's progress. |

## 3. Words used in this guide

| Word | Meaning |
| --- | --- |
| **Repository (repo)** | The student's project folder on GitHub, where the code lives. |
| **Commit** | One saved snapshot of the code on GitHub. |
| **Starting point** | The latest commit when the project begins. Week 1 is compared against it. |
| **Checkpoint** | The commit the student records at the end of a week. |
| **Diff** | The list of lines added or removed between two commits. It is the evidence the AI looks at. |
| **Evaluation** | The AI's written review of one week: a score, feedback, and the files and lines it based that on. |
| **Rubric** | The marking rules: what each question or week is judged on, and the points for each part. |
| **Recommendation** | The AI's suggested score. It is **not official**. |
| **Official score** | The score after the teacher approves or edits it. The only score that counts. |
| **Gemini** | The Google AI model the app uses. |

## 4. The big picture

```
 Student ─┐                                              ┌─> GitHub (reads the code changes)
          ├─> Browser ─> Web app (Next.js) ──────────────┼─> Gemini (AI: plan, review, quiz, marking)
 Teacher ─┘            │   gate: who are you?            ├─> Supabase database (all records)
                       │                                 ├─> Supabase storage (uploaded files)
                       └─> Workflows (LangGraph) ────────┴─> Text reader (Python) for PDF / Word
                              │
                              └─ waits here until the teacher decides
```

- The **web app** shows the pages and does the work behind them.
- The **gate** checks who you are on every request. Students can only open student pages. Teachers can only open
  teacher pages.
- The **workflows** run the longer jobs (reading a file, asking the AI, saving the result) step by step, and they pause
  until the teacher decides.
- The **database** is the single source of truth. Only the server can touch it. The browser cannot.

## 5. Signing in

1. Open the site and go to **Sign in**. There are two tabs: **Sign in** and **Sign up**.
2. **Sign up** asks for a role (Student or Faculty), full name, email, password and confirm password.
3. After signing in, a student goes to the **Student Dashboard** and a teacher goes to the **Faculty Dashboard**.
4. You stay signed in for 8 hours. **Log out** is at the bottom of the sidebar.

Behind the scenes, passwords are stored only as scrambled hashes, and the sign-in is kept in a signed cookie that the
browser cannot edit. This is a simple sign-in for a college project, not a full production security system. See
[SIGN-IN.md](SIGN-IN.md).

## 6. Weekly project reviews, step by step

### Step 1. The student creates a project

The student gives a title, a description, a GitHub link, and how many weeks the project lasts (1 to 16, default 12).
The project is saved and **linked to the student's account**, so the teacher can later see whose it is.

### Step 2. The AI writes a weekly plan

The student clicks **Generate plan**. Gemini reads the project and writes one entry per week: a title, goals, tasks,
what to hand in, and a rubric with points. This is done **once**. The plan cannot be regenerated.

### Step 3. The student records a starting point

Before starting work, the student clicks **Record starting point**. The app saves the latest commit on the repo. This is
the "before" picture. It cannot be changed later.

### Step 4. The student works, then records the week

The student writes code and pushes it to GitHub. At the end of the week they click **Complete Week N**. The app saves
the latest commit as that week's checkpoint.

- Weeks go **in order**, and each week can be recorded **once**.
- Week 1 is compared with the starting point. Week 2 is compared with Week 1, and so on.
- If there are no new commits since the last point, the app says so and asks the student to push their work first.

### Step 5. The AI evaluates the week

Recording a week starts the evaluation. The app:

1. Reads the changes between the two commits from GitHub (the diff).
2. Sends those changed lines and the week's plan to Gemini.
3. Checks the answer: does the score fit the rubric, does it only mention real files, and does it avoid claiming it ran
   the code? If not, it asks the AI to fix it once. If it still fails, the run stops with a clear reason.
4. Saves the result as a **recommendation** with a copy of the diff it judged.

The student sees live steps on the page while this happens, but **never a score**.

> The AI only sees changed lines and never runs the student's code. It cannot tell whether the program really works or
> who wrote it. That is why a teacher must review it.

### Step 6. The weekly quiz

After recording a week, the student can open that week's quiz: **5 multiple-choice questions** the AI writes from the
week's tasks and the same code changes.

- The quiz is created **once** per week, so a student cannot keep asking until the questions are easy.
- The student gets **one attempt**. The server marks it. Correct answers and explanations appear only **after** the
  attempt.
- The teacher sees the quiz result next to the AI's review, as extra evidence of whether the student understood their
  own work. It does **not** change the AI score or the official score.

### Step 7. The teacher reviews

The teacher opens the review page and sees the AI's suggested score, its reasons, the files it cited, the diff and the
quiz result. The teacher chooses one of three actions:

| Action | What happens |
| --- | --- |
| **Approve** | The AI's score and feedback become the official result. |
| **Edit** | The teacher writes their own score and feedback (and may add a private comment). |
| **Reject** | No score is given for that week. |

A decision is **final**.

### Step 8. The student sees the result

Only after the teacher decides, the student sees the official score and feedback on the project page and on their
dashboard. They never see the AI's own score, the AI's feedback, or the teacher's private comment.

### What a week looks like to the student

| Status | Meaning |
| --- | --- |
| Not recorded | The student has not recorded this week yet. |
| Evaluating | The AI is reading the changes. |
| Awaiting faculty review | The AI has finished. The teacher has not decided yet. |
| Approved / Edited | The teacher gave an official score. |
| Rejected | The teacher reviewed it and gave no score. |
| Failed | The run stopped. The page shows why and a button to continue or try again. |

## 7. Assignment marking, step by step

### Step 1. The teacher creates an assignment

The teacher writes a title, instructions and questions. Each question has a maximum mark and a rubric. They can add
reference answers. Students never see the reference answers.

### Step 2. The student uploads their answers

On the assignment page the student picks a **PDF or Word (.docx) file** (up to 4 MB) and clicks **Submit answers**.
Only a signed-in student can do this, and the upload is **linked to their account**. The file is stored in a private
folder, and the student's list shows it as **Uploaded**, with its status.

### Step 3. The text is read

A small separate program (a Python service) reads the text out of the file. It cannot read scanned or handwritten
pages (there is no OCR yet). If a file has no readable text, its status becomes **Needs OCR**. Nothing in the file is
ever run.

### Step 4. The AI marks it

Gemini marks each question against its rubric. It must **quote the student's own words** for every mark above zero, and
the app checks that each quote is really in the file. Marks are checked against each question's maximum. If the answer
fails the checks, the AI gets one correction attempt. After that the submission is marked **Failed** with a reason and a
**Try again** button. The total is added up by the database, never by the AI.

### Step 5. The teacher reviews

The submission becomes **Awaiting faculty review**. The teacher sees the original file, the extracted text, and each
question's suggested marks with reasons and quotes, and then **approves**, **edits** or **rejects** it, exactly like a
weekly review.

### Step 6. The student sees the marks

After the teacher approves or edits, the student sees the final marks per question and the feedback.

### Assignment statuses

| Status | Meaning |
| --- | --- |
| Processing | The file is being read or marked. |
| Needs OCR | The file is scanned and cannot be read yet. |
| Failed | Something went wrong. The student can try again. |
| Awaiting faculty review | The AI has marked it. Waiting for the teacher. |
| Approved | The teacher gave official marks. |
| Edited | The teacher changed the marks (the teacher sees this label, the student sees "Approved"). |
| Rejected | The teacher reviewed it and gave no marks. |

## 8. The Faculty Dashboard

The Faculty Dashboard is organised **by student**.

1. **Class overview**: total students, projects submitted, assignments submitted, assignments waiting for review,
   weekly evaluations waiting for review, and the class average official score.
2. **Student list**: a searchable list with each student's name, email, number of projects, assignments submitted,
   pending reviews and average score. A "Pending reviews only" filter narrows it down. Opening a row shows a short
   preview.
3. **Student profile** (**Open full profile**): a score summary, charts (by project, by week, and assignment marks),
   every project with its GitHub link and weekly history, the AI's suggested score shown **next to** the official one
   (clearly labelled), quiz results, and every assignment with its status, marks and feedback. **Review** buttons jump
   straight to the review pages.
4. **Project overview and review queue** sit below the students.

**How averages are worked out:** only official scores count (approved or edited), never AI scores. A rejection has no
score. Assignment marks are turned into a percentage of that assignment's total. The class average is the average of each
student's own average, taking only students who have at least one official score. If nothing is approved yet, the page
shows a dash, not a zero.

**How work is tied to a student:** every project and upload stores the id of the student who created it, taken from the
signed-in account. Weekly checkpoints, evaluations and quizzes belong to a project, so they follow the same student.
Work made before accounts existed has no owner, so it appears under "Unassigned (before accounts)" unless it was moved to
a student account by the migration.

## 9. What runs behind the scenes (workflows)

The two long jobs (marking a submission, evaluating a week) run as **workflows** built with LangGraph. Think of a
workflow as a checklist that is saved after every step:

```
Marking:     read file -> readable? -> AI marks -> checks pass? -> save -> WAIT for teacher -> finish
Evaluation:  load week -> get diff -> AI reviews -> checks pass? -> save -> WAIT for teacher -> finish
```

- **Saved after each step.** If the server restarts, the job can continue from where it stopped.
- **One careful retry.** A short outage of GitHub or Gemini is tried once more. A quota limit or a refused request is not
  retried.
- **A real pause.** The job stops and waits for the teacher. When the teacher decides, the job wakes up, reads the
  decision from the database, and finishes.
- **No double work.** A job holds a short "lease" so two copies cannot run at once. If a job stalls, the page offers a
  **Continue** button.
- **Safe progress view.** The student sees the steps (running, waiting, failed) but never any private details of the
  workflow.

More detail: [WORKFLOWS.md](WORKFLOWS.md).

## 10. Where the information is kept

| What | Where |
| --- | --- |
| Accounts (email, role, name, password hash) | Supabase table `app_users` |
| Projects and who owns them | `projects` (with `owner_id`) |
| Weekly plans | `weekly_plans` |
| Starting point and weekly checkpoints | `project_baselines`, `weekly_checkpoints` |
| AI evaluations and teacher decisions | `evaluations`, `teacher_decisions` |
| Quizzes and attempts | `quizzes`, `quiz_attempts` |
| Assignments, submissions, teacher decisions | `assignments`, `submissions` (with `student_id`), `submission_decisions` |
| Uploaded PDF and Word files | Supabase Storage, a private folder |
| Workflow progress and saved steps | the `langgraph` schema in the same database |

Every table is locked so that only the web server's secret key can read or write. The browser never talks to the
database directly. The AI-written parts are saved once and cannot be edited afterwards.

## 11. Safety rules built into the project

- The AI score is a recommendation. Only the teacher's decision is official, and it is stored separately.
- A diff is evidence of what changed, not proof of who wrote the code or that the student understands it.
- Submitted code is **never run**. Uploaded files are only read.
- API keys (Gemini, GitHub, Supabase) stay on the server and never reach the browser.
- Everything coming in from outside is validated on the server. AI answers are checked and rejected if they break the
  rules. They are never silently patched or faked.
- Students never see AI scores, AI feedback, reference answers or the teacher's private comments.

## 12. Limits you should know about

- **Simple sign-in.** Emails are not verified, anyone can create a faculty account, there is no password reset, and parts
  of the API are still open. This is fine for a college demo, but it needs real authentication before real use.
- **The AI can be too generous.** It judges only the changed lines, so it can give a high score even when the work has
  flaws. This is the main reason a teacher decides.
- **Decisions are final.** There is no "change my mind" history yet.
- **Big changes are trimmed.** At most 60 files, 10,000 characters per file and 80,000 in total are sent to the AI, and
  the evaluation says what was left out.
- **If a student rewrites Git history** before the evaluation runs, the commit can disappear. Evaluate right after
  recording the week.
- **The AI service has a daily free quota.** A handful of evaluations can use it up.
- **Scanned and handwritten files are not supported yet.**
- **A project's length is fixed** once it is created, and it has one plan.
- **Student pages still list every project.** Work is linked to its owner for the faculty dashboard, but the student
  pages have not been narrowed to "my projects only" yet.

## 13. Quick answers

**Does the AI decide the grade?** No. It writes a suggestion. The teacher approves, edits or rejects it.

**Can a student see the AI's score?** No. Only the official score, after the teacher decides.

**Does the app run the student's code?** No. It only reads the changed lines.

**What if the AI makes a mistake?** Its answer is checked first. If it breaks the rules, it is retried once and then the
run stops with a reason. The teacher can also edit or reject any suggestion.

**Can a student retry a quiz?** No. One quiz per week and one attempt.

**Why does a week say "No new commits"?** The student has not pushed any new code since the last recorded point.

**Where do I start as a new user?** Student: sign up, create a project, generate the plan, record your starting point.
Teacher: sign up as Faculty, create an assignment, then open the Faculty Dashboard to review.

## 14. Where to read more

- [README](../README.md): setup, environment variables, migrations, pages and API routes, limitations.
- [SIGN-IN.md](SIGN-IN.md): how accounts and roles work.
- [WORKFLOWS.md](WORKFLOWS.md): the workflow engine in detail.
- [DEMO.md](DEMO.md): a step-by-step demo script.
- [extractor/README.md](../extractor/README.md): the PDF and Word text reader.
