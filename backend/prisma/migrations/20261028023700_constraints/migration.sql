-- Hand-written constraints that Prisma's schema language cannot express.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Users: login identity is stored lowercase.
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));

-- One active (unconsumed, unrevoked) invitation per user.
CREATE UNIQUE INDEX auth_tokens_one_active_invitation
  ON auth_tokens (user_id)
  WHERE type = 'INVITATION' AND consumed_at IS NULL AND revoked_at IS NULL;

-- Subject names: unique in the national catalogue and unique within a school.
CREATE UNIQUE INDEX subjects_national_name ON subjects (lower(name)) WHERE school_id IS NULL;
CREATE UNIQUE INDEX subjects_school_name ON subjects (school_id, lower(name)) WHERE school_id IS NOT NULL;

-- Years and terms.
ALTER TABLE academic_years ADD CONSTRAINT academic_years_dates CHECK (start_date <= end_date);
ALTER TABLE terms ADD CONSTRAINT terms_number CHECK (number BETWEEN 1 AND 3);
ALTER TABLE terms ADD CONSTRAINT terms_dates CHECK (start_date <= end_date);
CREATE UNIQUE INDEX terms_one_current_per_school ON terms (school_id) WHERE is_current;
ALTER TABLE term_weeks ADD CONSTRAINT term_weeks_dates CHECK (start_date <= end_date);

-- One published curriculum scheme per term.
CREATE UNIQUE INDEX curriculum_schemes_one_published
  ON curriculum_schemes (term_id) WHERE status = 'PUBLISHED';

-- Week policies: exactly one of level or class, and one policy per term, week and scope.
ALTER TABLE week_policies ADD CONSTRAINT week_policies_level_xor_class
  CHECK ((level IS NULL) <> (class_id IS NULL));
CREATE UNIQUE INDEX week_policies_one_per_level
  ON week_policies (term_id, week_number, level) WHERE class_id IS NULL;
CREATE UNIQUE INDEX week_policies_one_per_class
  ON week_policies (term_id, week_number, class_id) WHERE class_id IS NOT NULL;

-- Timetable: valid slots, and no overlap for one teacher or one class.
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_weekday CHECK (weekday BETWEEN 1 AND 5);
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_times
  CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute);
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_dates CHECK (valid_from <= valid_to);
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_no_teacher_overlap
  EXCLUDE USING gist (
    teacher_profile_id WITH =,
    weekday WITH =,
    int4range(start_minute, end_minute) WITH &&,
    daterange(valid_from, valid_to, '[]') WITH &&
  ) WHERE (deleted_at IS NULL);
ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_no_class_overlap
  EXCLUDE USING gist (
    class_id WITH =,
    weekday WITH =,
    int4range(start_minute, end_minute) WITH &&,
    daterange(valid_from, valid_to, '[]') WITH &&
  ) WHERE (deleted_at IS NULL);

ALTER TABLE lessons ADD CONSTRAINT lessons_times
  CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute);
ALTER TABLE absences ADD CONSTRAINT absences_dates CHECK (start_date <= end_date);

-- Name search.
CREATE INDEX users_full_name_trgm ON users USING gin (full_name gin_trgm_ops);
CREATE INDEX users_email_trgm ON users USING gin (email gin_trgm_ops);
CREATE INDEX teacher_profiles_staff_id_trgm ON teacher_profiles USING gin (staff_id gin_trgm_ops);
CREATE INDEX subjects_name_trgm ON subjects USING gin (name gin_trgm_ops);

-- The audit log is append-only.
CREATE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update_or_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
