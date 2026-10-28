# API

Base path `/api/v1`. JSON only. Responses are `{ data, meta? }` on success and `{ error: { code, message, details?, requestId } }` on failure. Signed-in requests send `Authorization: Bearer <token>`, using the token returned by `/auth/login` or `/auth/invitations/accept`. Lists take `page` (1-based) and `pageSize` (default 20, at most 100) and return `meta: { page, pageSize, total, totalPages }`. Notifications use a cursor instead.

Request bodies and query strings are defined once in `packages/shared/src` and validated with Zod.

| Area                 | Endpoints                                                                                                                                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health               | `GET /healthz`, `GET /readyz` (outside `/api/v1`)                                                                                                                                                                                                                                                                |
| Auth                 | `POST /auth/login`, `/auth/logout`, `GET /auth/me`, `POST /auth/invitations/validate`, `/auth/invitations/accept`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/password/change`                                                                                                                      |
| Teachers             | `GET/POST /teachers`, `GET/PATCH /teachers/:id`, `POST /teachers/:id/deactivate`, `/reactivate`, `/invitations`, `/password-reset`, `GET /teachers/:id/audit`, `GET /teachers/me/assignments` (teacher)                                                                                                          |
| School setup         | `GET/POST /academic-years`, `GET/POST /terms`, `PATCH /terms/:id`, `GET/PUT /terms/:id/weeks`, `GET/POST /classes`, `PATCH /classes/:id`, `GET/POST /subjects`, `PATCH /subjects/:id`, `GET/POST /calendar-days`, `DELETE /calendar-days/:id`, `GET/PUT /week-policies`                                          |
| Assignments          | `GET/POST /assignments`, `PATCH /assignments/:id`, `POST /assignments/carry-forward`                                                                                                                                                                                                                             |
| Timetable            | `GET/POST /timetable-entries`, `PATCH/DELETE /timetable-entries/:id`, `POST /timetable/publish` (`dryRun`, `confirmRepace`)                                                                                                                                                                                      |
| Lessons              | `GET /lessons` (teacher: own; headmaster: school), `GET /lessons/today`, `GET /lessons/:id`, `POST /lessons/:id/cancel`, `/waive`, `/reschedule`, `GET/POST /absences`, `DELETE /absences/:id`, `GET /dashboard/headmaster/daily`                                                                                |
| Curriculum           | `GET /curriculum`, `GET /curriculum/topics?lessonId=`, `GET /curriculum/schemes`, `POST /curriculum/schemes/:id/publish`, `GET/POST /curriculum/imports`, `GET /curriculum/imports/:id`, `GET /curriculum/imports/:id/rows`, `PATCH /curriculum/imports/:id/rows/:rowId`, `POST /curriculum/imports/:id/approve` |
| Records              | `POST /teaching-records` (status `DRAFT` or `SUBMITTED`), `GET /teaching-records`, `GET /teaching-records/by-lesson?lessonId=`, `GET /teaching-records/:id`, `PATCH /teaching-records/:id` (owner, within 48 hours)                                                                                              |
| Progress and reports | `GET /progress/me`, `/progress/me/weeks/:n`, `/progress/teachers`, `/progress/teachers/:id`, `GET /dashboard/teacher`, `/dashboard/headmaster`, `GET /reports/weekly-progress`, `/reports/teaching-activity`, `GET /audit`                                                                                       |
| Notifications        | `GET /notifications` (cursor), `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`                                                                                                                                                                               |

## Error codes

| Code                      | HTTP | Meaning                                                                                                          |
| ------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| UNAUTHENTICATED           | 401  | No or expired session, or bad credentials                                                                        |
| FORBIDDEN                 | 403  | Wrong role                                                                                                       |
| NOT_FOUND                 | 404  | Missing, or belongs to another school or teacher (indistinguishable on purpose)                                  |
| VALIDATION_ERROR          | 422  | Field errors in `details.fields` (malformed JSON returns 400)                                                    |
| WEEK_LOCKED               | 409  | An earlier required week is incomplete. `details` holds `requestedWeek`, `blockingWeek` and `outstandingLessons` |
| DUPLICATE_TEACHING_RECORD | 409  | The lesson already has a submitted record                                                                        |
| CONFLICT                  | 409  | Overlapping slot, state conflict, re-pace needs confirmation                                                     |
| INVITATION_INVALID        | 400  | Any invitation failure (one message for all)                                                                     |
| TOKEN_INVALID             | 400  | Reset link invalid or expired                                                                                    |
| RATE_LIMITED              | 429  | Too many attempts, or account temporarily locked                                                                 |
| INTERNAL_ERROR            | 500  | Logged with the request id                                                                                       |
