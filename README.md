# Human–AI Co-Learning Agent

Evaluates student project progress from GitHub code changes with Gemini, with teacher review.
Currently at **Phase 1** (starter UI + form validation only; no backend, database, Gemini or GitHub integration).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server at http://localhost:3000 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate Next route types, then `tsc --noEmit` |
| `npm test` | Run Vitest once (mocked; no network) |
| `npm run test:live` | Also run live tests against real Supabase/Gemini (spends quota) |
