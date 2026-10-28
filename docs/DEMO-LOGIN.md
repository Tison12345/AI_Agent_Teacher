# Demo sign-in

> **For demonstration only. This is not security.** Both roles share the password **`1234`**, which is printed on the
> sign-in page. Anyone who reads the page can sign in as a student or as faculty. It exists so a college demonstration
> can show the two roles, nothing more. Do not use it with real student data.

## What it does

- `/login` has a **Student** / **Faculty** choice, an **email** (Gmail or any email address) and the password `1234`. The email is only checked to be a valid address: no account is created and no email is sent.
- A student lands on the Student Dashboard, faculty on the Faculty Dashboard. If the user was sent to the sign-in page
  from one of their own pages, they go back to that page.
- The sign-in lasts 8 hours and survives page changes and refreshes. **Log out** is at the bottom of the sidebar (in
  the top bar on small screens), under the signed-in email and role.
- **Student pages** (`/student/...`) need the student role. **Faculty pages** (`/faculty/...`) and the **faculty API**
  (`/api/faculty/...`: AI scores, evaluations, decisions) need the faculty role. Anyone else is redirected to
  `/login` (an API call gets 401 or 403). The sidebar only offers the signed-in role's pages.
- Everything else is as before: the dashboards, assignment marking, weekly evaluation, the LangGraph workflows and the
  faculty approval logic are unchanged.
- A student who signs in has a readable name taken from the email (`asha.fictional@gmail.com` becomes *Asha Fictional*) filled in on the upload form, where it can be changed. Submissions are still found by that typed name.

## How it works (so you can explain it)

| Part | Where |
| --- | --- |
| The rules: password, cookie format, which paths need which role | `src/lib/auth/session.ts` |
| The gate that runs before each page | `src/proxy.ts` (Next.js 16 calls it "proxy", formerly "middleware") |
| Sign in / sign out | `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts` |
| The page and form | `src/app/login/page.tsx`, `src/components/LoginForm.tsx` |
| Sidebar user card and Log out | `src/components/SiteNav.tsx`, `src/components/SessionNav.tsx` |

The cookie `colearn_demo_session` holds the role and the email. It is `HttpOnly` and `SameSite=Lax`. There are **no
accounts and no database changes**.

## What it does NOT do

- **It is not signed or encrypted.** Anyone who can edit their cookies can claim a role without the password, and the
  password is public anyway.
- **It does not identify anyone.** The email is not verified (no message is sent), so anyone can type any address, and two people can use the same one. Projects and submissions
  are still not tied to an account, so a student can see every project, as before.
- **The student-facing API is still open** (`/api/projects/...`, `/api/assignments/...`, `/api/submissions/...`): the
  faculty pages use some of it, and a protected page does not make an open API private. Only `/api/faculty/...` is gated.
- No rate limiting, lockout, password change or audit log.

## Before any real use

Replace it with real authentication (for example Supabase Auth with student and faculty roles), tie projects and
submissions to the signed-in user, and protect every API route. The place to start is `src/proxy.ts` and the
`requiredRole()` function: the role rules already live in one spot.
