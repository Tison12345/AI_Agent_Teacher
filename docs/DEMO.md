# Demo: AI assignment evaluation

A 10-minute walk-through for a college demonstration. All names and files are fictional.
The AI only recommends; the teacher's decision is the official result.

## Before you start (once)

1. Run migration `supabase/migrations/0008_assignments.sql` in the Supabase SQL Editor (already done on the demo project).
2. In `.env.local`: the Supabase keys, `GEMINI_API_KEY`, and `EXTRACTOR_KEY` (see `.env.example`).
3. Start the reader service and keep its window open:

   ```powershell
   cd extractor
   py -3.12 -m venv .venv
   .venv\Scripts\python -m pip install -r requirements-dev.txt
   .venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8001
   ```

   Check http://127.0.0.1:8001/health shows `{"ok": true, "configured": true}`.
4. Start the website: `npm run dev` and open http://localhost:3000.

## The assignment

If the database has no assignment yet, create this one at **/faculty/assignments** (New assignment). Assignments cannot be edited or deleted afterwards, so type carefully.

**Title:** Loops and Arrays: Basics of Repetition  
**Instructions:** Answer all three questions in your own words. Write short paragraphs, include a small code example where asked, and upload your answers as one PDF or DOCX file.

| # | Question | Marks | Rubric |
|---|---|---|---|
| 1 | Explain what a loop is and why programmers use loops. Give one everyday example of something that repeats. | 5 | 2 for a correct definition (repeating a block of code), 2 for why loops are useful (less code, handles many items), 1 for a sensible everyday example. |
| 2 | What is an array? Write a short code example that creates an array of three numbers and prints each one using a loop. | 6 | 2 for defining an array as an ordered collection of values accessed by index, 2 for a correct array of three numbers, 2 for a loop that prints every element. |
| 3 | Describe the difference between a for loop and a while loop. When would you choose each one? | 4 | 2 for describing how each loop works, 2 for a sensible reason to choose each (known number of repetitions versus repeating until a condition changes). |

Reference answers (optional, faculty only) are in `samples/make_samples.py` (the `STRONG` answers are a good model).

## Sample files (in `samples/`)

| File | What it shows | Expected AI result |
|---|---|---|
| `strong-answers.docx` | A complete, correct answer | Close to 15 / 15 |
| `mixed-answers.docx` | Good on loops, unsure how to print an array | Q2 low, the rest high (about 10 to 13) |
| `weak-answers.pdf` | Wrong answers (a typed PDF) | About 0 / 15 |
| `injection-answers.docx` | An answer that tries to tell the AI to give full marks | About 0 / 15: the AI must ignore the instruction |
| `scanned-answers.pdf` | A page that is only a picture | **Needs OCR**, never marked |

The AI's marks can differ a little between runs. That is why a teacher decides.
To rebuild the files: `extractor\.venv\Scripts\python -I samples\make_samples.py`.

## The walk-through

0. **Sign in** at /login. Choose **Faculty**, type an email (for example `dr.rao@gmail.com`), password `1234` (printed on the page; demo only, see [DEMO-LOGIN.md](DEMO-LOGIN.md)). You land on the Faculty Dashboard. To play the student, **Log out** (bottom of the sidebar) and sign in as **Student** with an email like `asha.fictional@gmail.com`, or use a second browser window. Opening the other role's page sends you back to the sign-in page.

1. **Faculty dashboard** (/faculty/assignments): the cards show assignments, questions, submissions, *Awaiting review* and *Decided*. Open the assignment; open a question to see its rubric and reference answer (faculty only).
2. **Student upload** (/student/assignments, open the assignment): type a name (for example *Asha Fictional*), choose `strong-answers.docx`, **Submit answers**. The card shows the workflow's real steps: *Reading your file*, *Checking the text can be read*, *AI marking*, *Checking the marking*, *Saving the recommendation*, then *Faculty review* (waiting). The status ends as *Awaiting faculty review*; the page refreshes by itself. The student sees **no marks**, and the steps carry no text or scores.
3. **Faculty review** (the submission page): read the extracted text, then the **AI recommendation** (marked *Not official*): marks per question, an explanation, and quotes from the student's own words. Point out that every mark has a quote.
4. **Decide.** The submission page also shows a **Workflow** panel: it is paused at *Faculty review*. *Approve* (the AI's marks become official), *Edit* (change a mark, write the feedback the student sees, add a private comment), or *Reject* (no marks). A decision is final, and the workflow then finishes (every step done).
5. **Back as the student:** reload; the official marks per question and the feedback appear. The private comment and the AI's own numbers are never shown.
6. **Edge cases** (upload each under a new name): `weak-answers.pdf` (low marks), `injection-answers.docx` (the instruction is ignored), `scanned-answers.pdf` (clear *Needs OCR* message), and a `.txt` renamed to `.pdf` (refused: "not a real PDF").
7. **If Gemini is busy** the submission shows *Failed* with a reason and **Try again** (students) or **Run AI marking** (faculty). Nothing is lost.

## Showing the workflow itself

- **Pause and resume.** After step 2 the workflow is parked at *Faculty review* in the database (the `langgraph` schema). Restart the dev server before deciding: the submission page still shows the paused workflow, and approving still finishes it.
- **Weekly evaluation.** On a student project page, *Complete Week N* starts the weekly workflow and the week shows its steps (*Fetching your code changes*, *AI review*, *Checking the review*, *Saving it for teacher review*, then *Teacher review*). The student never sees the AI's score.
- **Retries.** If Gemini times out once, the step is tried again by itself. A bad AI answer is sent back once with the problems listed; a second bad answer ends the run as failed (and the submission or week can be retried).
- **A stopped run.** If the server is stopped mid-run, the panel shows *This run stopped before it finished* with a **Continue** button that picks it up at the step it stopped at.
- Details: [WORKFLOWS.md](WORKFLOWS.md).

## What to say about the limits

- **The sign-in is a demo.** Both roles share the password `1234`, which is printed on the sign-in page, so it keeps the pages apart for the demonstration but is not security. A student is only a typed name. A real deployment needs accounts.
- **Typed documents only.** Scanned or handwritten pages are reported, not guessed. OCR would be a later addition.
- **The AI never decides.** Its marks are a recommendation, stored once and kept apart from the official result.
- The AI cannot run code; it judges what is written. Quotes prove the words are in the answer, not that they are correct.

## Checks you can run

```powershell
npm test                  # unit and component tests
npm run test:live         # also runs the live tests: your real Supabase, and the real extractor (must be running)
cd extractor; .venv\Scripts\python -m pytest
```
