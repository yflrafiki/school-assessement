# Teacher Assessment and Weekly Teaching Monitoring System

A web system for Junior High Schools in Ghana (Basic 7, 8 and 9). Teachers record each timetabled lesson against the term's scheme of learning. Headmasters see records as they arrive and can tell who is up to date and who is behind. Weekly locking stops a teacher moving to the next curriculum week until the previous one is done.

- **Stack:** React + TypeScript (Vite) web app, Node.js + Express API, PostgreSQL through Prisma. One pnpm workspace, modular monolith.
- **No Docker.** PostgreSQL runs as a normal local install. Locally, emails are printed to the API log. In production they go through EmailJS.

## Layout

```
backend            Express API, Prisma schema and migrations, tests
frontend            React single-page app
packages/shared     Zod schemas, enums and error codes used by both apps
tools/              Curriculum extraction notes (see docs/curriculum-import.md)
docs/               Architecture, database, API, security, curriculum import
```

## Requirements

- Node.js 22 or newer (developed on 24), pnpm 10
- PostgreSQL 14 or newer (developed on 18) with the `btree_gist` and `pg_trgm` extensions available (both ship with PostgreSQL)

## First-time setup

1. **Database.** As the PostgreSQL superuser, create an application role and two databases:

   ```sql
   CREATE ROLE school_app LOGIN CREATEDB PASSWORD 'choose-a-password';
   CREATE DATABASE school_assessment OWNER school_app;
   CREATE DATABASE school_assessment_test OWNER school_app;
   ```

   `CREATEDB` is only needed in development, where `prisma migrate dev` creates a temporary shadow database.

2. **Environment.** Copy `backend/.env.example` to `backend/.env` and fill in `DATABASE_URL` and `TEST_DATABASE_URL`. Every variable is validated when the API starts. A missing or malformed value stops it with a clear message.

3. **Install, migrate, seed:**

   ```sh
   pnpm install
   pnpm db:deploy      # applies migrations, including hand-written constraints
   pnpm db:seed        # national subject catalogue (safe to re-run)
   ```

4. **First headmaster.** Headmasters are created by an operator, never through the app:

   ```sh
   pnpm --filter @school/api create-headmaster -- --school "School name" --name "Full Name" --email head@school.example
   ```

   It prompts for the password, or reads `HEADMASTER_PASSWORD` from the environment. To add another headmaster to an existing school, pass `--school-id <id>` instead of `--school`.

## Running locally

In two terminals:

```sh
pnpm dev:api        # http://localhost:4000 (health: /healthz, /readyz)
pnpm dev:web        # http://localhost:5173, proxies /api to the API
```

Sign in at http://localhost:5173 as the headmaster. Each browser tab keeps its own sign-in, so you can open another tab and sign in as a teacher while the headmaster stays signed in in the first one. In the app:

1. **Settings:** create the academic year, then the term, then fill its weeks. Add classes and any Ghanaian languages.
2. **Teachers:** add teachers with their subjects and classes. Each one gets an invitation email. With `EMAIL_PROVIDER=console`, the activation link appears in the API terminal.
3. **Curriculum:** upload the extractor output for the term, review flagged rows, approve, then publish the scheme.
4. **Timetable:** add weekly slots per class, preview, then publish. Publishing generates the term's lessons and paces them onto curriculum weeks.

## Checks

```sh
pnpm typecheck      # all packages, strict TypeScript
pnpm lint           # ESLint across the workspace
pnpm test           # unit and integration tests (API tests use the real test database)
pnpm build          # production builds
```

API integration tests run against `TEST_DATABASE_URL`. They apply migrations once, then truncate tables between tests. Never point it at a database with data you need.

## Production notes

- Build with `pnpm build`, set `WEB_DIST_DIR` to the absolute path of `frontend/dist`, and run `node backend/dist/server.js`. The API then serves the web app from the same origin, under its Content Security Policy.
- Set `NODE_ENV=production`, `APP_BASE_URL` to the public URL, and leave `CORS_ORIGINS` empty. Serve over HTTPS only.
- Email: set `EMAIL_PROVIDER=emailjs` and the `EMAILJS_*` variables. One EmailJS template (`EMAILJS_TEMPLATE_INVITATION`) serves both invitations and password resets, because the app sends the wording with each email: `subject`, `heading`, `intro`, `action_label`, `closing_note`, `link`, plus `to_name`, `to_email`, `school_name`, `from_name` and `reply_to`. Setting `EMAILJS_TEMPLATE_RESET` as well gives resets their own template. Turn off email history in EmailJS, because the link carries a token. In EmailJS, enable "Allow EmailJS API for non-browser applications" (Account → Security). Whether EmailJS accepts server-side calls on your plan is not yet confirmed: send one test invitation first (see docs/security.md).
- Run `pnpm db:deploy` on each release. Back up the database daily with point-in-time recovery.

See [docs/architecture.md](docs/architecture.md) for how the pieces fit together.
