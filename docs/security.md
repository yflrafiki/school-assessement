# Security

## Threat model

What the system protects: teachers' and headmasters' accounts, lesson records, and the audit trail of who changed what. Most likely attackers: someone with an account trying to see or change another school's or another teacher's data; someone guessing passwords; someone using a shared school computer after the last user; a malicious page or injected script trying to steal a session; and anyone trying to overload the server.

| Threat                                     | Main defences                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password guessing                          | Argon2id, a 10-character minimum, a common-password list, per-account lockout (5 failures, then 15 minutes), per-IP rate limits                                             |
| Account enumeration                        | Identical answers and timing for an unknown email and a wrong password; forgot-password always answers 202; one generic error for every invitation failure                  |
| Stolen session token                       | Opaque random tokens stored only as SHA-256; 2-hour idle and 12-hour absolute limits; revoked by sign-out, password change or reset, and deactivation; the strict CSP below |
| Cross-site scripting                       | React escaping, no `dangerouslySetInnerHTML`, no third-party scripts; a CSP that allows only this site's own scripts, styles, fonts and connections                         |
| Cross-site request forgery                 | Not possible: the session travels in an `Authorization` header, which browsers never attach on their own                                                                    |
| Clickjacking                               | `frame-ancestors 'none'` and `X-Frame-Options: DENY`                                                                                                                        |
| Open redirect after sign-in                | `returnTo` must be a same-origin path; backslashes and control characters are refused (`frontend/src/lib/safeRedirect.ts`)                                                  |
| Reading another school's or teacher's data | `schoolId` and teacher scope come only from the session; other schools' ids return `NOT_FOUND`; cross-school tests                                                          |
| Shared computers                           | Sessions are per tab and end when the tab closes; `Cache-Control: no-store` on every API response                                                                           |
| Leaked sign-in links                       | Tokens sit in the URL fragment, never sent to servers; single use, short expiry; the console email provider is refused in production                                        |
| Denial of service                          | Per-IP rate limits; 5 MB JSON and 10 MB PDF limits; PDFs capped at 60 pages and 10 uploads an hour per address; at most 8 live notification connections per user            |
| Tampering with history                     | Append-only audit log enforced by a database trigger, and optionally by database permissions (see Database roles)                                                           |
| Vulnerable dependencies                    | Exact versions in `pnpm-lock.yaml`; run `pnpm audit` before each release                                                                                                    |

## Accounts

- No public registration. A headmaster or school admin creates teachers. The first headmaster is created with the operator CLI.
- Invitation: 32 random bytes, only the SHA-256 is stored, 72-hour expiry, single use. Resending revokes the old token, and a partial unique index allows one active invitation per user. The link is `/activate#token=...`. The fragment never reaches servers or logs, and the page removes it from the address bar once read.
- Activation needs the token and the staff ID. Five wrong staff IDs burn the token. Expired, used, revoked, unknown and wrong-staff-ID cases all return the same `INVITATION_INVALID` message.
- Passwords: Argon2id (19 MiB, t=2). Minimum 10 characters, with common passwords and the user's own name, email or staff ID rejected.
- Login: same message for an unknown email and a wrong password. The time spent is equalised with a dummy hash check. Five failures lock the account for 15 minutes. Forgot-password always answers 202 with the same body and throttles per account.
- Reset links expire after 60 minutes and are single use. A successful reset revokes every session. Deactivation revokes sessions, outstanding tokens and live connections at once.

## Sessions

- Each browser tab holds its own session token in `sessionStorage` and sends it as `Authorization: Bearer <token>`, so different users can be signed in side by side in different tabs. A new tab starts signed out; closing the tab forgets the token.
- Browsers copy `sessionStorage` when a tab is duplicated or a link is opened in a new tab. The copy notices (over a `BroadcastChannel`) and swaps the shared token for its own session (`POST /auth/sessions/fork`), so signing out in one tab never ends another.
- Lifetimes: 2 hours idle, 12 hours in total. An open tab stays signed in because it keeps contacting the server.
- Trade-off (decided 28 Oct 2026): unlike an httpOnly cookie, the token is readable by scripts on the page, so preventing cross-site scripting is what protects it. Keep the CSP strict and never add third-party scripts.

