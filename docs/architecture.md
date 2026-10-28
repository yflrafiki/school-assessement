# Architecture

A modular monolith: one React single-page app, one stateless Express API, one PostgreSQL database. Submitting a record must write the record, the headmaster notifications and the audit entry, and enforce weekly locking, all in one transaction. A single deployable unit is the simplest design that does this correctly.

```
Browser (React SPA)
   | same origin, JSON, Authorization: Bearer <token> (one session per browser tab)
   v
Express API (/api/v1)
   requestId > logging > helmet (CSP) > JSON body > rate limit > session > JSON-only writes > auth > routes
   modules: auth, teachers, assignments, schools, timetable, lessons, curriculum,
            teaching-records, progress, notifications, reports
   |                                  |
   v                                  v
PostgreSQL (Prisma 7, pg adapter)    Outbox worker (in-process) -> EmailProvider -> EmailJS | console
```

## Key decisions

| Decision          | How                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant isolation  | `schoolId` always comes from the session (`req.auth`), never from the request. Every query filters on it. Another school's ids return `NOT_FOUND`. Tests cover this for teachers, lessons, records and actions.                                                                                                                                 |
| Authorization     | Roles map to permissions in `packages/shared/src/auth.ts`. Routes check permissions. The web app reads the same permission list from `/auth/me` to decide which navigation to show. The API remains the gate.                                                                                                                                   |
| Weekly completion | Computed from lessons and records every time (`modules/progress`). There is no stored progress table to drift.                                                                                                                                                                                                                                  |
| Pacing            | `modules/lessons/pacing.ts` is a pure function, unit-tested. It assigns lessons in date order to the earliest required curriculum week with free capacity (N lessons per week, N being the number of weekly timetable slots). Submitted and waived lessons never move.                                                                          |
| Concurrency       | Every change that can alter completeness (submit, cancel, waive, reschedule, absence, holiday, policy, timetable or scheme publish) first takes `SELECT ... FOR UPDATE` on the teaching-assignment row. School-wide changes lock assignments one by one in id order, so they cannot deadlock. A unique `lesson_id` on records stops duplicates. |
| Notifications     | One row per active headmaster, written in the submission transaction. `UNIQUE (recipient, type, record)` makes retries harmless. The bell polls every 30 seconds.                                                                                                                                                                               |
| Audit             | `audit_logs` is append-only (a trigger rejects UPDATE and DELETE) and is written in the same transaction as the change.                                                                                                                                                                                                                         |
| Email             | Account emails go into the `email_outbox` table inside the transaction that creates the token. A worker sends them through `EmailProvider`, spaced 1.1 s apart for EmailJS, then clears the payload (the link carries a token).                                                                                                                 |
| Sessions          | One session per browser tab: an opaque 256-bit token kept in the tab's sessionStorage and sent as a Bearer header. Only the SHA-256 is stored. 8-hour idle and 7-day absolute expiry. Deactivation, password reset and password change revoke sessions at once.                                                                                 |

## Lesson states

A lesson's stored `status` is one of SCHEDULED, CANCELLED, RESCHEDULED or WAIVED. The state shown to users is derived (`modules/lessons/lessonState.ts`):

- **COMPLETED:** a submitted record exists.
- **UPCOMING:** before its start time (school timezone).
- **DUE:** from the start time, with no grace period.
- **OVERDUE:** from 00:00 on the next school day, meaning a weekday that is not a holiday or closure.
- **CANCELLED, RESCHEDULED, WAIVED:** as decided.

System cancellations (holiday, special week, approved absence) are reconciled automatically when the calendar changes, and are undone if the cause is removed. Headmaster decisions are kept.

## Effective week kind

For a class and week: a class policy beats a level policy, which beats the published scheme's week kind. A week with none of these is TEACHING. TEACHING and REVISION weeks need records. MOCK and EXAMINATION weeks cancel the lessons dated in them and never block.

## Where things live

- `backend/src/modules/*/*.routes.ts`: HTTP and validation only.
- `backend/src/modules/*/*.service.ts`: business rules and transactions.
- `backend/prisma/migrations/*_constraints`: partial unique indexes, exclusion constraints, CHECKs, trigram indexes and the audit trigger.
- `frontend/src/features/*`: pages by area. `frontend/src/components`: shared UI.
