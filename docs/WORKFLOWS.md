# Workflows (LangGraph)

Two processes run as [LangGraph.js](https://langchain-ai.github.io/langgraphjs/) graphs with typed state, explicit
nodes, conditional edges, bounded retries, saved checkpoints and a pause for a person:

| Graph | Thread id | Started by |
| --- | --- | --- |
| **Assignment marking** | `submission:<submission id>` | The student's upload, or Try again |
| **Weekly project evaluation** | `evaluation:<checkpoint id>` | Recording a week, or Generate evaluation |

Plan generation, the quiz and "Complete Week" are **not** part of these graphs. Routing is ordinary code, not an LLM.

## The graphs

```
Assignment marking
  extract_text → check_readable → grade → check_grade → save_result → await_faculty → finish
                      │              ↑        │                         (interrupt)
                      └→ needs_ocr   └────────┘ one corrected retry
  any failure → park_failed

Weekly evaluation
  load_context → fetch_diff → generate → check_evaluation → save_evaluation → await_faculty → finish
                                 ↑               │                              (interrupt)
                                 └───────────────┘ one corrected retry
  any failure → park_failed
```

- **Validation is a node.** `check_grade` / `check_evaluation` run the same checks as before (quotes really in the
  student's answer, marks within the maximum, cited files really in the diff, no claim that code was run). A failed
  check goes back to the model once, with the problems listed. A second failure ends the run as *failed*. Nothing
  unchecked is ever saved.
- **Retries are bounded.** A timeout or a 503 from Gemini or GitHub is tried once more (`RetryPolicy`). A 429, a quota
  error or a rejected request is never retried.
- **The pause is a real interrupt.** `await_faculty` stops the graph and saves its state. The faculty decision is made
  by the existing database functions `decide_submission()` and `decide_evaluation()`; they are unchanged, final, and the
  only source of the official result. After a decision the route wakes the paused graph, which reads the decision from
  the database (it never trusts the wake-up) and finishes. A decision made before the graph reaches the pause is seen
  and the graph does not wait.

## Where state lives

The database stays the authority. The graph is an orchestrator.

| What | Where |
| --- | --- |
| Extracted text, AI recommendation, evaluation, decisions | The existing tables, written by conditional, repeatable updates |
| Working state of a run (page counts, the model's raw answer and checked result, the GitHub diff, attempt numbers) | LangGraph checkpoints in the `langgraph` schema |
| Who is running a thread | `langgraph.run_leases` |

**Checkpoint contents are server-only.** They hold student-related text and AI output. No route returns them.

## Safe to run twice

A node can run again after a crash. Every node is built for that:

- saved text is reused, never read or saved twice (the database refuses to overwrite it anyway);
- the recommendation / evaluation is written once; a repeat finds the earlier row and carries on;
- status changes only apply to a submission that is still `processing`;
- progress entries are keyed by run, node and attempt, so a repeated node cannot add its entry twice.

## One runner at a time

A thread is run by one process at a time. The database decides, with its own clock.

- A run claims a **lease** (180 s) and renews it every 30 s.
- If no renewal has succeeded for 120 s, or a renewal says the lease is gone, the run **stops itself** and aborts its
  Gemini, GitHub and extractor calls. A whole run is capped at 10 minutes.
- Every checkpoint write needs the lease (and re-checks it with the database once the last renewal is over a minute old),
  so a run that lost its lease cannot save anything more.
- A stopped run does not release its lease; it expires by itself.

## What the browser may see

`GET /api/submissions/[id]/workflow` and `GET /api/projects/[id]/weeks/[week]/workflow` return an **allowlisted
projection**: step names and statuses, an attempt number, whether it waits for faculty, a run number, and one fixed
sentence per failure code. They never contain extracted text, AI output, validation issues, the diff, scores or
feedback. This is tested with hostile state. The pages poll every 2 seconds while the run works, and every 10 seconds
while it waits for a person.

A run that has work left, no live lease, and a checkpoint older than 30 seconds is shown as **stalled**, with a
**Continue** button (`POST` to the same URL). Continue picks the run up at the step where it stopped; nothing already
done is repeated. A finished, running or waiting run is left alone.

## Setup

1. Run `supabase/migrations/0009_langgraph_checkpoints.sql` in the Supabase SQL Editor. It creates the `langgraph`
   schema, the run-lease functions and the restricted role `langgraph_app`, then checks its own result and rolls
   everything back if anything is off.
2. Give the role a password: `alter role langgraph_app with password '…';`
3. In **Connect**, copy the *transaction pooler* URL (port 6543). Change the user prefix `postgres.` to
   `langgraph_app.` and put the password in. Set it as `DATABASE_URL` in `.env.local`.
4. Download Supabase's CA certificate (Database settings, SSL configuration) to `certs/supabase-ca.crt` (public, safe to
   commit) or point `DATABASE_CA_PATH` at it. TLS is always verified; verification is never switched off.

The role can read and write only the checkpoint tables, read the leases, and call the three lease functions. It cannot
read or change any application table. The app never creates tables: `setup()` is disabled.

If `DATABASE_URL` is missing, an upload's workflow cannot start and the submission is shown as failed with a plain
message; starting an evaluation answers 503.

## Tests

| Command | What it covers |
| --- | --- |
| `npm test` | Both graphs on an in-memory checkpointer: routing, retries, repeated nodes, pause and wake-up, leases, stalled runs, the progress allowlist, routes, components, and the project end-to-end test through the real evaluation graph |
| `npm run test:live` | The same against the real Supabase Postgres as `langgraph_app`: the role's privileges, 20-way lease contention, restart and resume, checkpoint round trips, and the whole assignment flow with real files and the real Python reader (Gemini scripted) |

## Known limits

- **Slow over the internet.** Each node writes a checkpoint, so one run takes 15 to 35 seconds with a remote database.
- **Serverless time limits.** A host that kills a function before a run ends leaves a stalled run; use **Continue**.
- **A retried evaluation shows fixed failure sentences**, not the exact upstream message (GitHub's rate-limit reset time
  is no longer shown).
- No login, so anyone can press Continue. Same as the rest of the demo.
