# Security

## Accounts

- No public registration. A headmaster or school admin creates teachers. The first headmaster is created with the operator CLI.
- Invitation: 32 random bytes, only the SHA-256 is stored, 72-hour expiry, single use. Resending revokes the old token, and a partial unique index allows one active invitation per user. The link is `/activate#token=...`. The fragment never reaches servers or logs, and the page removes it from the address bar once read.
- Activation needs the token and the staff ID. Five wrong staff IDs burn the token. Expired, used, revoked, unknown and wrong-staff-ID cases all return the same `INVITATION_INVALID` message.
- Passwords: Argon2id (19 MiB, t=2). Minimum 10 characters, with common passwords and the user's own name, email or staff ID rejected.
- Login: same message for an unknown email and a wrong password. The time spent is equalised with a dummy hash check. Five failures lock the account for 15 minutes. Forgot-password always answers 202 with the same body and throttles per account.
- Reset links expire after 60 minutes and are single use. A successful reset revokes every session. Deactivation revokes sessions and outstanding tokens at once.

## Requests

- Sessions: each browser tab holds its own session token in `sessionStorage` and sends it as `Authorization: Bearer <token>`, so different users can be signed in side by side in different tabs. A new tab starts signed out; closing the tab forgets the token. Browsers never attach this header automatically, so cross-site request forgery is not possible and there is no CSRF token. Every write must also be `application/json`.
- Trade-off (decided 28 Oct 2026): unlike an httpOnly cookie, the token is readable by scripts on the page, so preventing cross-site scripting is what protects it. In production the API serves the web app itself (`WEB_DIST_DIR`) under Helmet's Content Security Policy, which allows scripts only from the app's own origin and no inline scripts. React escapes rendered text, the app uses no `dangerouslySetInnerHTML`, and it loads no third-party scripts. Keep it that way. Tokens still expire after 8 hours idle and 7 days in total, and are revoked by sign-out, deactivation, password change and reset.
- Input is validated with the shared Zod schemas. Malformed ids return `NOT_FOUND`.
- Helmet headers. No `x-powered-by`. Errors return a code, a message and the request id, never internals.
- Per-IP rate limits on login, token endpoints and forgot-password, plus a general API limit. These are in memory, so use a shared store (Redis) when running several API instances.
- Logs redact the Authorization header, passwords and tokens. Audit metadata holds field names, not record text.

## Data

- Tenant isolation: `schoolId` comes only from the session. Cross-school tests are in `backend/test/workflow.test.ts`.
- History is never deleted: foreign keys use RESTRICT, users are deactivated, records are kept. The audit log is append-only at the database level.
- To do before production: daily backups with point-in-time recovery and a restore drill. A scheduled purge of expired sessions, used tokens and sent outbox rows after 90 days is not implemented yet.

## Open item: EmailJS from a server

EmailJS documents a REST endpoint authenticated with the private key (`accessToken`). It is not confirmed whether your plan accepts calls from a server. The account may need "Allow EmailJS API for non-browser applications" enabled. Send one invitation with `EMAIL_PROVIDER=emailjs` before relying on it. Failures are retried with backoff and recorded in `email_outbox.last_error`. The fallback is an SMTP provider implementing the same `EmailProvider` interface (`backend/src/lib/mailer.ts`).
