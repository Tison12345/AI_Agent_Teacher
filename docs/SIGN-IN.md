# Sign in and sign up

A lightweight account system for the college MVP. It is deliberately small: it is enough to keep student pages and
faculty pages apart and to give each person their own login, but it is **not** a production authentication system
(see [What it does not do](#what-it-does-not-do)).

## What it does

- `/login` has **Sign in** and **Sign up** tabs and a **Student** / **Faculty** choice.
  - **Sign up**: role, full name, email, password (at least 4 characters) and confirm password. It creates the account
    and signs you in.
  - **Sign in**: role, email and password. The role must be the one the account was created with.
- A student lands on the Student Dashboard, faculty on the Faculty Dashboard. If the user was sent to the sign-in page
  from one of their own pages, they go back to that page. A signed-in user who opens `/login` is sent to their dashboard.
- The sign-in lasts 8 hours and survives page changes and refreshes. **Log out** is at the bottom of the sidebar (in the
  top bar on small screens), under the signed-in name and role.
- **Student pages** (`/student/...`) need the student role. **Faculty pages** (`/faculty/...`) and the **faculty API**
  (`/api/faculty/...`: AI scores, evaluations, decisions) need the faculty role. Anyone else is redirected to `/login`
  (an API call gets 401 or 403). The sidebar only offers the signed-in role's pages.
- A student who signs in has their full name filled in on the upload form, where it can be changed. The name is shown
  to faculty; a student's own uploads are listed by their account, not by the typed name.
- **Creating a project and uploading an assignment need a student sign-in.** The new record is linked to the student's
  account, taken from the signed cookie. Faculty cannot create them.
- Everything else is as before: the dashboards, assignment marking, weekly evaluation, the LangGraph workflows and the
  faculty approval logic are unchanged.

## Setup (one time)

Run `supabase/migrations/0010_app_users.sql` in the Supabase SQL Editor. It adds one table, `app_users` (email, role,
name, password hash), locked to the server's secret key like the other tables. Until it is run, signing in or up answers
"Accounts are not set up on the server yet." Nothing else is needed: the cookie is signed with `AUTH_SECRET` if you set
it, otherwise with the `SUPABASE_SECRET_KEY` the server already has.

## How it works

| Part | Where |
| --- | --- |
| Roles, field rules, which paths need which role | `src/lib/auth/session.ts` |
| Sign-in / sign-up logic (testable without a database) | `src/lib/auth/service.ts` |
| Accounts in the database | `src/lib/auth/users.ts`, `supabase/migrations/0010_app_users.sql` |
| Password hashing (scrypt, Node's built-in crypto) | `src/lib/auth/password.ts` |
| The signed cookie | `src/lib/auth/token.ts`, `src/lib/auth/cookie.ts` |
| The gate that runs before each page | `src/proxy.ts` (Next.js 16 calls it "proxy", formerly "middleware") |
| Routes | `src/app/api/auth/login`, `signup`, `logout` |
| The page and form | `src/app/login/page.tsx`, `src/components/AuthForm.tsx` |

- Passwords are stored only as salted scrypt hashes. An unknown email and a wrong password get the same answer and take
  about the same time.
- The cookie `colearn_session` is `HttpOnly`, `SameSite=Lax`, and signed with HMAC-SHA256 with an expiry, so a browser
  cannot edit it to become another user or the other role.
- One account per email (the database enforces it, so two sign-ups at once cannot both win).

## What it does not do

- **No email verification.** Anyone can sign up with any address, including one that is not theirs. No email is sent.
- **No password reset, change or lockout**, no rate limiting, no audit log.
- **Roles are chosen at sign-up.** Anyone can create a faculty account, so faculty accounts are not restricted to real
  faculty. For a real deployment, faculty accounts should be created or approved by an administrator.
- **Students still see every project.** Projects and uploads are now linked to the student who made them (for the
  faculty dashboard, migration `0011_student_links.sql`), but the student pages still list all projects, and a student's
  submissions are found by the name typed on the upload form.
- **The student-facing API is still open** (`/api/projects/...`, `/api/assignments/...`, `/api/submissions/...`): the
  faculty pages use some of it, and a protected page does not make an open API private. Only `/api/faculty/...` is gated.

## Before any real use

Use a real authentication provider (for example Supabase Auth) with verified emails, administrator-approved faculty
accounts, password reset and rate limiting; tie projects and submissions to the signed-in user; and protect every API
route. The place to start is `src/proxy.ts` and `requiredRole()`: the role rules already live in one spot.
