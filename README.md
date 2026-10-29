# Human–AI Co-Learning Agent

**New here? Read [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)**: the whole project and its end-to-end flow in plain words.

A college web app where AI helps teachers review student work and **the teacher stays in charge**. It does two things: weekly reviews of a student's GitHub project, and marking of uploaded assignment answers. In both, the AI only *recommends*; the teacher's decision is the official result.

Students submit a project with a GitHub repository. Gemini turns it into a weekly plan. The project's length (1 to 16 weeks, 12 by default) is chosen when it is created. Each week the student records a checkpoint, the server reads the Git changes since the previous checkpoint, and Gemini writes a *recommended* evaluation. A teacher reviews it and makes the **official** decision. Students see only what the teacher approves.

> **Not ready for public deployment.** Sign-in and sign-up are lightweight (an email, a password, and a Student or Faculty role; [docs/SIGN-IN.md](docs/SIGN-IN.md)). Emails are not verified, anyone can create a faculty account, and much of the API is open. See [Limitations](#limitations-read-before-using).

> **Workflows.** Assignment marking and the weekly evaluation run as LangGraph.js graphs with saved checkpoints, a pause for faculty approval, bounded retries, and live progress in the pages. See [docs/WORKFLOWS.md](docs/WORKFLOWS.md).

## Principles the code follows

- The AI score is a **recommendation**. The teacher's decision is the official result, stored separately.
- A Git diff is **evidence of changes**, not proof of authorship or understanding.
- Submitted code is **never run**. The AI sees changed lines only.
- Gemini and GitHub keys stay on the server. All external input is validated on the server.
- AI output is validated (criteria, score limits, cited files, no claims of running code); invalid answers are rejected, never patched, never faked.

## Architecture at a glance

```
Student / Teacher -> Browser -> Next.js app (pages + API routes)
                                  |  gate (src/proxy.ts): signed cookie, role check
                                  |-> domain services -> repositories -> Supabase Postgres + Storage
                                  |-> LangGraph workflows (marking, weekly evaluation) -> pause for teacher
                                  |-> Gemini (plan, evaluation, quiz, marking)
                                  |-> GitHub REST API (commits and diffs, read only)
                                  '-> Python text extractor (PDF / DOCX -> text)
```

| Part | Technology |
| --- | --- |
| App and API | Next.js 16 (App Router), React, TypeScript (strict), Tailwind CSS 4 |
| Validation | Zod 4, shared by browser and server |
| Database and files | Supabase: PostgreSQL and a private Storage bucket, reached only from the server |
| AI | Google Gemini via `@google/genai` |
| Workflows | LangGraph.js with Postgres checkpoints in the `langgraph` schema |
| Text extraction | Python FastAPI service in [`extractor/`](extractor/README.md) |
| Sign-in | Accounts in `app_users`, scrypt password hashes, signed HttpOnly cookie, role gate in `src/proxy.ts` |
| Tests | Vitest |

Folders: `src/app` (pages and API routes), `src/components` (screens), `src/lib` (auth, projects, checkpoints, evaluation, quiz, assignments, submissions, students analytics, workflow, github, gemini), `supabase/migrations` (database), `extractor` (Python), `docs` (guides).

## How it works

1. **Student** creates a project (title, description, GitHub URL) → **Generate plan** (Gemini, one entry per project week, each with tasks and a rubric).
2. **Record starting point** once, before work begins (latest commit of the default branch).
3. **Complete Week N** records the latest commit. Week N is compared with the recorded Week N−1 commit (Week 1 with the starting point). Weeks go in order, once each.
4. The server **evaluates** the changes with Gemini and stores the result with a snapshot of the diff it judged. One evaluation per checkpoint; it can never be replaced.
5. **Teacher** opens `/faculty`, reviews the AI recommendation, evidence and diff, then **approves** (AI's score and feedback), **edits** (own score and feedback) or **rejects** (no score). Decisions are final.
6. **Student** sees the official score and feedback on the project page and the student dashboard. Never the AI's score, the AI's own feedback, or the teacher's private comment.

**Weekly quiz (optional for the student).** After recording a week, the student can open that week's quiz: 5 multiple-choice questions that Gemini writes from the week's tasks and the same code changes. It is created once per week and cannot be regenerated, so a student cannot keep asking until the questions suit them. The server shuffles the options, keeps the correct answers, and grades the **one** attempt; the browser never receives correct answers or explanations until the attempt has been submitted. The teacher sees the result next to the AI recommendation, on the review page, as **separate evidence of understanding**. The quiz does not change the AI's score or the official mark.

## Setup: get the project running

Follow these steps in order. A first-time setup takes about 20 to 30 minutes, most of it creating the accounts.

### What you need first

| Need | Why | Where to get it |
| --- | --- | --- |
| **Node.js 20.9 or newer** (developed on 24) and **Git** | Runs the app | nodejs.org, git-scm.com |
| A **Supabase** project (free tier is fine) | Database and file storage | supabase.com, New project |
| A **Gemini API key** | The AI | Google AI Studio, Get API key |
| **Python 3.12** | Only for assignment uploads (reads PDF and Word files) | python.org |
| A **GitHub token** (optional) | Only for private repos or more than 60 GitHub calls an hour | GitHub, Settings, Developer settings, fine-grained token, read-only |

### Step 1. Get the code and install it

```bash
git clone https://github.com/Tison12345/AI_Agent_Teacher.git
cd AI_Agent_Teacher
npm install
```

### Step 2. Create your settings file

Copy the example file to `.env.local` (this file is private and never committed):

```bash
cp .env.example .env.local          # macOS / Linux / Git Bash
copy .env.example .env.local        # Windows Command Prompt
```

Then open `.env.local` and fill it in, one value at a time:

1. `SUPABASE_URL` and `SUPABASE_SECRET_KEY`: in the Supabase dashboard, **Project Settings, API Keys**. Use the project URL and the **secret** key (starts with `sb_secret_`). Do not use the publishable or anon key.
2. `GEMINI_API_KEY`: the key from Google AI Studio. Leave `GEMINI_MODEL` empty to use the default.
3. `EXTRACTOR_KEY`: make up a long random secret (for example 40 random characters). The Python service reads the same value from this file. Leave `EXTRACTOR_URL` as it is.
4. `DATABASE_URL` and `DATABASE_CA_PATH`: you fill these in during Step 3 (they need a database role that does not exist yet).
5. `GITHUB_TOKEN`: optional.

The full list of variables is in the table below.

### Step 3. Set up the database

Open the Supabase dashboard, **SQL Editor, New query**. Paste the contents of each file in `supabase/migrations/` **in numeric order, 0001 to 0011**, and click **Run** for each (the [migration table](#database-migrations) says what each one adds). Run each file **once**.

Two of them need an extra step:

- **After `0009_langgraph_checkpoints.sql`**: give the new database role a password by running `alter role langgraph_app with password 'choose-a-strong-password';`. Then in the Supabase dashboard click **Connect**, copy the **transaction pooler** URL (port 6543), change the user part from `postgres.` to `langgraph_app.`, put your password in, and paste the result into `DATABASE_URL` in `.env.local`. Download Supabase's CA certificate (**Database settings, SSL configuration**) and save it as `certs/supabase-ca.crt` (or set `DATABASE_CA_PATH` to where you saved it). Details: [docs/WORKFLOWS.md](docs/WORKFLOWS.md#setup).
- **`0011_student_links.sql`** needs `0010` first. If a student account named `student@gmail.com` exists, it also assigns any older projects and uploads to that student (see [Faculty dashboard](#faculty-dashboard)).

### Step 4. Start the text reader (only needed for assignment uploads)

Skip this if you only want the weekly project reviews. In a **second terminal**:

```powershell
cd extractor
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

(On macOS or Linux use `python3.12 -m venv .venv`, then `.venv/bin/python ...`.) Keep this window open. Check it by opening http://127.0.0.1:8001/health, which should show `"ok": true`. More in [extractor/README.md](extractor/README.md).

### Step 5. Start the app

```bash
npm run dev
```

Open **http://localhost:3000**. The settings file is read when the server starts, so **restart `npm run dev` after any change to `.env.local`**. Only one dev server can run per project folder.

### Step 6. Create your first accounts

1. Go to **Sign in**, open the **Sign up** tab, choose **Student**, fill in the form and create the account.
2. Log out (sidebar, bottom). Sign up again as **Faculty** with a different email.

You can now follow the flow in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md): as a student, create a project, generate the plan and record the starting point; as faculty, open the dashboard to review. [docs/DEMO.md](docs/DEMO.md) is a ready-made demo script.

### Step 7. Check that everything works (optional)

```bash
npm test            # unit, route, component and end-to-end tests; no network, no quota
npm run typecheck   # TypeScript
npm run lint        # code style
```

### If something goes wrong

| What you see | Likely cause and fix |
| --- | --- |
| "Accounts are not set up on the server yet." | Migration `0010` has not been run. |
| The faculty dashboard shows an error, or creating a project fails | Migration `0011` has not been run. |
| "Storage is not configured on the server." | `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is missing or wrong, or you did not restart the dev server. |
| Starting an evaluation says 503, or an upload shows "Failed" straight away | `DATABASE_URL` or the certificate is missing or wrong (Step 3, after migration 0009). |
| An upload stays "Processing" or says it cannot read files | The text reader (Step 4) is not running, or `EXTRACTOR_KEY` is missing. |
| The AI says a daily limit was reached | The free Gemini quota for that model is used up. Wait a day, or set `GEMINI_MODEL` to another model you can use. |
| "No new commits since…" | The student has not pushed new code to GitHub since the last recorded point. |
| GitHub says rate limited, or a private repo cannot be read | Add a read-only `GITHUB_TOKEN`. |

### Environment variables (`.env.local`, never committed)

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Your Supabase project URL |
| `SUPABASE_SECRET_KEY` | yes | Supabase **secret** key (`sb_secret_…`). Server only. The anon/publishable key is not used. |
| `GEMINI_API_KEY` | yes | Google AI Studio key. Server only. |
| `GEMINI_MODEL` | no | Defaults to `gemini-2.5-flash`. Free-tier quota is **per model per day**; if one is used up, set another model you have access to. Preview models can change or be retired. |
| `EXTRACTOR_URL` / `EXTRACTOR_KEY` | for assignment uploads | The local text-extraction service (default URL `http://127.0.0.1:8001`) and the secret shared with it. Server only. See [extractor/README.md](extractor/README.md) |
| `DATABASE_URL` / `DATABASE_CA_PATH` | yes, for the workflows | The restricted `langgraph_app` Postgres role through Supabase's pooler, and Supabase's CA certificate (default `certs/supabase-ca.crt`). Server only. See [docs/WORKFLOWS.md](docs/WORKFLOWS.md#setup) |
| `GITHUB_TOKEN` | no | Fine-grained, **read-only** token (Contents: Read, Metadata: Read). Without it GitHub allows 60 requests/hour and only public repos work; with it, 5,000/hour. |

Never prefix these with `NEXT_PUBLIC_`. The production build was checked to confirm none of these values appear in any file served to browsers.

### Database migrations

Run the files in `supabase/migrations/` **in order**, once each, in the Supabase dashboard → SQL Editor:

| File | Adds |
| --- | --- |
| `0001_projects.sql` | `projects` |
| `0002_weekly_plans.sql` | `weekly_plans` (one per project) |
| `0003_checkpoints.sql` | `project_baselines`, `weekly_checkpoints` (immutable, one per week) |
| `0004_evaluations.sql` | `evaluations` (one per checkpoint; AI output immutable) |
| `0005_teacher_decisions.sql` | `teacher_decisions`, `decide_evaluation()` (atomic, final) |
| `0006_variable_duration.sql` | Project length 1 to 16 weeks (replaces the fixed 12) |
| `0007_quizzes.sql` | `quizzes` (one per checkpoint), `quiz_attempts` (one per quiz); both immutable |
| `0008_assignments.sql` | AI assignment evaluation (demo): `assignments`, `submissions`, `submission_decisions`, the `decide_submission()` function, the student-safe views `student_assignments` / `student_submissions`, and a private `submissions` storage bucket |
| `0009_langgraph_checkpoints.sql` | The `langgraph` schema (workflow checkpoints and run leases) and the restricted role `langgraph_app`. Run it, then set the role's password (see [docs/WORKFLOWS.md](docs/WORKFLOWS.md#setup)) |
| `0010_app_users.sql` | Sign-in and sign-up accounts (`app_users`: email, role, name, password hash), server-only. Run it before using the sign-in page (see [docs/SIGN-IN.md](docs/SIGN-IN.md)) |
| `0011_student_links.sql` | `projects.owner_id` and `submissions.student_id` (link each project and upload to the student's account, for the faculty dashboard). It also assigns work created before accounts to one student account (see [Faculty dashboard](#faculty-dashboard)). Needs 0010 |

All tables have row-level security enabled with no access for `anon`/`authenticated`; only the server's secret key can read or write.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Develop / production build / serve the build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate Next route types, then `tsc --noEmit` |
| `npm test` | Whole suite, mocked, no network, no quota |
| `npm run test:live` | Also runs live tests against real Supabase and Gemini (spends quota; needs all migrations) |

Live tests are in `*.live.test.ts` and are excluded from `npm test`. Each creates throwaway data and deletes it.

## Pages and API

| Route | Who it is for | Notes |
| --- | --- | --- |
| `/login` | Everyone | Sign in and sign up (Student or Faculty) |
| `/student`, `/student/projects/[id]` | Students | Create projects, plan, repository check, weekly progress, official results |
| `/faculty`, `/faculty/evaluations/[id]` | Teachers | Student-centric dashboard (see [Faculty dashboard](#faculty-dashboard)), then the review page with evidence and the decision form |
| `/faculty/students/[id]` | Teachers | One student's profile: scores, charts, projects, weekly history, quizzes, assignments |
| `/faculty/projects/[id]` | Teachers | Project overview: every week with scores, feedback, AI findings and quiz result |
| `/student/assignments`, `/student/assignments/[id]` | Students | Assignments with instructions, questions and rubric (demo, in progress) |
| `/faculty/assignments`, `/faculty/assignments/[id]` | Teachers | Create assignments, see submissions with status (demo, in progress) |
| `/faculty/submissions/[id]` | Teachers | One submission: original file, extracted text, AI recommendation, and the approve / edit / reject decision (demo) |
| `POST /api/auth/login`, `/signup`, `/logout` | Everyone | Sign in, sign up, sign out (sets or clears the signed cookie) |
| `GET/POST /api/projects`, `GET /api/projects/[id]` | Students | POST needs a student sign-in and links the project to that student |
| `GET/POST /api/projects/[id]/plan` | Students | POST calls Gemini once |
| `GET /api/projects/[id]/repo`, `/repo/compare` | Students | GitHub reads |
| `POST …/baseline`, `POST …/weeks/[week]/complete`, `GET …/progress` | Students | Progress returns statuses only, never scores |
| `POST …/weeks/[week]/evaluate` | Students | Returns status only; calls GitHub and Gemini |
| `GET/POST …/weeks/[week]/quiz`, `POST …/weeks/[week]/quiz/attempt` | Students | GET: the quiz without answers. POST: creates it once (calls GitHub and Gemini). `attempt`: graded on the server, one attempt |
| `GET /api/projects/[id]/results` | Students | Official results only |
| `GET /api/assignments`, `GET /api/assignments/[id]` | Students | Assignments without reference answers (read from a database view that has no such column) |
| `GET/POST /api/faculty/assignments`, `GET /api/faculty/assignments/[id]` | Teachers | Create assignments; carry reference answers |
| `GET/POST /api/assignments/[id]/submissions`, `POST /api/submissions/[id]/retry` | Students | Both need a student sign-in. Upload a PDF/DOCX (linked to the account); list your own uploads; retry a failed one. Student-safe views only |
| `GET /api/faculty/assignments/[id]/submissions`, `GET /api/faculty/submissions/[id]` | Teachers | Submissions with status; one submission with the extracted text, the AI recommendation, the decision and a short-lived link to the original |
| `POST /api/faculty/submissions/[id]/grade`, `POST /api/faculty/submissions/[id]/decision` | Teachers | Run the AI marking now; the official decision (approve, edit or reject, final) |
| `GET /api/faculty/students`, `GET /api/faculty/students/[id]` | Teachers | The class overview and student list; one student's full profile (`unassigned` for work with no owner) |
| `GET /api/faculty/projects/[id]` | Teachers | One project with every week; carries the AI score and your private comments |
| `GET /api/faculty/evaluations/[id]/quiz` | Teachers | The student's quiz result for that week; answers withheld until the student has attempted it |
| `GET /api/faculty/evaluations[?status=…]`, `GET …/[id]`, `POST …/[id]/decision` | Teachers | Carry the AI score and the diff |
| `GET …/weeks/[week]/evaluation` | Teachers | Full AI evaluation; superseded by the faculty routes |

"Who it is for" is enforced for the pages and for `/api/faculty/*` (the gate in `src/proxy.ts`); creating a project and uploading answers also need a student sign-in. The other `/api/projects/*` and `/api/assignments/*` reads are still open (see Limitations).

## Design system

The interface is a dark theme built from a small set of tokens in `src/app/globals.css`, so the palette can be changed in one place:

- **Colours** (`bg-canvas`, `bg-card`, `border-line`, `text-fg`, `text-muted`, `text-link`, `text-success`, `text-warning`, `text-danger`, accent `cyan`, primary `indigo`/`violet`). Components use these names, never raw hex values.
- **Shared classes** (Tailwind utilities defined in the same file): `card`, `card-hero`, `card-interactive`, `well`, `btn-primary`/`btn-secondary`/`btn-ghost`/`btn-sm`, `field`, `badge-*`, `alert-*`, `progress`, `eyebrow`.
- **Shared components** in `src/components/ui.tsx`: `ScoreCard` (large score with a progress bar; says why when there is no score), `ProgressBar`, `WeekScoreBars`, `StatCard`, `PageHeader`, `Icon`. Status is always shown with a text label as well as a colour.
- The average-score and bar-chart figures are computed from real data only: the teacher's official scores, never the AI's, and a week with no score shows a dash.

## Faculty dashboard

`/faculty` is organised by student. At the top, six numbers for the class: students, projects submitted, assignments submitted, assignments waiting for review, weekly evaluations waiting for review and the average official score. Below them, a searchable list of students (name, email, projects, assignments, pending reviews, average score). Open a student for a short preview, or **Open full profile** (`/faculty/students/[id]`) for their score summary, charts (project-wise, week-wise and assignment marks), every project with its GitHub repository and weekly checkpoint history (AI recommendation next to the official score, quiz result), and every assignment with its status, marks and feedback. Each week and submission links straight to the existing review page to approve, edit or reject. The project overview and review queue are kept below the students.

- **Linked by account.** A project belongs to the student who created it (`projects.owner_id`) and an upload to the student who submitted it (`submissions.student_id`). Both are taken from the signed-in session, never from the browser, and creating either needs a student sign-in. Weekly checkpoints, evaluations and quizzes follow their project.
- **Official vs AI.** Scores and averages count only faculty-approved results (approved or edited). The AI's recommendation is always shown separately and labelled "not official"; a rejection has no score. Weekly scores are out of 100; assignment marks are turned into a percentage of that assignment's total. The class average is the mean of each student's own average, over students who have an approved score.
- **Old work has no owner.** Projects and uploads made before accounts existed could not be linked reliably (they had no owner, and a submission only had a typed name). Migration 0011 assigns them to one account (`student@gmail.com`, change the email in the file to use another); if that account does not exist they are shown as an "Unassigned (before accounts)" group. Nothing is guessed.
- **Not changed:** the evaluation logic, the LangGraph workflows, the decision functions and the approval rules. The dashboard only reads.

## Testing

`npm test` runs unit, route, component and end-to-end workflow tests (`src/e2e/workflow.test.ts` drives the real route handlers from project creation to the student seeing the teacher's score, with fake GitHub and Gemini). Run it before every commit.

## Limitations (read before using)

1. **Lightweight sign-in, not production authentication.** Student pages need the student role, and faculty pages and `/api/faculty/*` need the faculty role, but emails are not verified, anyone can sign up as faculty, there is no password reset or rate limiting, and the rest of the API (`/api/projects/*`, `/api/assignments/*`, `/api/submissions/*`, `…/weeks/[week]/evaluation`, which returns AI scores) is open. Student pages still list every project (work is linked to its owner for the faculty dashboard, but the student views are not narrowed to "my projects" yet). Real authentication (Supabase Auth with student/teacher roles) is the first thing to add before real use; the role rules are in one place, `src/lib/auth/session.ts`, and the gate is `src/proxy.ts`.
2. **AI scores are not trustworthy on their own.** In testing the model scored a complete week 100/100 twice and reports "high" confidence even on very small diffs. It sees changed lines only, never runs code, and cannot judge whether the program works or who wrote it. Teacher review is essential.
3. **Decisions are final.** There is no revise-with-history workflow.
4. **Gemini quota.** On the free tier, a daily limit per model can be exhausted by a handful of evaluations. The app reports a daily limit differently from a per-minute one, but cannot fix either.
5. **Large changes are truncated.** At most 60 files, 10,000 characters per file and 80,000 characters in total are sent; the evaluation says what was left out and lowers its confidence.
6. **Force-push.** If a student rewrites history before the evaluation is generated, the commit may vanish and the evaluation fails with a clear message. Evaluate right after recording.
7. **Duplicate calls.** Simultaneous requests can each spend one Gemini call; only one result is ever stored.
8. **Duration is chosen once.** A project's length (1 to 16 weeks) cannot be changed after it is created, and each project has one plan with no regeneration.
9. **The quiz is only as good as the questions.** Gemini writes them from changed lines it can see, and has not run the code. There is no check that a question is actually answerable from the diff beyond the format rules, no way for a teacher to edit or remove a question, and one attempt means a student who closes the page mid-quiz cannot continue it. A week with no readable code (only images, generated or deleted files) gets no quiz. With only the lightweight sign-in, anyone with the project link can take or submit a student's quiz.
10. **Not checked:** the app has not been deployed or load-tested, and the pages have not been audited with browser accessibility tooling (see the final report for what was and was not checked).

## AI assignment evaluation (demo, built in phases)

A small, separate feature for a college demonstration: faculty create assignments (questions, marks, rubric, optional reference answers); students upload a PDF or DOCX; the answer is graded per question by Gemini as a *recommendation*; faculty review and approve before a student sees any mark. **Phase A** is the schema, assignment creation and the assignment pages. **Phase B** adds student uploads (PDF/DOCX, up to 4 MB) stored in a private Supabase bucket, text extraction by the small Python service in [`extractor/`](extractor/README.md), and the statuses Processing, Needs OCR and Failed (with Try again). **Phase C** adds the AI marking and the faculty decision:

- After a file is read, Gemini marks each question against its rubric (and reference answer, if there is one). The answer must quote the student's own words for every mark above 0, and each quote is checked against the extracted text; marks are checked against each question's maximum. One corrected retry, then the submission is kept as *Failed* with a reason and a Try again button.
- The result is stored as the AI's **recommendation** only (`ai_result`, written once). The total is computed by the database, never by the AI or the browser. The submission becomes *Awaiting faculty review*, and the student sees nothing yet.
- On `/faculty/submissions/[id]` the teacher sees each question's marks, explanation and quotes, then **approves** (copies the AI's marks and feedback), **edits** (new marks, feedback and a private comment) or **rejects** (no marks). This runs through the `decide_submission()` database function; a decision is final. Only after approve or edit does the student see their marks and feedback.
- Reading and marking run as a workflow after the upload response (`after()`), so the student is not kept waiting; the page shows the real steps and refreshes itself. Faculty can also press **Run AI marking** for a submission that is still processing.

**Phase D** adds the faculty dashboard counts (awaiting review, decided, needing attention), fictional sample answer files in [`samples/`](samples/), an end-to-end live test (`src/lib/submissions/flow.live.test.ts`: real files, real Python reader, real Supabase, scripted Gemini) and a step-by-step demo script, [`docs/DEMO.md`](docs/DEMO.md).

Marking uses the same Gemini key and model as the rest of the app. Marks can differ between runs of the same answer, which is why the teacher decides.

Demo limits, on purpose: **only a lightweight sign-in** (emails are not verified and anyone can sign up as faculty, so anyone can create or approve), a student's uploads are linked to their signed-in account (the name on the form is still typed text, shown to faculty), scanned documents are not supported (they will be reported as needing OCR), and the data in the demo is fictional.

## Deployment notes

- Any Node host for Next.js 16 works (e.g. Vercel). Set the server variables (including `DATABASE_URL`) in the host's environment settings, not in the repository.
- Plan generation can take up to ~60 seconds (`maxDuration = 60`). Evaluations and assignment marking run in the background after the response (up to 10 minutes per run); on a host that stops functions earlier, a run can stall, and the page offers **Continue**.
- Run all eleven migrations on the production Supabase project before first use.
- Quiz creation takes up to ~60 seconds like evaluation (`maxDuration = 60`), and uses one more Gemini call per week.
- **Do not expose a deployment publicly until authentication exists** (limitation 1).
- Rotate any key that has ever been pasted into a chat, ticket or commit.
- Use a read-only GitHub token scoped to the repositories you need.
