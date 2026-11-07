-- Fresh start: removes all of the school's data and keeps only the headmaster and the system
-- admin (name, email, password) and the school itself, so setup can begin again.
-- Run it in Neon's SQL Editor. It is all-or-nothing: if any step fails, nothing changes.
-- THIS CANNOT BE UNDONE. Make a Neon branch (a copy) first if the data might be needed.

BEGIN;

-- Stop before touching anything unless the accounts to keep are there.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE role = 'HEADMASTER') THEN
    RAISE EXCEPTION 'No headmaster account found: nothing was deleted.';
  END IF;
END $$;

-- Everything the school has entered: terms, weeks, classes, scheme of learning, timetable,
-- lessons, lesson records, teachers' profiles and subjects, absences, holidays, special weeks,
-- notifications, sign-ins, pending emails and the activity history.
TRUNCATE
  teaching_record_topics,
  notifications,
  teaching_records,
  lessons,
  timetable_entries,
  absences,
  teaching_assignments,
  week_policies,
  school_calendar_days,
  term_weeks,
  curriculum_entries,
  curriculum_weeks,
  curriculum_schemes,
  import_rows,
  import_batches,
  terms,
  academic_years,
  school_classes,
  teacher_profiles,
  sessions,
  auth_tokens,
  email_outbox,
  audit_logs;

-- Ghanaian languages the school added (the national subject list stays).
DELETE FROM subjects WHERE school_id IS NOT NULL;

-- Every account except the headmaster and the system admin.
DELETE FROM users WHERE role NOT IN ('HEADMASTER', 'SYSTEM_ADMIN');

-- The accounts kept start clean: no lockout from earlier wrong passwords.
UPDATE users SET failed_login_count = 0, locked_until = NULL;

COMMIT;

-- What is left (run on its own to check):
-- SELECT full_name, email, role FROM users;
