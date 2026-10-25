# Human–AI Co-Learning Agent

Students submit a project with a GitHub repository. Gemini turns it into a weekly plan. The project's length (1 to 16 weeks, 12 by default) is chosen when it is created. Each week the student records a checkpoint, the server reads the Git changes since the previous checkpoint, and Gemini writes a *recommended* evaluation. A teacher reviews it and makes the **official** decision. Students see only what the teacher approves.

> **Not ready for public deployment.** There is no login. Anyone who can reach the server can create projects, record checkpoints, **read AI scores, and submit teacher decisions**. See [Limitations](#limitations-read-before-using).

## Principles the code follows

- The AI score is a **recommendation**. The teacher's decision is the official result, stored separately.
- A Git diff is **evidence of changes**, not proof of authorship or understanding.
- Submitted code is **never run**. The AI sees changed lines only.
- Gemini and GitHub keys stay on the server. All external input is validated on the server.
- AI output is validated (criteria, score limits, cited files, no claims of running code); invalid answers are rejected, never patched, never faked.

## How it works

1. **Student** creates a project (title, description, GitHub URL) → **Generate plan** (Gemini, one entry per project week, each with tasks and a rubric).
2. **Record starting point** once, before work begins (latest commit of the default branch).
3. **Complete Week N** records the latest commit. Week N is compared with the recorded Week N−1 commit (Week 1 with the starting point). Weeks go in order, once each.
4. The server **evaluates** the changes with Gemini and stores the result with a snapshot of the diff it judged. One evaluation per checkpoint; it can never be replaced.
5. **Teacher** opens `/faculty`, reviews the AI recommendation, evidence and diff, then **approves** (AI's score and feedback), **edits** (own score and feedback) or **rejects** (no score). Decisions are final.
6. **Student** sees the official score and feedback on the project page and the student dashboard. Never the AI's score, the AI's own feedback, or the teacher's private comment.

## Setup

Requirements: Node.js 20.9 or newer (developed on 24), a Supabase project, a Gemini API key.

```bash
npm install
cp .env.example .env.local     # then fill it in
```

### Environment variables (`.env.local`, never committed)

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Your Supabase project URL |
| `SUPABASE_SECRET_KEY` | yes | Supabase **secret** key (`sb_secret_…`). Server only. The anon/publishable key is not used. |
| `GEMINI_API_KEY` | yes | Google AI Studio key. Server only. |
| `GEMINI_MODEL` | no | Defaults to `gemini-2.5-flash`. Free-tier quota is **per model per day**; if one is used up, set another model you have access to. Preview models can change or be retired. |
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

All tables have row-level security enabled with no access for `anon`/`authenticated`; only the server's secret key can read or write.

### Run

```bash
npm run dev      # http://localhost:3000
```

`.env.local` is read at startup: **restart the dev server after changing it.** Only one dev server can run per project folder.

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
| `/student`, `/student/projects/[id]` | Students | Create projects, plan, repository check, weekly progress, official results |
| `/faculty`, `/faculty/evaluations/[id]` | Teachers | Review queue, evidence, decision form |
| `GET/POST /api/projects`, `GET /api/projects/[id]` | Students | |
| `GET/POST /api/projects/[id]/plan` | Students | POST calls Gemini once |
| `GET /api/projects/[id]/repo`, `/repo/compare` | Students | GitHub reads |
| `POST …/baseline`, `POST …/weeks/[week]/complete`, `GET …/progress` | Students | Progress returns statuses only, never scores |
| `POST …/weeks/[week]/evaluate` | Students | Returns status only; calls GitHub and Gemini |
| `GET /api/projects/[id]/results` | Students | Official results only |
| `GET /api/faculty/evaluations[?status=…]`, `GET …/[id]`, `POST …/[id]/decision` | Teachers | Carry the AI score and the diff |
| `GET …/weeks/[week]/evaluation` | Teachers | Full AI evaluation; superseded by the faculty routes |

"Who it is for" is a convention only: **nothing enforces it yet.**

## Testing

`npm test` runs unit, route, component and end-to-end workflow tests (`src/e2e/workflow.test.ts` drives the real route handlers from project creation to the student seeing the teacher's score, with fake GitHub and Gemini). The results are in the final test report delivered with this phase.

## Limitations (read before using)

1. **No authentication or authorization.** Every route is open. The `/api/faculty/*` routes and `…/weeks/[week]/evaluation` return AI scores, and the decision route lets anyone record an official decision. Students are not separated from each other; the student dashboard lists every project. Adding login is the first thing to do before real use (Supabase Auth with student/teacher roles; the faculty routes share one prefix to make this easy).
2. **AI scores are not trustworthy on their own.** In testing the model scored a complete week 100/100 twice and reports "high" confidence even on very small diffs. It sees changed lines only, never runs code, and cannot judge whether the program works or who wrote it. Teacher review is essential.
3. **Decisions are final.** There is no revise-with-history workflow.
4. **Gemini quota.** On the free tier, a daily limit per model can be exhausted by a handful of evaluations. The app reports a daily limit differently from a per-minute one, but cannot fix either.
5. **Large changes are truncated.** At most 60 files, 10,000 characters per file and 80,000 characters in total are sent; the evaluation says what was left out and lowers its confidence.
6. **Force-push.** If a student rewrites history before the evaluation is generated, the commit may vanish and the evaluation fails with a clear message. Evaluate right after recording.
7. **Duplicate calls.** Simultaneous requests can each spend one Gemini call; only one result is ever stored.
8. **Duration is chosen once.** A project's length (1 to 16 weeks) cannot be changed after it is created, and each project has one plan with no regeneration.
9. **Not checked:** the app has not been deployed or load-tested, and the pages have not been audited with browser accessibility tooling (see the final report for what was and was not checked).

## Deployment notes

- Any Node host for Next.js 16 works (e.g. Vercel). Set the four server variables in the host's environment settings, not in the repository.
- Plan generation and evaluation can take up to ~60 seconds (`maxDuration = 60` on those routes). Choose a plan that allows functions that long.
- Run all six migrations on the production Supabase project before first use.
- **Do not expose a deployment publicly until authentication exists** (limitation 1).
- Rotate any key that has ever been pasted into a chat, ticket or commit.
- Use a read-only GitHub token scoped to the repositories you need.