## Requests and headers

- Content Security Policy: `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (React sets element styles inline), `img-src 'self' data:`, `font-src 'self' data:`, `connect-src 'self'`, `worker-src 'self' blob:` (reading an uploaded Excel timetable unzips it in a worker the page's own script builds from a blob), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, and `upgrade-insecure-requests` in production. In production the API serves the web app itself (`WEB_DIST_DIR`), so the pages get this policy too.
- Also sent: HSTS for two years, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a `Permissions-Policy` that disables camera, microphone, location, payment and USB. `x-powered-by` is removed.
- Every API response carries `Cache-Control: no-store`.
- Input is validated with the shared Zod schemas, and unknown fields are dropped. Malformed ids return `NOT_FOUND`. Every write must be JSON, except the one PDF upload route, which accepts only `application/pdf` and checks the file signature.
- Errors return a code, a message and the request id, never internals.
- Rate limits are per IP and kept in memory; use a shared store (Redis) when running several API instances.
- Logs redact the Authorization header, passwords and tokens. Audit metadata holds field names, not record text.

## Production settings checked at start-up

The API refuses to start in production when `APP_BASE_URL` is not `https://`, when `CORS_ORIGINS` is set, or when `EMAIL_PROVIDER` is `console`. The console provider writes sign-in links to the logs.

## Database roles (recommended for production)

By default the app connects as the database owner. It is safer for the running app to use a login that can read and write data but cannot change the schema, drop the audit trigger, or edit or delete audit rows. Migrations then use the owner login.

1. In the Neon SQL editor, signed in as the owner (`neondb_owner`), choose a strong password and run:

   ```sql
   CREATE ROLE school_runtime LOGIN PASSWORD 'choose-a-long-random-password';
   GRANT CONNECT ON DATABASE neondb TO school_runtime;
   GRANT USAGE ON SCHEMA public TO school_runtime;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO school_runtime;
   -- Tables added by future migrations get the same rights automatically.
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO school_runtime;
   -- The audit log can be added to and read, never changed or removed.
   REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM school_runtime;
   -- The app never touches the migration history.
   REVOKE ALL ON _prisma_migrations FROM school_runtime;
   ```

2. In Render, set `MIGRATION_DATABASE_URL` to the current owner connection string, and change `DATABASE_URL` to the same string with `school_runtime` and its password in place of `neondb_owner` and the owner password.
3. Deploy. The start command runs migrations with `MIGRATION_DATABASE_URL` and the app with `DATABASE_URL`.
4. Check: in the Neon SQL editor, run `SET ROLE school_runtime; UPDATE audit_logs SET action = action;`. It must fail with "permission denied".

Not yet verified on a live Neon database: the local test database runs as its owner.

## Data

- Tenant isolation: `schoolId` comes only from the session. Cross-school tests are in `backend/test/workflow.test.ts`.
- History is never deleted: foreign keys use RESTRICT, users are deactivated, records are kept. The audit log is append-only at the database level.
- Connections to Neon use TLS with certificate verification (`sslmode=verify-full`).
- Before production: turn on Neon's point-in-time restore and practise a restore once. A scheduled purge of expired sessions, used tokens and sent outbox rows after 90 days is not implemented yet.

## EmailJS from a server

EmailJS needs "Allow EmailJS API for non-browser applications" enabled (Account → Security). Failures are retried with backoff and recorded in `email_outbox.last_error`. The fallback is an SMTP provider implementing the same `EmailProvider` interface (`backend/src/lib/mailer.ts`). Turn off email history in EmailJS, because the emails carry one-time sign-in links.
